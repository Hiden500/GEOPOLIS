#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверяет инварианты трёх новых слоёв сценария 1946 — демо-состава регионов и
координат идеологии (docs/CONCEPT.md §4.1/§4.2, docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md):

    server/data/scenarios/1946/groups.json        — каталог демо-групп
    server/data/scenarios/1946/demographics.json  — доли групп по регионам
    server/data/scenarios/1946/ideology.json      — координаты идеологии стран

Покрытие РЕГИОНОВ сознательно частичное: размечены не все 1399 регионов. Регион
без записи — «неразмечен» (движок не выводит для него недовольство). Это
штатное состояние, а не нарушение.

Покрытие СТРАН, наоборот, обязано быть полным (с 2026-07-27): координаты есть у
каждой страны сценария, поэтому фолбэк «нет координат — читаем ярлык»
(shared/src/utils/discontent.ts) для 1946 больше не должен срабатывать ни разу.
Проверяется как свойство «у каждой страны countries.json есть запись в
ideology.json», а не сравнением с числом 157.

Сверх этого валидатор держит инвариант «ярлык — производное от координат»:
politics.ideology каждой страны обязан совпадать с зоной, в которую попадают её
координаты (scripts/map/ideology_zones.py). Без этой проверки два файла
разъезжаются молча при первой же правке координат без перегенерации реестра —
ровно та ловушка, из-за которой ярлык и перестал быть авторским полем.

Дублирует (намеренно) инварианты Zod-схемы загрузки
(server/src/scenarios/scenario1946Schemas.ts): схема ловит их в рантайме игры,
этот скрипт — до запуска, вместе с остальными data-проверками пайплайна.

Запуск: python scripts/map/validate_demographics_1946.py
Exit code 0 — нарушений нет, 1 — есть.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import SCENARIO_DIR, load_json
from ideology_zones import ZONE_ANCHORS, zone_for

GROUPS_PATH = SCENARIO_DIR / "groups.json"
DEMOGRAPHICS_PATH = SCENARIO_DIR / "demographics.json"
IDEOLOGY_PATH = SCENARIO_DIR / "ideology.json"
REGIONS_CORE_PATH = SCENARIO_DIR / "regions.core.json"
COUNTRIES_PATH = SCENARIO_DIR / "countries.json"
DISCONTENT_TS_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "defines" / "discontent.ts"
)

# Доминант + до 3 меньшинств (docs/CONCEPT.md §4.1 — «лёгкий демо-состав»,
# не Victoria-pops).
MAX_GROUPS_PER_REGION = 4
SHARE_SUM_TOLERANCE = 0.001
AXIS_MIN = -1.0
AXIS_MAX = 1.0
# Два знака после запятой (решение реализации среза) — сравнение через
# умножение на 100, чтобы не ловить артефакты двоичной дроби.
AXIS_DECIMALS = 2


def _axis_violations(label: str, coords: dict) -> list[str]:
    out: list[str] = []
    for axis in ("economic", "political"):
        if axis not in coords:
            out.append(f"{label}: нет оси '{axis}'")
            continue
        value = coords[axis]
        if not isinstance(value, (int, float)):
            out.append(f"{label}: ось '{axis}' не число ({value!r})")
            continue
        if not (AXIS_MIN <= value <= AXIS_MAX):
            out.append(f"{label}: ось '{axis}' = {value} вне диапазона [{AXIS_MIN}, {AXIS_MAX}]")
        scaled = value * (10 ** AXIS_DECIMALS)
        if abs(scaled - round(scaled)) > 1e-6:
            out.append(f"{label}: ось '{axis}' = {value} — больше {AXIS_DECIMALS} знаков после запятой")
    return out


