#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Автоматизирует проверки, которые провалила прошлая попытка заполнения
экономики регионов 1946 (docs/DECISIONS.md, 2026-07-04, "Аудит"). Проход
скрипта — критерий готовности задачи, не самоотчёт "Выполнено".

Запуск: python scripts/map/validate_region_economy_1946.py
Возвращает exit code 0 при отсутствии нарушений, 1 иначе.
"""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.anchors import COUNTRY_POPULATION_1946, MULTI_FRAGMENT_TOTALS
from economy_1946.country_splits import CHINA_SPLIT, GERMANY_SPLIT, KOREA_SPLIT
from economy_1946.region_files import load_regions_combined
from economy_1946.resource_catalog import load_resource_catalog, resources_introduced_after

# Единый источник истины (docs/plans/05_DATA_LAYOUT.md, Срез 3) — раньше
# POST_1946_RESOURCES дублировался вручную.
POST_1946_RESOURCES = resources_introduced_after(load_resource_catalog(), 1946)
WORLD_POP_MIN = 2_200_000_000
WORLD_POP_MAX = 2_600_000_000
COUNTRY_TOTAL_TOLERANCE = 0.03  # 3% — допуск на округление при распределении

DIRECT_OWNER_POPULATION = {**CHINA_SPLIT, **GERMANY_SPLIT, **KOREA_SPLIT}


def main() -> int:
    regions = load_regions_combined()

    violations: list[str] = []
    warnings: list[str] = []

    # 1. Население/ВВП > 0 всюду
    zero_pop = [r["id"] for r in regions if r["population"] <= 0]
    if zero_pop:
        violations.append(f"population <= 0 в {len(zero_pop)} регионах: {zero_pop[:10]}{'...' if len(zero_pop) > 10 else ''}")
    zero_gdp = [r["id"] for r in regions if r["gdp"] <= 0]
    if zero_gdp:
        violations.append(f"gdp <= 0 в {len(zero_gdp)} регионах: {zero_gdp[:10]}{'...' if len(zero_gdp) > 10 else ''}")

    # 2. 0..1-поля в диапазоне
    for field in ("urbanization", "stability", "infrastructure", "development"):
        bad = [r["id"] for r in regions if not (0 <= r[field] <= 1)]
        if bad:
            violations.append(f"{field} вне [0,1] в {len(bad)} регионах: {bad[:10]}")

    # 3. НЕТ 3+ регионов страны с идентичной плотностью (сигнатура прошлой ошибки)
    density_by_country: dict[str, list[tuple[float, int]]] = defaultdict(list)
    for r in regions:
        if r["area"] > 0 and r["population"] > 0:
            density = round(r["population"] / r["area"], 2)
            density_by_country[r["ownerCountryId"]].append((density, r["id"]))

    for owner, entries in density_by_country.items():
        counts = Counter(d for d, _ in entries)
        for density, count in counts.items():
            if count >= 3:
                ids = [rid for d, rid in entries if d == density]
                violations.append(
                    f"{owner}: {count} регионов делят идентичную плотность {density}/km2 "
                    f"(id={ids}) — сигнатура прошлой ошибки (density×area константа)."
                )

    # 4. Anti-copy-paste: ни у одной пары регионов страны не совпадают ВСЕ поля
    fields_to_compare = ("population", "urbanization", "stability", "infrastructure", "development", "gdp")
    by_owner: dict[str, list[dict]] = defaultdict(list)
    for r in regions:
        by_owner[r["ownerCountryId"]].append(r)
    for owner, owner_regions in by_owner.items():
        seen: dict[tuple, int] = {}
        for r in owner_regions:
            key = tuple(r[f] for f in fields_to_compare)
            if key in seen:
                violations.append(f"{owner}: регионы {seen[key]} и {r['id']} идентичны по всем полям ({fields_to_compare}).")
            else:
                seen[key] = r["id"]

    # 5. deposits только eraIntroduced <= 1946 (план 04 заменил resourceProduction
    # на deposits/extraction — эта проверка была мёртвой, читая уже не
    # заполняемое поле, до этого фикса, план 05).
    for r in regions:
        for res in r.get("deposits", {}):
            if res in POST_1946_RESOURCES:
                violations.append(f"region {r['id']} ({r['ownerCountryId']}): ресурс '{res}' введён после 1946 (date-gate нарушен).")

    # 6. Мировой тотал населения в разумном диапазоне
    world_total = sum(r["population"] for r in regions)
    if not (WORLD_POP_MIN <= world_total <= WORLD_POP_MAX):
        violations.append(
            f"Мировой тотал населения {world_total:,} вне диапазона "
            f"[{WORLD_POP_MIN:,}, {WORLD_POP_MAX:,}] (историческая оценка 1946: ~2.3-2.4 млрд)."
        )
    else:
        warnings.append(f"Мировой тотал населения: {world_total:,} (в допуске).")

    # 7. Страновые тоталы близки к анкерам (там, где анкер есть как единая цифра)
    pop_by_owner = {owner: sum(r["population"] for r in rs) for owner, rs in by_owner.items()}
    for owner, anchor in COUNTRY_POPULATION_1946.items():
        if anchor is None or owner not in pop_by_owner:
            continue
        actual = pop_by_owner[owner]
        expected = anchor.population
        if expected <= 0:
            continue
        deviation = abs(actual - expected) / expected
        if deviation > COUNTRY_TOTAL_TOLERANCE:
            violations.append(
                f"{owner}: страновой тотал населения {actual:,} отклоняется от анкера "
                f"{expected:,} на {deviation*100:.1f}% (допуск {COUNTRY_TOTAL_TOLERANCE*100:.0f}%)."
            )

    for owner, expected in DIRECT_OWNER_POPULATION.items():
        if owner not in pop_by_owner:
            continue
        actual = pop_by_owner[owner]
        deviation = abs(actual - expected) / expected if expected else 0
        if deviation > COUNTRY_TOTAL_TOLERANCE:
            violations.append(
                f"{owner} (фрагмент): страновой тотал {actual:,} отклоняется от анкера "
                f"{expected:,} на {deviation*100:.1f}%."
            )

    # 8. Китай специально: сумма CHN+TWN+QMS должна быть ОДНИМ историческим
    # тоталом, не тремя (прошлая ошибка) — двойная проверка сверх п.7.
    china_total = sum(pop_by_owner.get(k, 0) for k in ("CHN", "TWN", "QMS"))
    china_expected = MULTI_FRAGMENT_TOTALS["CHINA_TOTAL"].population
    china_dev = abs(china_total - china_expected) / china_expected
    if china_dev > COUNTRY_TOTAL_TOLERANCE:
        violations.append(
            f"Китай (CHN+TWN+QMS): сумма {china_total:,} отклоняется от единого "
            f"исторического тотала {china_expected:,} на {china_dev*100:.1f}% "
            f"— проверь, не задвоен ли Китай снова."
        )
    else:
        warnings.append(f"Китай (CHN+TWN+QMS) сумма: {china_total:,} (не задвоен, в допуске).")

    # Отчёт
    print(f"Регионов: {len(regions)}, стран/владельцев: {len(by_owner)}")
    for w in warnings:
        print(f"  [ok] {w}")

    if violations:
        print(f"\nНАРУШЕНИЯ ({len(violations)}):")
        for v in violations:
            print(f"  [FAIL] {v}")
        return 1

    print("\nВсе проверки пройдены чисто.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
