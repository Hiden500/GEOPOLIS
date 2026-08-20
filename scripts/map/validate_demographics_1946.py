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
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import SCENARIO_DIR, load_json
from ideology_zones import ZONE_ANCHORS, zone_for

GROUPS_PATH = SCENARIO_DIR / "groups.json"
DEMOGRAPHICS_PATH = SCENARIO_DIR / "demographics.json"
IDEOLOGY_PATH = SCENARIO_DIR / "ideology.json"
GOVERNMENT_PATH = SCENARIO_DIR / "government.json"
INFLUENCE_PATH = SCENARIO_DIR / "influence.json"
DIPLOMACY_PATH = SCENARIO_DIR / "diplomacy.json"
DIPLOMACY_TS_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "defines" / "diplomacy.ts"
)
#: Курируемые исторические факты — данные, не код (см. их `_meta`).
SPOT_CHECKS_PATH = Path(__file__).resolve().parent / "data" / "historical_spot_checks_1946.json"
DIPLOMACY_SPOT_CHECKS_PATH = (
    Path(__file__).resolve().parent / "data" / "diplomacy_spot_checks_1946.json"
)
REGIONS_CORE_PATH = SCENARIO_DIR / "regions.core.json"
COUNTRIES_PATH = SCENARIO_DIR / "countries.json"
DISCONTENT_TS_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "defines" / "discontent.ts"
)
GOVERNMENT_TS_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "src" / "types" / "politics" / "Government.ts"
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
             region_ids: set, countries: list, government: dict | None = None) -> list[str]:
    """Инварианты слоёв. Работает на любых данных (в т.ч. синтетических),
    не завязан на конкретно сценарий 1946 — кроме множества существующих
    region_id и списка стран.

    `countries` — записи countries.json целиком (не только id): из них берётся
    и множество существующих стран, ярлык politics.ideology для сверки с
    координатами и diplomacy.puppets для сверки с юридическим статусом. Пустой
    список выключает страновые проверки — так синтетическая фикстура может
    проверять только слой регионов.

    `government` — слой форм правления; `None` выключает его проверки (слой
    опционален так же, как на загрузке движком)."""
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

    # --- government.json ---
    if government is not None:
        ts_text = GOVERNMENT_TS_PATH.read_text(encoding="utf-8") if GOVERNMENT_TS_PATH.exists() else ""
        power_structures = _ts_const_list(ts_text, "POWER_STRUCTURES")
        statuses = _ts_const_list(ts_text, "SOVEREIGNTY_STATUSES")
        violations.extend(government_enum_violations(power_structures, statuses))
        violations.extend(government_violations(government, countries, power_structures, statuses))

    return violations


def _ts_const_list(text: str, name: str) -> list[str]:
    """Читает литерал `export const NAME = [...] as const` из TS-файла.

    Разбор регуляркой, а не импортом — тот же приём и та же причина, что у
    `zone_anchor_parity_violations` ниже: тащить node в data-валидатор ради
    списка строк дороже, чем прочитать литерал. Перечень при этом ОДИН
    (TS-файл), а не продублирован в Python — дублю было бы нечем помешать
    разъехаться."""
    block = re.search(rf"export const {name}\s*=\s*\[(.*?)\]\s*as const", text, re.DOTALL)
    if not block:
        return []
    return re.findall(r"'([^']+)'", block.group(1))


def government_enum_violations(power_structures: list, statuses: list) -> list[str]:
    """Перечни обязаны читаться: пустой список означает, что литерал в
    Government.ts переименован или переформатирован, а валидатор молча
    перестал проверять принадлежность значений."""
    out: list[str] = []
    if not power_structures:
        out.append(f"{GOVERNMENT_TS_PATH.name}: не найден литерал POWER_STRUCTURES")
    if not statuses:
        out.append(f"{GOVERNMENT_TS_PATH.name}: не найден литерал SOVEREIGNTY_STATUSES")
    return out


