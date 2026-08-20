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
from economy_1946.capital_geography import find_containing_regions, load_region_geometries, load_ts_capital_anchors
from economy_1946.capital_overrides import CAPITAL_REGION_ANCHOR_NAMES, CAPITAL_REGION_OVERRIDES
from economy_1946.country_splits import CHINA_SPLIT, GERMANY_SPLIT, KOREA_SPLIT, AUSTRIA_SPLIT
from economy_1946.region_files import load_regions_layers, combine_regions, load_json, SCENARIO_DIR
from economy_1946.resource_catalog import load_resource_catalog, resources_introduced_after

COUNTRIES_PATH = SCENARIO_DIR / "countries.json"

# Единый источник истины (docs/plans/05_DATA_LAYOUT.md, Срез 3) — раньше
# POST_1946_RESOURCES дублировался вручную.
POST_1946_RESOURCES = resources_introduced_after(load_resource_catalog(), 1946)
WORLD_POP_MIN = 2_200_000_000
WORLD_POP_MAX = 2_600_000_000
COUNTRY_TOTAL_TOLERANCE = 0.03  # 3% — допуск на округление при распределении

DIRECT_OWNER_POPULATION = {**CHINA_SPLIT, **GERMANY_SPLIT, **KOREA_SPLIT, **AUSTRIA_SPLIT}


def validate_structural_invariants(
    regions: list[dict], countries: list[dict], catalog: dict,
    names_en: dict[str, str], names_ru: dict[str, str],
) -> list[str]:
    """Инварианты целостности данных (docs/plans/05_DATA_LAYOUT.md, Срез 4) —
    не завязаны на исторические анкеры 1946, применимы к любому сценарию/
    фикстуре. Отдельно от исторических/калибровочных проверок main() ниже,
    чтобы быть тестируемыми на синтетических данных (см.
    test_validate_region_economy_1946.py)."""
    violations: list[str] = []
    by_id = {r["id"]: r for r in regions}
    country_ids = {c["id"] for c in countries}

    # 9. Симметрия графа соседей: A -> B подразумевает B -> A.
    for r in regions:
        for n_id in r.get("landNeighboringRegionIds", []):
            neighbor = by_id.get(n_id)
            if neighbor is None:
                violations.append(f"region {r['id']}: сосед {n_id} не существует.")
                continue
            if r["id"] not in neighbor.get("landNeighboringRegionIds", []):
                violations.append(
                    f"несимметричный сосед: region {r['id']} -> {n_id}, "
                    f"но {n_id} не ссылается обратно на {r['id']}."
                )

    # 10. ownerCountryId существует в countries.json.
    for r in regions:
        if r["ownerCountryId"] not in country_ids:
            violations.append(f"region {r['id']}: ownerCountryId '{r['ownerCountryId']}' не найден в countries.json.")

    # 11. capitalRegionId страны принадлежит региону этой же страны.
    for c in countries:
        capital = by_id.get(c["capitalRegionId"])
        if capital is None:
            violations.append(f"{c['id']}: capitalRegionId {c['capitalRegionId']} не существует среди регионов.")
        elif capital["ownerCountryId"] != c["id"]:
            violations.append(
                f"{c['id']}: capitalRegionId {c['capitalRegionId']} принадлежит "
                f"'{capital['ownerCountryId']}', не '{c['id']}'."
            )

    # 12. deposits/extraction — только ресурсы из каталога.
    catalog_ids = set(catalog["resources"].keys())
    for r in regions:
        for field in ("deposits", "extraction"):
            unknown = set(r.get(field, {})) - catalog_ids
            if unknown:
                violations.append(f"region {r['id']}: {field} содержит ресурсы вне каталога: {sorted(unknown)}.")

    # 13. Полнота локализации: у каждого региона есть имя И en, И ru (в файлах,
    # не после фолбэка getText() — фолбэк на рантайме мягкий, но датасет
    # должен быть полным).
    for r in regions:
        geo_id = r["geoJsonId"]
        missing = [loc for loc, names in (("en", names_en), ("ru", names_ru)) if geo_id not in names]
        if missing:
            violations.append(f"region {r['id']} (geoJsonId={geo_id}): нет имени в локали(ях) {missing}.")

    return violations