def validate(groups: dict, demographics: dict, ideology: dict,
             region_ids: set, countries: list) -> list[str]:
    """Инварианты трёх слоёв. Работает на любых данных (в т.ч. синтетических),
    не завязан на конкретно сценарий 1946 — кроме множества существующих
    region_id и списка стран.

    `countries` — записи countries.json целиком (не только id): из них берётся
    и множество существующих стран, и ярлык politics.ideology для сверки с
    координатами. Пустой список выключает страновые проверки — так синтетическая
    фикстура может проверять только слой регионов."""
    violations: list[str] = []
    country_ids = {c.get("id") for c in countries}

    # --- groups.json ---
    group_entries = groups.get("groups", [])
    known_group_ids: set = set()
    for entry in group_entries:
        gid = entry.get("id")
        if not gid:
            violations.append(f"groups.json: запись без id ({entry!r})")
            continue
        if gid in known_group_ids:
            violations.append(f"groups.json: дубль группы '{gid}'")
        known_group_ids.add(gid)

        names = entry.get("names") or {}
        if not names.get("en"):
            violations.append(f"groups.json: группа '{gid}' без английского имени")
        violations.extend(_axis_violations(f"groups.json/{gid}", entry.get("desiredIdeology") or {}))

    # --- demographics.json ---
    seen_regions: set = set()
    for entry in demographics.get("regions", []):
        rid = entry.get("regionId")
        if rid is None:
            violations.append(f"demographics.json: запись без regionId ({entry!r})")
            continue
        if rid in seen_regions:
            violations.append(f"demographics.json: дубль региона {rid}")
        seen_regions.add(rid)
        if region_ids and rid not in region_ids:
            violations.append(f"demographics.json: регион {rid} не существует в сценарии")

        shares = entry.get("groups", [])
        if not shares:
            violations.append(f"demographics.json: регион {rid} без групп (пустая запись бессмысленна)")
            continue
        if len(shares) > MAX_GROUPS_PER_REGION:
            violations.append(
                f"demographics.json: регион {rid} — {len(shares)} групп, максимум {MAX_GROUPS_PER_REGION}"
            )

        seen_in_region: set = set()
        total = 0.0
        for share_entry in shares:
            gid = share_entry.get("groupId")
            share = share_entry.get("share")
            if gid not in known_group_ids:
                violations.append(f"demographics.json: регион {rid} ссылается на неизвестную группу '{gid}'")
            if gid in seen_in_region:
                violations.append(f"demographics.json: регион {rid} — дубль группы '{gid}'")
            seen_in_region.add(gid)
            if not isinstance(share, (int, float)) or not (0 < share <= 1):
                violations.append(f"demographics.json: регион {rid}, группа '{gid}' — доля {share!r} вне (0, 1]")
                continue
            total += share
        if abs(total - 1.0) > SHARE_SUM_TOLERANCE:
            violations.append(
                f"demographics.json: регион {rid} — сумма долей {total:.4f}, ожидается 1.0 ± {SHARE_SUM_TOLERANCE}"
            )

    # --- ideology.json ---
    coordinates_by_country: dict = {}
    seen_countries: set = set()
    for entry in ideology.get("countries", []):
        cid = entry.get("countryId")
        if not cid:
            violations.append(f"ideology.json: запись без countryId ({entry!r})")
            continue
        if cid in seen_countries:
            violations.append(f"ideology.json: дубль страны '{cid}'")
        seen_countries.add(cid)
        if country_ids and cid not in country_ids:
            violations.append(f"ideology.json: страна '{cid}' не существует в сценарии")
        axis_violations = _axis_violations(f"ideology.json/{cid}", entry)
        violations.extend(axis_violations)
        if not axis_violations:
            coordinates_by_country[cid] = (entry["economic"], entry["political"])

    # Полное покрытие: свойство «у каждой страны есть координаты», а не
    # сравнение с числом стран — следующее наполнение сценария не должно
    # требовать правки валидатора.
    for cid in sorted(country_ids - seen_countries):
        violations.append(
            f"ideology.json: у страны '{cid}' нет координат — покрытие обязано быть полным"
        )

    # Ярлык — производное от координат (scripts/map/ideology_zones.py).
    # Расхождение означает, что countries.json собран из другой версии
    # config/ideology_1946.json, чем ideology.json.
    for country in countries:
        cid = country.get("id")
        coords = coordinates_by_country.get(cid)
        if coords is None:
            continue
        label = (country.get("politics") or {}).get("ideology")
        expected = zone_for(*coords)
        if label != expected:
            violations.append(
                f"countries.json: у страны '{cid}' ярлык politics.ideology = {label!r}, "
                f"а координаты {coords} лежат в зоне {expected!r} — "
                "перегенерируй реестр (scripts/map/generate_country_registry.py)"
            )

    return violations