def government_violations(government: dict, countries: list,
                          power_structures: list, statuses: list) -> list[str]:
    """Инварианты слоя government.json и его непротиворечивость с diplomacy.puppets.

    Главное здесь — ПОСЛЕДНИЕ две проверки. Юридический статус и `puppets` —
    разные предикаты (разбор — shared/src/types/politics/Government.ts), их
    множества не равны и равными быть не обязаны. Но противоречить они не
    могут: марионетка не бывает юридически суверенной, и сюзерен, который её
    держит, обязан быть тем же, кого называет её собственная запись. Без этих
    двух проверок два представления зависимости расходятся молча — ровно то,
    ради чего слой и сводился.

    Обратное требование («несуверенный ⇒ марионетка») НЕ проверяется и не
    должно: зона оккупации и спорная администрация подчинены, но внешней
    политике сюзерена не следуют (см. NON_VASSAL_SUBORDINATION_STATUSES)."""
    violations: list[str] = []
    country_ids = {c.get("id") for c in countries}
    power_set, status_set = set(power_structures), set(statuses)

    seen: set = set()
    record_by_country: dict = {}
    for entry in government.get("countries", []):
        cid = entry.get("countryId")
        if not cid:
            violations.append(f"government.json: запись без countryId ({entry!r})")
            continue
        if cid in seen:
            violations.append(f"government.json: дубль страны '{cid}'")
        seen.add(cid)
        if country_ids and cid not in country_ids:
            violations.append(f"government.json: страна '{cid}' не существует в сценарии")
        record_by_country[cid] = entry

        structure = entry.get("powerStructure")
        if power_set and structure not in power_set:
            violations.append(
                f"government.json: у '{cid}' powerStructure = {structure!r} вне перечня POWER_STRUCTURES"
            )
        status = entry.get("sovereigntyStatus")
        if status_set and status not in status_set:
            violations.append(
                f"government.json: у '{cid}' sovereigntyStatus = {status!r} вне перечня SOVEREIGNTY_STATUSES"
            )

        overlords = entry.get("overlordIds")
        if not isinstance(overlords, list):
            violations.append(f"government.json: у '{cid}' overlordIds не список ({overlords!r})")
            continue
        if len(set(overlords)) != len(overlords):
            violations.append(f"government.json: у '{cid}' дубль в overlordIds {overlords!r}")
        if cid in overlords:
            violations.append(f"government.json: '{cid}' назначен сюзереном самому себе")
        for oid in overlords:
            if country_ids and oid not in country_ids:
                violations.append(
                    f"government.json: у '{cid}' сюзерен '{oid}' не существует в сценарии"
                )

        # Форма подчинения обязана соответствовать статусу: суверен без
        # сюзерена, кондоминиум ровно с двумя, остальные зависимые — ровно с
        # одним. Иначе «зависимость» перестаёт быть проверяемой.
        if status == "sovereign":
            if overlords:
                violations.append(f"government.json: суверенный '{cid}' имеет сюзерена {overlords!r}")
        elif status == "condominium":
            if len(overlords) != 2:
                violations.append(
                    f"government.json: кондоминиум '{cid}' имеет {len(overlords)} сюзеренов, ожидается 2"
                )
        elif status in status_set:
            if len(overlords) != 1:
                violations.append(
                    f"government.json: зависимый '{cid}' (статус {status!r}) имеет "
                    f"{len(overlords)} сюзеренов, ожидается 1"
                )

    # Покрытие полное — свойством, а не сравнением с числом стран.
    for cid in sorted(country_ids - seen):
        violations.append(
            f"government.json: у страны '{cid}' нет записи — покрытие обязано быть полным"
        )

    # --- непротиворечивость с diplomacy.puppets ---
    for country in countries:
        suzerain = country.get("id")
        for subject in (country.get("diplomacy") or {}).get("puppets", []):
            record = record_by_country.get(subject)
            if record is None:
                continue
            if record.get("sovereigntyStatus") == "sovereign":
                violations.append(
                    f"противоречие: '{subject}' — марионетка '{suzerain}' в countries.json, "
                    f"но sovereigntyStatus = 'sovereign' в government.json"
                )
            overlords = record.get("overlordIds") or []
            if suzerain not in overlords:
                violations.append(
                    f"противоречие: '{subject}' — марионетка '{suzerain}' в countries.json, "
                    f"а её overlordIds = {overlords!r} — сюзерен не совпадает"
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



#: Границы шкалы влияния. Дублируют server/src/scenarios/scenario1946Schemas.ts
#: (INFLUENCE_MIN_RECORDED) и shared/src/defines/diplomacy.ts намеренно: там
#: проверка на загрузке игры, здесь — до запуска, вместе с остальным пайплайном.
INFLUENCE_MIN_RECORDED = 10
INFLUENCE_SCALE_MAX = 100


def influence_violations(influence: dict, country_ids: set) -> list[str]:
    """Инварианты слоя влияния (`influence.json`).

    Влияние направленное и разреженное: отсутствие связи выражается отсутствием
    ключа, а не нулём. Значение ниже INFLUENCE_MIN_RECORDED запрещено, потому
    что движок не отличает такую связь от её отсутствия — запись существовала
    бы только чтобы никем не читаться.
    """
    violations: list[str] = []
    seen_sources: set = set()

    for entry in influence.get("influence", []):
        source = entry.get("sourceCountryId")
        if not source:
            violations.append(f"influence.json: запись без sourceCountryId ({entry!r})")
            continue
        if source in seen_sources:
            violations.append(f"influence.json: дубль источника '{source}'")
        seen_sources.add(source)
        if country_ids and source not in country_ids:
            violations.append(f"influence.json: страна-источник '{source}' не существует в сценарии")

        targets = entry.get("targets") or {}
        if not targets:
            violations.append(f"influence.json: источник '{source}' без единой цели")
        for target, value in targets.items():
            if country_ids and target not in country_ids:
                violations.append(
                    f"influence.json: '{source}' влияет на несуществующую страну '{target}'"
                )
            if target == source:
                violations.append(f"influence.json: '{source}' влияет сам на себя")
            if not isinstance(value, int) or isinstance(value, bool):
                violations.append(f"influence.json: '{source}' -> '{target}' — значение {value!r} не целое")
            elif not (INFLUENCE_MIN_RECORDED <= value <= INFLUENCE_SCALE_MAX):
                violations.append(
                    f"influence.json: '{source}' -> '{target}' — {value} вне "
                    f"[{INFLUENCE_MIN_RECORDED}, {INFLUENCE_SCALE_MAX}]"
                )
    return violations


def layer_sync_report(region_ids: set, country_ids: set, demographics: dict,
                      ideology: dict, government: dict | None,
                      influence: dict | None) -> tuple[list[str], list[str]]:
    """Сверка слоёв с текущим составом карты.

    Возвращает (потерянные, неразмеченные). РАЗНИЦА МЕЖДУ НИМИ ПРИНЦИПИАЛЬНА:

    - «потерянные» — слой ссылается на регион или страну, которых на карте
      больше нет. Это ОШИБКА: загрузка сценария падает ScenarioDataError, и
      партия не запускается вовсе (server/src/scenarios/Scenario1946.ts).
    - «неразмеченные» — на карте есть объект, которого нет в слое. Это штатное
      частичное покрытие: регион без демографии просто не даёт недовольства.

    Функция существует ради правок КАРТЫ: состав регионов меняется отдельной
    работой, и рассинхрон обнаруживается либо здесь, либо падением игры.
    """
    lost: list[str] = []
    unmarked: list[str] = []

    demo_ids = {e.get("regionId") for e in demographics.get("regions", [])}
    lost += [f"demographics.json: регион {r} исчез с карты" for r in sorted(demo_ids - region_ids, key=str)]
    unmarked += [f"регион {r} без демографии" for r in sorted(region_ids - demo_ids, key=str)]

    ideo_ids = {e.get("countryId") for e in ideology.get("countries", [])}
    lost += [f"ideology.json: страна '{c}' исчезла из ростера" for c in sorted(ideo_ids - country_ids, key=str)]
    unmarked += [f"страна '{c}' без координат идеологии" for c in sorted(country_ids - ideo_ids, key=str)]

    if government is not None:
        gov_entries = government.get("countries", [])
        gov_ids = {e.get("countryId") for e in gov_entries}
        lost += [f"government.json: страна '{c}' исчезла из ростера" for c in sorted(gov_ids - country_ids, key=str)]
        unmarked += [f"страна '{c}' без формы правления" for c in sorted(country_ids - gov_ids, key=str)]
        overlords = {o for e in gov_entries for o in (e.get("overlordIds") or [])}
        lost += [
            f"government.json: сюзерен '{o}' исчез из ростера" for o in sorted(overlords - country_ids, key=str)
        ]

    if influence is not None:
        entries = influence.get("influence", [])
        sources = {e.get("sourceCountryId") for e in entries}
        targets = {t for e in entries for t in (e.get("targets") or {})}
        lost += [f"influence.json: источник '{c}' исчез из ростера" for c in sorted(sources - country_ids, key=str)]
        lost += [f"influence.json: цель '{c}' исчезла из ростера" for c in sorted(targets - country_ids, key=str)]

    return lost, unmarked



# ---------------------------------------------------------------------------
# УРОВНИ. ERROR блокирует приёмку данных, WARNING требует просмотра человеком.
#
# Смешивать нельзя: эвристики правдоподобия ошибаются по построению — они ищут
# ПОДОЗРИТЕЛЬНОЕ, а не неверное. Эвристика, способная заблокировать корректные
# данные, будет отключена при первом ложном срабатывании, и вместе с ней
# исчезнут настоящие находки.
# ---------------------------------------------------------------------------


def historical_spot_check_violations(demographics: dict, checks: dict | None = None) -> list[str]:
    """
    Проверка по курируемым историческим фактам (ERROR).

    Главная сеть против галлюцинаций: остальные проверки ловят формальную
    поломку — сумму долей, ссылку в пустоту, — а правдоподобно выдуманный состав
    проходит их все. Здесь сверяются заведомо известные факты.

    Запись, чей регион не размечен, ПРОПУСКАЕТСЯ: покрытие слоя — предмет
    отдельной проверки, и падать здесь второй раз значит удваивать один сигнал.
    """
    if checks is None:
        checks = load_json(SPOT_CHECKS_PATH) if SPOT_CHECKS_PATH.exists() else {"checks": []}

    by_region = {entry.get("regionId"): entry for entry in demographics.get("regions", [])}
    violations: list[str] = []

    for check in checks.get("checks", []):
        cid = check.get("id", "?")
        predicate = check.get("assert")
        why = check.get("why", "")
        for region_id in check.get("regions", []):
            entry = by_region.get(region_id)
            if entry is None:
                continue
            shares = {g.get("groupId"): g.get("share", 0) for g in entry.get("groups", [])}
            if not shares:
                continue
            dominant = max(shares, key=lambda gid: shares[gid])
            named = check.get("groups") or []

            if predicate == "dominantGroupIs":
                expected = check.get("group")
                if dominant != expected:
                    violations.append(
                        "спот-чек {0}: регион {1} — доминант {2}, ожидался {3} ({4})".format(
                            cid, region_id, dominant, expected, why))
            elif predicate == "dominantGroupNotIn":
                if dominant in named:
                    violations.append(
                        "спот-чек {0}: регион {1} — доминант {2}, чего быть не должно ({3})".format(
                            cid, region_id, dominant, why))
            elif predicate == "groupShareAtLeast":
                total = sum(shares.get(gid, 0) for gid in named)
                floor = check.get("minShare", 0)
                if total < floor:
                    violations.append(
                        "спот-чек {0}: регион {1} — доля {2:.2f} ниже минимума {3} ({4})".format(
                            cid, region_id, total, floor, why))
            elif predicate == "groupShareAtMost":
                total = sum(shares.get(gid, 0) for gid in named)
                ceiling = check.get("maxShare", 1)
                if total > ceiling:
                    violations.append(
                        "спот-чек {0}: регион {1} — доля {2:.2f} выше максимума {3} ({4})".format(
                            cid, region_id, total, ceiling, why))
            elif predicate == "groupPresent":
                absent = [gid for gid in named if gid not in shares]
                if absent:
                    violations.append(
                        "спот-чек {0}: регион {1} — отсутствуют группы {2} ({3})".format(
                            cid, region_id, absent, why))
            else:
                violations.append(
                    "спот-чек {0}: неизвестный предикат {1}".format(cid, predicate))

    return violations


def spot_check_catalog_violations(checks: dict, known_group_ids: set) -> list[str]:
    """Набор фактов не должен ссылаться на группы, которых нет в каталоге."""
    violations: list[str] = []
    for check in checks.get("checks", []):
        named = list(check.get("groups") or [])
        if check.get("group"):
            named.append(check["group"])
        for gid in named:
            if gid not in known_group_ids:
                violations.append(
                    "спот-чек {0}: группа {1} отсутствует в groups.json".format(
                        check.get("id", "?"), gid))
    return violations


#: Доля считается круглой, если кратна этому шагу. 0.05, а не 0.01: округление до
#: сотых естественно и само по себе ни о чём не говорит.
ROUND_SHARE_STEP = 0.05


def _is_round(share: float) -> bool:
    scaled = round(share * 100)
    return abs(share * 100 - scaled) < 1e-6 and scaled % round(ROUND_SHARE_STEP * 100) == 0


def plausibility_warnings(demographics: dict, region_core: list) -> list[str]:
    """
    Эвристики правдоподобия (WARNING).

    Каждая откалибрована на фактических данных так, чтобы давать обозримый
    список, а не поток. Отброшено намеренно: «группа встречается один раз во всём
    мире» — таких 99 из 460, они утопили бы остальное и выносятся отдельной
    секцией; «выброс доли относительно соседей» — без порога даёт сотни
    срабатываний, с порогом превращается в подгонку под текущие данные.
    """
    warnings: list[str] = []
    regions = demographics.get("regions", [])
    neighbours = {r["id"]: (r.get("landNeighboringRegionIds") or []) for r in region_core}
    by_region = {r.get("regionId"): r for r in regions}

    for entry in regions:
        rid = entry.get("regionId")
        groups = entry.get("groups") or []
        if not groups:
            continue
        shares = [g.get("share", 0) for g in groups]

        # 1. Все доли круглые — признак назначенного, а не оценённого состава.
        if len(groups) > 1 and all(_is_round(s) for s in shares):
            warnings.append(
                "регион {0}: все доли кратны {1} — состав выглядит назначенным, а не оценённым".format(
                    rid, ROUND_SHARE_STEP))

        # 2. Единственная группа. Бывает (изолированный остров), но 100% почти
        #    всегда означает «не стали разбираться».
        if len(groups) == 1:
            warnings.append(
                "регион {0}: единственная группа {1} с долей 1.0".format(
                    rid, groups[0].get("groupId")))

        # 3. Доминант не встречается ни у одного размеченного соседа. Анклав
        #    возможен, ошибка привязки региона вероятнее.
        dominant = max(groups, key=lambda g: g.get("share", 0)).get("groupId")
        near = set()
        for nid in neighbours.get(rid, []):
            neighbour = by_region.get(nid)
            if neighbour:
                near.update(g.get("groupId") for g in (neighbour.get("groups") or []))
        if near and dominant not in near:
            warnings.append(
                "регион {0}: доминант {1} не встречается ни у одного из {2} соседей".format(
                    rid, dominant, len(neighbours.get(rid, []))))

    return warnings


def single_use_groups(demographics: dict) -> list[str]:
    """
    Группы, встречающиеся ровно в одном регионе мира.

    Отдельно от остальных предупреждений намеренно: их около сотни, и в общем
    потоке они прячут единичные находки. Список полезен при просмотре каталога
    («эндемичная группа или артефакт генерации?»), но не как строка отчёта.
    """
    counts: dict = {}
    for entry in demographics.get("regions", []):
        for g in entry.get("groups") or []:
            gid = g.get("groupId")
            counts[gid] = counts.get(gid, 0) + 1
    return sorted(gid for gid, n in counts.items() if n == 1)



# ---------------------------------------------------------------------------
# ДИПЛОМАТИЧЕСКИЙ СЛОЙ (`diplomacy.json`).
#
# Слой опциональный, как остальные слои фундамента: файла нет — проверки не
# выполняются, и это штатное состояние. Но если файл есть, покрытие СТРАН
# полное по построению (все 157 существуют), поэтому отсутствие пары —
# утверждение «связи нет», а не пробел разметки.
#
# ГРАНИЦА С МЕХАНИКОЙ, НАЗВАННАЯ ПРЯМО. Пороги союза парные и считаются от
# идеологической дистанции (`allianceThreshold`, `allianceBreakThreshold` в
# server/src/simulation/diplomacy/affinity.ts). Воспроизводить эти формулы в
# Python нельзя: копия разойдётся с оригиналом при первой правке калибровки.
# Здесь проверяется только то, что верно при ЛЮБЫХ координатах — границы,
# которые формула не может пересечь. Точная сверка «этот союз выживет при этих
# координатах» — дело серверного теста по загруженному сценарию, где формула
# настоящая.
# ---------------------------------------------------------------------------


def _ts_const_number(text: str, name: str) -> float | None:
    """Читает `export const NAME = <число>` из TS-файла.

    Тот же приём и та же причина, что у `_ts_const_list`: число живёт в ОДНОМ
    месте (TS), а не продублировано здесь. Не прочиталось — вернётся None, и
    вызывающий обязан сделать из этого ошибку, а не тихо продолжить с
    захардкоженным значением.
    """
    match = re.search(rf"export const {name}\s*=\s*(-?[\d.]+)", text)
    return float(match.group(1)) if match else None


def _pair_key(a: str, b: str) -> tuple:
    """Ключ пары без направления: отношения взаимны, и (A,B) — та же связь,
    что (B,A). Дрейф ведёт ОБЕ стороны к одной цели (`driftRelations`), поэтому
    два разных стартовых числа на пару хранить бессмысленно."""
    return tuple(sorted((a, b)))


def diplomacy_thresholds(ts_text: str) -> tuple:
    """Границы, при которых стартовые данные обессмысливаются движком.

    `break_floor` — минимум порога распада союза по всей шкале идеологической
    дистанции: `ALLY_BREAK_THRESHOLD - ALLY_BREAK_IDEOLOGY_SPAN / 2`. Союз с
    отношениями ниже него распадётся на первом тике при ЛЮБЫХ координатах, то
    есть такие данные движок отменяет сразу.

    `break_ceiling` — тот же порог при максимальной дистанции; между ним и полом
    исход зависит от координат, и это уже предупреждение, а не ошибка.
    """
    names = (
        "RELATION_SCALE_MIN", "RELATION_SCALE_MAX",
        "ALLY_BREAK_THRESHOLD", "ALLY_BREAK_IDEOLOGY_SPAN",
        "RIVAL_RECONCILE_THRESHOLD",
    )
    values = {n: _ts_const_number(ts_text, n) for n in names}
    missing = sorted(n for n, v in values.items() if v is None)
    if missing:
        return (None, missing)
    span = values["ALLY_BREAK_IDEOLOGY_SPAN"]
    base = values["ALLY_BREAK_THRESHOLD"]
    return ({
        "scale_min": values["RELATION_SCALE_MIN"],
        "scale_max": values["RELATION_SCALE_MAX"],
        "break_floor": base - span / 2,
        "break_ceiling": base + span / 2,
        "rival_reconcile": values["RIVAL_RECONCILE_THRESHOLD"],
    }, [])


def _collect_pairs(entries: list, label: str, country_ids: set) -> tuple:
    """Общая часть разбора списка пар: ссылочная целостность, самопара, дубль."""
    out: list[str] = []
    seen: dict = {}
    for entry in entries or []:
        pair = entry.get("pair") or []
        if len(pair) != 2:
            out.append(f"{label}: запись {pair} — не пара из двух стран")
            continue
        a, b = pair
        for cid in (a, b):
            if cid not in country_ids:
                out.append(f"{label}: страна \"{cid}\" отсутствует в countries.json")
        if a == b:
            out.append(f"{label}: пара \"{a}\" сама с собой")
            continue
        key = _pair_key(a, b)
        if key in seen:
            out.append(f"{label}: пара {key[0]}—{key[1]} встречается дважды")
        seen[key] = entry
    return seen, out


def diplomacy_violations(diplomacy: dict, country_ids: set, ts_text: str) -> list[str]:
    """Инварианты дипломатического слоя (ERROR).

    Главный класс здесь — «данные, которые движок отменяет на первом тике».
    Союз без отношений и соперничество при тёплых отношениях формально
    допустимы, но `DiplomacyTick` снимает их немедленно: такая разметка
    описывает не мир, а собственное исчезновение.
    """
    thresholds, missing = diplomacy_thresholds(ts_text)
    if thresholds is None:
        return [
            f"{DIPLOMACY_TS_PATH.name}: не прочитаны константы {missing} — "
            "проверки дипломатии остались бы без границ"
        ]

    out: list[str] = []
    relations, rel_errors = _collect_pairs(diplomacy.get("relations"), "relations", country_ids)
    alliances, ally_errors = _collect_pairs(diplomacy.get("alliances"), "alliances", country_ids)
    rivalries, rival_errors = _collect_pairs(diplomacy.get("rivalries"), "rivalries", country_ids)
    out.extend(rel_errors + ally_errors + rival_errors)

    for key, entry in relations.items():
        value = entry.get("value")
        if not isinstance(value, (int, float)):
            out.append(f"relations: пара {key[0]}—{key[1]} без числового value")
            continue
        if not thresholds["scale_min"] <= value <= thresholds["scale_max"]:
            out.append(
                "relations: пара {0}—{1} со значением {2} вне шкалы [{3}, {4}]".format(
                    key[0], key[1], value,
                    thresholds["scale_min"], thresholds["scale_max"]))

    for key in alliances:
        if key in rivalries:
            out.append(
                f"пара {key[0]}—{key[1]} одновременно в alliances и rivalries")
        entry = relations.get(key)
        if entry is None:
            out.append(
                "alliances: пара {0}—{1} без записи в relations — отношения по "
                "умолчанию 0, союз распадётся на первом тике (порог распада не "
                "ниже {2})".format(key[0], key[1], thresholds["break_floor"]))
            continue
        value = entry.get("value")
        if isinstance(value, (int, float)) and value < thresholds["break_floor"]:
            out.append(
                "alliances: пара {0}—{1} при отношениях {2} — ниже минимума порога "
                "распада {3}, союз не выживет ни при каких координатах".format(
                    key[0], key[1], value, thresholds["break_floor"]))

    for key in rivalries:
        entry = relations.get(key)
        value = entry.get("value") if entry else 0
        if isinstance(value, (int, float)) and value > thresholds["rival_reconcile"]:
            out.append(
                "rivalries: пара {0}—{1} при отношениях {2} — выше порога примирения "
                "{3}, соперничество будет снято на первом тике".format(
                    key[0], key[1], value, thresholds["rival_reconcile"]))

    for entry in diplomacy.get("guarantees") or []:
        guarantor = entry.get("guarantor")
        protected = entry.get("protected")
        for cid in (guarantor, protected):
            if cid not in country_ids:
                out.append(f"guarantees: страна \"{cid}\" отсутствует в countries.json")
        if guarantor == protected:
            out.append(f"guarantees: \"{guarantor}\" гарантирует сама себе")

    return out


def diplomacy_warnings(diplomacy: dict, ts_text: str) -> list[str]:
    """Правдоподобие дипломатического слоя (WARNING)."""
    thresholds, missing = diplomacy_thresholds(ts_text)
    if thresholds is None:
        return []

    out: list[str] = []
    relations = {}
    for entry in diplomacy.get("relations") or []:
        pair = entry.get("pair") or []
        if len(pair) == 2 and pair[0] != pair[1]:
            relations[_pair_key(pair[0], pair[1])] = entry

    for entry in diplomacy.get("alliances") or []:
        pair = entry.get("pair") or []
        if len(pair) != 2:
            continue
        key = _pair_key(pair[0], pair[1])
        value = (relations.get(key) or {}).get("value")
        if not isinstance(value, (int, float)):
            continue
        if thresholds["break_floor"] <= value < thresholds["break_ceiling"]:
            out.append(
                "alliances: союз {0}—{1} при отношениях {2} выживет только у "
                "идеологически близких (порог распада {3}…{4}) — распад задуман?".format(
                    key[0], key[1], value,
                    thresholds["break_floor"], thresholds["break_ceiling"]))

    values = [
        e.get("value") for e in (diplomacy.get("relations") or [])
        if isinstance(e.get("value"), (int, float))
    ]
    for entry in diplomacy.get("relations") or []:
        value = entry.get("value")
        pair = entry.get("pair") or ["?", "?"]
        if value in (thresholds["scale_min"], thresholds["scale_max"]):
            out.append(
                "relations: пара {0}—{1} на самом краю шкалы ({2}) — назначено, "
                "а не оценено".format(pair[0], pair[1], value))

    if values and len(values) > 1 and all(v % 5 == 0 for v in values):
        out.append(
            "relations: все {0} значений кратны 5 — набор выглядит назначенным, "
            "а не оценённым".format(len(values)))

    return out


def diplomacy_spot_check_violations(
    diplomacy: dict, checks: dict, country_ids: set
) -> list[str]:
    """Проверка дипломатии по курируемым историческим фактам (ERROR).

    Отсутствие пары в данных — не пропуск, а утверждение «связи нет»: страны
    существуют все, поэтому факт, требующий союза, падает на его отсутствии.
    Это отличие от демографии, где неразмеченный регион пропускается.
    """
    out: list[str] = []
    relations = {}
    for entry in diplomacy.get("relations") or []:
        pair = entry.get("pair") or []
        if len(pair) == 2:
            relations[_pair_key(pair[0], pair[1])] = entry.get("value")
    alliances = set()
    for entry in diplomacy.get("alliances") or []:
        pair = entry.get("pair") or []
        if len(pair) == 2:
            alliances.add(_pair_key(pair[0], pair[1]))

    for check in checks.get("checks", []):
        cid = check.get("id", "?")
        predicate = check.get("assert")
        why = check.get("why", "")
        pair = check.get("pair") or []
        key = _pair_key(pair[0], pair[1]) if len(pair) == 2 else None

        if predicate == "alliedPair":
            if key not in alliances:
                out.append(
                    "спот-чек {0}: союз {1}—{2} отсутствует в данных ({3})".format(
                        cid, pair[0], pair[1], why))
        elif predicate == "notAlliedPair":
            if key in alliances:
                out.append(
                    "спот-чек {0}: союз {1}—{2} присутствует, хотя его не было ({3})".format(
                        cid, pair[0], pair[1], why))
        elif predicate == "relationAtLeast":
            value = relations.get(key)
            floor = check.get("minValue", 0)
            if value is None:
                out.append(
                    "спот-чек {0}: нет отношений {1}—{2}, ожидалось не ниже {3} ({4})".format(
                        cid, pair[0], pair[1], floor, why))
            elif value < floor:
                out.append(
                    "спот-чек {0}: отношения {1}—{2} равны {3}, ожидалось не ниже {4} ({5})".format(
                        cid, pair[0], pair[1], value, floor, why))
        elif predicate == "relationAtMost":
            value = relations.get(key)
            ceiling = check.get("maxValue", 0)
            if value is None:
                out.append(
                    "спот-чек {0}: нет отношений {1}—{2}, ожидалось не выше {3} ({4})".format(
                        cid, pair[0], pair[1], ceiling, why))
            elif value > ceiling:
                out.append(
                    "спот-чек {0}: отношения {1}—{2} равны {3}, ожидалось не выше {4} ({5})".format(
                        cid, pair[0], pair[1], value, ceiling, why))
        elif predicate == "mutuallyPositive":
            group = check.get("group") or []
            for i, a in enumerate(group):
                for b in group[i + 1:]:
                    value = relations.get(_pair_key(a, b))
                    if value is not None and value < 0:
                        out.append(
                            "спот-чек {0}: отношения {1}—{2} отрицательны ({3}) ({4})".format(
                                cid, a, b, value, why))
        else:
            out.append(f"спот-чек {cid}: неизвестный предикат {predicate}")

    return out


def diplomacy_spot_check_catalog_violations(checks: dict, country_ids: set) -> list[str]:
    """Набор фактов не должен ссылаться на страны вне ростера — иначе он молча
    перестаёт проверять то, что заявляет."""
    out: list[str] = []
    for check in checks.get("checks", []):
        named = list(check.get("pair") or []) + list(check.get("group") or [])
        for cid in named:
            if cid not in country_ids:
                out.append(
                    "спот-чек {0}: страна {1} отсутствует в countries.json".format(
                        check.get("id", "?"), cid))
    return out


def main() -> int:
    missing = [
        p.name
        for p in (GROUPS_PATH, DEMOGRAPHICS_PATH, IDEOLOGY_PATH, GOVERNMENT_PATH)
        if not p.exists()
    ]
    if missing:
        print(f"ОШИБКА: нет файлов {', '.join(missing)} — запусти scripts/map/generate_demographics_1946.py")
        return 1

    groups = load_json(GROUPS_PATH)
    demographics = load_json(DEMOGRAPHICS_PATH)
    ideology = load_json(IDEOLOGY_PATH)
    government = load_json(GOVERNMENT_PATH)
    # Слой влияния появился позже остальных; отсутствие файла — «слоя нет»,
    # как и на загрузке движком, а не отказ валидатора.
    influence = load_json(INFLUENCE_PATH) if INFLUENCE_PATH.exists() else None
    region_ids = {r["id"] for r in load_json(REGIONS_CORE_PATH)}
    countries = load_json(COUNTRIES_PATH)
    country_ids = {c.get("id") for c in countries}

    region_core = load_json(REGIONS_CORE_PATH)
    spot_checks = load_json(SPOT_CHECKS_PATH) if SPOT_CHECKS_PATH.exists() else {"checks": []}
    known_group_ids = {g.get("id") for g in groups.get("groups", [])}

    violations = validate(groups, demographics, ideology, region_ids, countries, government)
    violations.extend(zone_anchor_parity_violations())
    if influence is not None:
        violations.extend(influence_violations(influence, country_ids))
    # Курируемые факты — ERROR: правдоподобно выдуманный состав проходит все
    # формальные проверки, и это единственная сеть против него.
    violations.extend(historical_spot_check_violations(demographics, spot_checks))
    violations.extend(spot_check_catalog_violations(spot_checks, known_group_ids))

    # Дипломатический слой. Отсутствие файла — «слоя нет», но об этом сказано
    # вслух: молчание сделало бы «не проверено» неотличимым от «проверено чисто».
    diplomacy = load_json(DIPLOMACY_PATH) if DIPLOMACY_PATH.exists() else None
    diplomacy_checks = (
        load_json(DIPLOMACY_SPOT_CHECKS_PATH)
        if DIPLOMACY_SPOT_CHECKS_PATH.exists() else {"checks": []}
    )
    diplomacy_ts = (
        DIPLOMACY_TS_PATH.read_text(encoding="utf-8") if DIPLOMACY_TS_PATH.exists() else ""
    )
    if diplomacy is not None:
        violations.extend(diplomacy_violations(diplomacy, country_ids, diplomacy_ts))
        violations.extend(
            diplomacy_spot_check_violations(diplomacy, diplomacy_checks, country_ids)
        )
        violations.extend(
            diplomacy_spot_check_catalog_violations(diplomacy_checks, country_ids)
        )

    # Сверка с составом карты. «Потерянные» — ошибка (загрузка партии упадёт),
    # «неразмеченные» — штатное частичное покрытие, показывается по флагу.
    lost, unmarked = layer_sync_report(
        region_ids, country_ids, demographics, ideology, government, influence
    )
    violations.extend(lost)

    warnings = plausibility_warnings(demographics, region_core)
    if diplomacy is not None:
        warnings.extend(diplomacy_warnings(diplomacy, diplomacy_ts))
    singles = single_use_groups(demographics)

    report_path = None
    if "--json" in sys.argv:
        index = sys.argv.index("--json")
        if index + 1 < len(sys.argv):
            report_path = Path(sys.argv[index + 1])

    if report_path is not None:
        # Машиночитаемый отчёт пишется ВСЕГДА, а не только при ошибках: обработчику
        # нужен и чистый прогон, иначе «нет файла» и «нет проблем» неразличимы.
        report = {
            "errors": violations,
            "warnings": warnings,
            "singleUseGroups": singles,
            "counts": {
                "errors": len(violations),
                "warnings": len(warnings),
                "regionsMarked": len(demographics.get("regions", [])),
                "regionsTotal": len(region_ids),
                "groups": len(groups.get("groups", [])),
                "spotChecks": len(spot_checks.get("checks", [])),
                # null, а не 0: «слоя нет» и «слой пуст» — разные состояния, и
                # обработчик отчёта обязан их различать.
                "diplomacyRelations": (
                    len(diplomacy.get("relations", [])) if diplomacy is not None else None
                ),
                "diplomacyAlliances": (
                    len(diplomacy.get("alliances", [])) if diplomacy is not None else None
                ),
                "diplomacySpotChecks": (
                    len(diplomacy_checks.get("checks", [])) if diplomacy is not None else None
                ),
            },
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    if violations:
        print(f"ОШИБОК (блокируют приёмку данных): {len(violations)}")
        for v in violations:
            print(f"  - {v}")
        if warnings:
            print(f"Предупреждений: {len(warnings)} (см. ниже после ошибок)")
        if lost:
            print()
            print(
                f"Из них {len(lost)} — рассинхрон со составом карты. Слои ссылаются на "
                "регионы или страны, которых больше нет: загрузка сценария упадёт "
                "ScenarioDataError. Правь ВХОД пайплайна (scripts/map/config/*.json) и "
                "перегенерируй, а не выход."
            )
        return 1

    if warnings:
        print(f"ПРЕДУПРЕЖДЕНИЙ (не блокируют, требуют просмотра): {len(warnings)}")
        for w in warnings:
            print(f"  ~ {w}")
        print()

    if singles:
        # Отдельной строкой, а не списком: их около сотни, и в потоке они прячут
        # единичные находки.
        print(
            f"Групп, встречающихся ровно в одном регионе: {len(singles)}"
            " (эндемичные общности или артефакт генерации — смотреть при ревизии каталога)"
        )
        print()

    # Статус дипломатического слоя печатается ВСЕГДА, включая его отсутствие:
    # иначе «слой не проверялся» выглядит в отчёте так же, как «слой чист».
    if diplomacy is None:
        print(
            f"Дипломатический слой: файла {DIPLOMACY_PATH.name} нет — "
            f"{len(diplomacy_checks.get('checks', []))} исторических фактов НЕ проверялись."
        )
    else:
        print(
            "Дипломатический слой: {0} пар отношений, {1} союзов, "
            "{2} фактов проверено.".format(
                len(diplomacy.get("relations", [])),
                len(diplomacy.get("alliances", [])),
                len(diplomacy_checks.get("checks", [])),
            )
        )
    print()

    if "--show-unmarked" in sys.argv:
        print(f"Без разметки: {len(unmarked)}")
        for u in unmarked:
            print(f"  - {u}")
        print()

    marked_regions = len(demographics.get("regions", []))
    marked_countries = len(ideology.get("countries", []))
    gov_entries = government.get("countries", [])
    dependent = sum(1 for e in gov_entries if e.get("sovereigntyStatus") != "sovereign")
    print(
        f"OK: групп {len(groups.get('groups', []))}, "
        f"размечено регионов {marked_regions}/{len(region_ids)} "
        f"(частичное покрытие — штатное состояние), "
        f"стран с координатами {marked_countries}/{len(countries)} "
        f"(покрытие полное, ярлыки сверены с координатами), "
        f"стран с формой правления {len(gov_entries)}/{len(countries)} "
        f"(из них зависимых {dependent}, непротиворечивость с diplomacy.puppets проверена)"
        + (
            f", влияние {sum(len(e.get('targets') or {}) for e in influence.get('influence', []))} связей "
            f"от {len(influence.get('influence', []))} источников"
            if influence is not None else ", слоя влияния нет"
        )
        + (f"; без разметки объектов: {len(unmarked)} (--show-unmarked покажет список)"
           if unmarked else "; разметка покрывает состав карты целиком")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