def validate_capital_anchor_names(
    regions: list[dict], overrides: dict[str, int], anchor_names: dict[str, str],
) -> list[str]:
    """capitalRegionId, назначенный через CAPITAL_REGION_OVERRIDES (economy_1946/
    capital_overrides.py), должен резолвиться в регион с ОЖИДАЕМЫМ именем
    (CAPITAL_REGION_ANCHOR_NAMES) И с ОЖИДАЕМЫМ владельцем (сам code) --
    имя источника (ADM1-топоним) не зависит от build-порядка, в отличие от
    самого id (см. docstring capital_overrides.py). Ловит именно тот класс
    дрейфа, который invariant 11 (capital принадлежит региону страны)
    пропускает: id сместился на ДРУГОЙ регион ТОЙ ЖЕ страны (Chukotka вместо
    Moscow -- оба принадлежат SUN, owner-проверка invariant 11 проходит,
    имя -- нет).

    Владелец проверяется здесь ЖЕ, не полагаясь на invariant 11 отдельно
    (2026-07-26, независимое ревью): без этого substring-имя вроде "Northern"/
    "Southern"/"Eastern" (реально встречается в 18/11/10 регионах по всему
    миру, см. .agent/plans/capital-region-invariant.md) почти ничего не
    подтверждает само по себе -- если бы id ZMB сместился с 1296 на ЛЮБОЙ
    другой "Southern"-регион чужой страны, проверка только по имени прошла
    бы молча. Фильтр по владельцу сжимает 18/11/10 кандидатов до ровно
    одного для каждой из текущих 55 записей (проверено).

    Отдельно от validate_structural_invariants: завязана на реальную
    историческую таблицу 1946 года, не применима к произвольной
    синтетической фикстуре региона/страны."""
    violations: list[str] = []
    by_id = {r["id"]: r for r in regions}
    for code, expected_name in anchor_names.items():
        rid = overrides.get(code)
        if rid is None:
            violations.append(
                f"{code}: есть в CAPITAL_REGION_ANCHOR_NAMES ('{expected_name}'), "
                f"но нет записи в CAPITAL_REGION_OVERRIDES -- таблицы рассинхронизированы."
            )
            continue
        region = by_id.get(rid)
        if region is None:
            continue  # уже поймано invariant 11 (capitalRegionId существует)
        actual_name = region.get("names", {}).get("en", "")
        actual_owner = region.get("ownerCountryId")
        name_ok = expected_name in actual_name
        owner_ok = actual_owner == code
        if not (name_ok and owner_ok):
            problems = []
            if not owner_ok:
                problems.append(f"владелец '{actual_owner}' вместо '{code}'")
            if not name_ok:
                problems.append(f"имя '{actual_name}' не содержит ожидаемое '{expected_name}'")
            violations.append(
                f"{code}: CAPITAL_REGION_OVERRIDES['{code}']={rid} сейчас резолвится "
                f"в регион '{actual_name}' ({', '.join(problems)}). Две возможные причины, "
                f"не подразумевай без проверки: (а) id позиционно сместился после "
                f"регенерации геометрии -- пересинхронизировать CAPITAL_REGION_OVERRIDES "
                f"на новый id; (б) регион был легитимно переименован/владелец сменился по "
                f"историческому решению, а id всё ещё указывает верно -- тогда чинить нужно "
                f"CAPITAL_REGION_ANCHOR_NAMES, а не id. Проверь names.en.json и git history "
                f"региона перед правкой любого из двух."
            )
    return violations