def zone_anchor_parity_violations() -> list[str]:
    """Каталог зон продублирован в двух языках намеренно: TS-таблица
    IDEOLOGY_LABEL_COORDINATES читается движком (ярлык -> координаты, фолбэк),
    Python-таблица ZONE_ANCHORS — генераторами (координаты -> ярлык). Пока это
    один и тот же каталог, прямой и обратный ход согласованы; разъедутся —
    ярлыки в данных перестанут соответствовать тому, как их понимает движок.

    Разбор TS регуляркой, а не импортом: тащить node в data-валидатор ради
    пяти пар чисел дороже, чем прочитать литерал (тот же приём, что у
    остального пайплайна для TS/Python-каталогов)."""
    if not DISCONTENT_TS_PATH.exists():
        return [f"{DISCONTENT_TS_PATH.name}: файл не найден — каталог зон не с чем сверить"]
    text = DISCONTENT_TS_PATH.read_text(encoding="utf-8")
    block = re.search(
        r"IDEOLOGY_LABEL_COORDINATES[^=]*=\s*\{(.*?)\}\s*;", text, re.DOTALL
    )
    if not block:
        return [f"{DISCONTENT_TS_PATH.name}: не найден литерал IDEOLOGY_LABEL_COORDINATES"]
    ts_anchors = {
        m.group(1): (float(m.group(2)), float(m.group(3)))
        for m in re.finditer(
            r'"([^"]+)":\s*\{\s*economic:\s*(-?[\d.]+),\s*political:\s*(-?[\d.]+)\s*\}',
            block.group(1),
        )
    }
    if ts_anchors == ZONE_ANCHORS:
        return []
    return [
        "каталог зон разъехался: ideology_zones.ZONE_ANCHORS "
        f"{sorted(ZONE_ANCHORS.items())} != "
        f"{DISCONTENT_TS_PATH.name}:IDEOLOGY_LABEL_COORDINATES {sorted(ts_anchors.items())}"
    ]


def main() -> int:
    missing = [p.name for p in (GROUPS_PATH, DEMOGRAPHICS_PATH, IDEOLOGY_PATH) if not p.exists()]
    if missing:
        print(f"ОШИБКА: нет файлов {', '.join(missing)} — запусти scripts/map/generate_demographics_1946.py")
        return 1

    groups = load_json(GROUPS_PATH)
    demographics = load_json(DEMOGRAPHICS_PATH)
    ideology = load_json(IDEOLOGY_PATH)
    region_ids = {r["id"] for r in load_json(REGIONS_CORE_PATH)}
    countries = load_json(COUNTRIES_PATH)

    violations = validate(groups, demographics, ideology, region_ids, countries)
    violations.extend(zone_anchor_parity_violations())

    if violations:
        print(f"НАРУШЕНИЙ: {len(violations)}")
        for v in violations:
            print(f"  - {v}")
        return 1

    marked_regions = len(demographics.get("regions", []))
    marked_countries = len(ideology.get("countries", []))
    print(
        f"OK: групп {len(groups.get('groups', []))}, "
        f"размечено регионов {marked_regions}/{len(region_ids)} "
        f"(частичное покрытие — штатное состояние), "
        f"стран с координатами {marked_countries}/{len(countries)} "
        f"(покрытие полное, ярлыки сверены с координатами)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