def validate_capital_geography(
    countries: list[dict],
    capital_anchors: dict[str, tuple[float, float]],
    region_geometries: dict[int, dict],
) -> tuple[list[str], list[str], int]:
    """Самый сильный доступный якорь: страна с известной реальной точкой
    столицы (lon, lat) -- server/src/scenarios/generateMapFeatures.ts::
    CAPITAL_OVERRIDES, см. economy_1946/capital_geography.py -- должна иметь
    capitalRegionId, чей ПОЛИГОН СОДЕРЖИТ эту точку. Полностью не зависит от
    id, имени региона или build-порядка -- географическая точка не может
    "сместиться".

    Возвращает (violations, warnings, checked). Если точка не содержится НИ
    ОДНИМ регионом (например, из-за огрубления береговой линии у самой
    границы полигона -- наблюдалось для Копенгагена/DNK), это не решается
    однозначно (может быть верно) -- не violation (страна всё равно
    защищена validate_capital_anchor_names выше, если у неё есть запись в
    CAPITAL_REGION_OVERRIDES), но и не тишина: попадает в warnings, чтобы
    падение покрытия было видно в выводе.

    checked -- явный счётчик якорей, для которых страна реально нашлась в
    countries.json и проверка была фактически выполнена (2026-07-26,
    независимое ревью, находка 1): страна, отсутствующая в countries.json
    (`continue` ниже), не даёт ни violation, ни warning -- если бы покрытие
    в main() считалось как len(capital_anchors) - len(warnings), такой якорь
    молча засчитался бы в "covered", хотя для него вообще не было проверки
    (воспроизведено: убрать TWN/DNK/EGY из countries.json -> печатает
    "13/13", хотя реально проверено 10). Не может замаскировать НЕВЕРНУЮ
    столицу (нет страны -- нет и её capitalRegionId, чтобы быть неверным),
    но счётчик, единственная задача которого -- честно отчитываться о
    покрытии, обязан быть точным независимо от вреда конкретного сценария."""
    violations: list[str] = []
    warnings: list[str] = []
    checked = 0
    by_country = {c["id"]: c for c in countries}
    for code, anchor in capital_anchors.items():
        country = by_country.get(code)
        if country is None:
            continue
        checked += 1
        actual_id = country.get("capitalRegionId")
        containing = find_containing_regions(anchor, region_geometries)
        lon, lat = anchor
        if not containing:
            warnings.append(
                f"{code}: точка реальной столицы (lon={lon}, lat={lat}) не содержится "
                f"НИ ОДНИМ известным регионом -- не нарушение (может быть огрубление "
                f"геометрии у границы полигона), но географическая проверка для этой "
                f"страны сейчас неопределима (нет покрытия)."
            )
        elif actual_id not in containing:
            violations.append(
                f"{code}: capitalRegionId={actual_id} не содержит географическую точку "
                f"реальной столицы (lon={lon}, lat={lat}) -- точка находится в регионе(ах) "
                f"{containing}, не в {actual_id}."
            )
    return violations, warnings, checked


def validate_capital_override_applied(countries: list[dict], overrides: dict[str, int]) -> list[str]:
    """countries.json -- сгенерированный артефакт: generate_country_registry.py
    читает CAPITAL_REGION_OVERRIDES.get(country_id) напрямую и пишет его как
    capitalRegionId. Эта проверка -- по САМОМУ countries.json (не по таблице),
    для ВСЕХ живых записей CAPITAL_REGION_OVERRIDES, а не только 13 с
    географическим якорем.

    Нужна отдельно от validate_capital_anchor_names (проверяет ТАБЛИЦУ) и
    validate_capital_geography (проверяет countries.json, но только для 13
    держав): без неё разрыв между "таблица верна" и "countries.json верен"
    не ловится НИКЕМ для остальных ~42 стран -- если countries.json
    отредактирован вручную мимо генератора или просто не пересобран после
    правки таблицы, обе остальные проверки могут молчать одновременно
    (2026-07-26, независимое ревью: откат только одного из двух артефактов
    показал, что ни valid_capital_anchor_names, ни validate_capital_geography
    не видят рассинхрон МЕЖДУ ними, только каждая свой собственный источник)."""
    violations: list[str] = []
    by_country = {c["id"]: c for c in countries}
    for code, expected_id in overrides.items():
        country = by_country.get(code)
        if country is None:
            continue  # страна не активна в этом сценарии (напр. дрейф региона к нулю) -- не ошибка этой проверки
        actual_id = country.get("capitalRegionId")
        if actual_id != expected_id:
            violations.append(
                f"{code}: countries.json capitalRegionId={actual_id}, но "
                f"CAPITAL_REGION_OVERRIDES['{code}']={expected_id} -- countries.json "
                f"не пересобран после правки таблицы (прогони "
                f"scripts/map/generate_country_registry.py) или отредактирован "
                f"мимо генератора."
            )
    return violations


def main() -> int:
    core, state, names_en, names_ru = load_regions_layers()
    regions = combine_regions(core, state, names_en, names_ru)
    countries = load_json(COUNTRIES_PATH)
    catalog = load_resource_catalog()

    violations: list[str] = []
    warnings: list[str] = []

    violations.extend(validate_structural_invariants(regions, countries, catalog, names_en, names_ru))

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

    # 14. capitalRegionId резолвится в регион с ОЖИДАЕМЫМ ИМЕНЕМ И владельцем
    # (не самим id — см. docstring economy_1946/capital_overrides.py и
    # .agent/plans/capital-region-invariant.md). Ловит позиционный дрейф id,
    # который invariant 11 (capital принадлежит региону СТРАНЫ) пропускает,
    # когда id после регенерации указывает на ДРУГОЙ регион ТОЙ ЖЕ страны.
    violations.extend(validate_capital_anchor_names(regions, CAPITAL_REGION_OVERRIDES, CAPITAL_REGION_ANCHOR_NAMES))

    # 15. capitalRegionId резолвится в регион, чей полигон СОДЕРЖИТ реальную
    # географическую точку столицы — самый сильный якорь (не id, не имя),
    # но охватывает только страны с курированными координатами в
    # generateMapFeatures.ts (см. economy_1946/capital_geography.py).
    # Возвращает (violations, warnings, checked) — "точка не в полигоне"
    # не нарушение, но и не тишина (см. docstring validate_capital_geography).
    # checked — ЯВНЫЙ счётчик фактически проверенных якорей (не арифметика
    # по разности len(capital_anchors) - len(warnings): страна, отсутствующая
    # в countries.json, не даёт ни violation, ни warning и при вычитании
    # молча засчиталась бы в "covered", хотя проверки для неё не было —
    # 2026-07-26, независимое ревью, находка 1).
    capital_anchors = load_ts_capital_anchors()
    region_geometries = load_region_geometries()
    geo_violations, geo_warnings, geo_checked = validate_capital_geography(
        countries, capital_anchors, region_geometries
    )
    violations.extend(geo_violations)

    # 16. countries.json (сгенерированный артефакт) в синхроне с CAPITAL_REGION_
    # OVERRIDES (источник) — для ВСЕХ живых записей, не только 13 с
    # географическим якорем. Без неё invariant 14 (проверяет таблицу) и
    # invariant 15 (проверяет countries.json, но только 13 стран) могут оба
    # молчать, если countries.json не пересобран после правки таблицы.
    violations.extend(validate_capital_override_applied(countries, CAPITAL_REGION_OVERRIDES))

    # Отчёт
    print(f"Регионов: {len(regions)}, стран/владельцев: {len(by_owner)}")
    for w in warnings:
        print(f"  [ok] {w}")
    covered = geo_checked - len(geo_warnings)
    skipped_note = ""
    if geo_checked < len(capital_anchors):
        skipped_note = (
            f" ({len(capital_anchors) - geo_checked} якорь(я) пропущено — страна отсутствует "
            f"в countries.json, см. invariant 10/11 выше на причину)"
        )
    print(f"  [ok] Географическое покрытие invariant 15: {covered}/{geo_checked} фактически "
          f"проверенных якорей попали в известный полигон{skipped_note} "
          f"(остальные см. [warn] ниже).")
    for w in geo_warnings:
        print(f"  [warn] {w}")

    if violations:
        print(f"\nНАРУШЕНИЯ ({len(violations)}):")
        for v in violations:
            print(f"  [FAIL] {v}")
        return 1

    print("\nВсе проверки пройдены чисто.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
