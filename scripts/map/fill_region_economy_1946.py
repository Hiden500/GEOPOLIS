#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Заполняет population/urbanization/stability/infrastructure/development/gdp/
resourceProduction в server/data/scenarios/1946/regions.json.

Методология и обоснование каждого решения — docs/tasks/REGION_ECONOMY_FILL.md,
docs/DECISIONS.md (2026-07-04, "Аудит..." + запись о перезаполнении). Ключевые
принципы (структурно исключают прошлую ошибку — задвоенный Китай, identical
density×area в каждой стране):

1. Population — единственное поле, которое суммируется в Country без
   трансформации (aggregateCountryData.ts) — источник: anchors.py (страновые
   тоталы, confidence verified/estimated) + country_splits.py (многофрагментные
   единицы делят ОДИН тотал, не получают по полному тоталу каждая).
2. Внутристрановое распределение — вес = area**0.55 * TIER_MULTIPLIER[тир],
   где тир — качественная реальная классификация (density_tiers.py), явная
   для стран первого эшелона, generic (по квантилям площади внутри страны)
   для остальных. Степень <1 у площади и тир структурно не позволяют огромной
   пустой территории получить абсурдную долю чисто за размер.
3. gdp — считается по ТОЧНО той же формуле, что calculateRegionGdp()
   (population × development × infrastructure × 1000), потому что
   initializeRegionGdp() безусловно перезаписывает region.gdp этой формулой
   при каждом createGame() — источниковать отдельную "реальную" цифру ВВП
   бессмысленно (см. docs/DECISIONS.md, план перезаполнения).
4. Детерминированный джиттер (хэш region id, не Math.random) — гарантирует,
   что внутри одной страны не возникает 3+ региона с идентичной плотностью
   (ровно то, что проваливало прошлый аудит) без введения истинной
   случайности в игровые данные.

Запуск: python scripts/map/fill_region_economy_1946.py
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from economy_1946.anchors import COUNTRY_POPULATION_1946, MULTI_FRAGMENT_TOTALS
from economy_1946.country_splits import (
    CHINA_SPLIT, GERMANY_SPLIT, KOREA_SPLIT, COLONIAL_BLOC_GROUPS,
)
from economy_1946.density_tiers import (
    AREA_EXPONENT, TIER_MULTIPLIER, EXPLICIT_TIER_CLASSIFIERS, generic_tier,
)
from economy_1946.resource_geography import RESOURCE_HOTSPOTS
from economy_1946.usa_states import STATE_WEIGHT_1940, usa_state_key

REPO_ROOT = Path(__file__).resolve().parents[2]
REGIONS_PATH = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "regions.json"

ACTIVE_RESOURCES_1946 = {
    "coal", "oil", "gas", "iron", "copper", "gold", "tin", "nickel", "bauxite",
    "tungsten", "manganese", "chromium", "uranium", "food", "timber", "cotton",
    "rubber", "nitrates",
}

# docs/plans/04_RESOURCES.md — держать в синхроне со
# shared/src/defines/resources.ts::MAX_EXTRACTION_LEVEL.
MAX_EXTRACTION_LEVEL = 10

DIRECT_OWNER_POPULATION = {**CHINA_SPLIT, **GERMANY_SPLIT, **KOREA_SPLIT}
COLONIAL_BLOCS = set(COLONIAL_BLOC_GROUPS.keys())

TIER_DEV_FACTOR = {1: 0.5, 2: 0.75, 3: 1.0, 4: 1.25, 5: 1.5, 6: 1.85}
TIER_URBAN_BASE = {1: 0.03, 2: 0.08, 3: 0.18, 4: 0.32, 5: 0.55, 6: 0.82}


def det_jitter(region_id: int, salt: str, lo: float = 0.9, hi: float = 1.1) -> float:
    """Детерминированный псевдослучайный коэффициент из хэша — не Math.random,
    но и не идентичная константа. Разные salt дают независимые джиттеры для
    разных полей одного региона."""
    h = hashlib.sha256(f"{region_id}:{salt}".encode()).hexdigest()
    frac = int(h[:8], 16) / 0xFFFFFFFF
    return lo + frac * (hi - lo)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ============================================================
# Country-level industrialization tier: (development, infrastructure,
# stability) базовые 0..1 — качественная категоризация по реальной степени
# индустриализации/политической ситуации на январь 1946, НЕ индивидуально
# источникованные числа (это не то поле, где это реалистично для 127 стран —
# важна относительная упорядоченность категорий, не третий знак).
# ============================================================
_DEV_TIERS: list[tuple[float, float, float, list[str]]] = [
    # (development, infrastructure, stability, country_ids)
    (0.80, 0.82, 0.62, ["USA", "CAN", "CHE", "SWE", "IRL", "AUS", "NZL"]),
    (0.70, 0.58, 0.42, ["GBR", "FRA", "BEL", "NLD", "DNK", "NOR",
                          "QGB", "QGA", "QGF", "QGS", "JPN"]),
    (0.55, 0.45, 0.55, ["SUN"]),
    (0.50, 0.40, 0.45, ["ITA"]),
    (0.42, 0.38, 0.42, ["POL", "CSK", "AUT", "HUN", "YUG", "BGR", "ROU",
                          "GRC", "ESP", "PRT", "FIN", "ZAF"]),
    (0.38, 0.32, 0.50, ["ARG", "BRA", "MEX", "CHL", "URY"]),
    (0.28, 0.22, 0.45, ["CUB", "COL", "PER", "VEN", "PRY", "ECU", "BOL",
                          "GTM", "HND", "NIC", "CRI", "PAN", "SLV", "DOM", "HTI"]),
    (0.30, 0.25, 0.32, ["CHN", "TWN", "QMS", "THA", "PHL"]),
    (0.35, 0.30, 0.28, ["QKS", "QKA"]),
    (0.28, 0.22, 0.42, ["SAU", "KWT", "BHR", "QAT", "ARE", "IRQ", "IRN",
                          "TUR", "SYR", "LBN", "JOR", "EGY"]),
    (0.16, 0.13, 0.20, ["PSE", "QMH", "QAZ", "AFG"]),
    (0.22, 0.18, 0.32, ["QCG", "QCN", "QCF", "LAO", "KHM", "NPL", "BTN", "MNG"]),
    (0.12, 0.10, 0.30, ["QCP", "QCU", "QCZ", "QCS", "ETH", "LBR", "SDN",
                          "TZA", "COD", "RWA", "BDI", "MWI", "UGA", "NAM",
                          "BWA", "LSO", "SWZ", "QSO", "TGO", "MAR", "TUN", "CMR"]),
    (0.16, 0.16, 0.45, ["PNG", "SLB", "FSM", "PLW", "MHL", "NRU", "TON",
                          "VUT", "WSM", "MNP"]),
    (0.55, 0.55, 0.75, ["AND", "ALA", "ISL", "LIE", "LUX", "MCO", "SMR", "VAT"]),
    (0.30, 0.25, 0.55, ["ALB"]),
]

COUNTRY_DEV_TIER: dict[str, tuple[float, float, float]] = {}
for dev, infra, stab, ids in _DEV_TIERS:
    for cid in ids:
        COUNTRY_DEV_TIER[cid] = (dev, infra, stab)


def get_dev_tier(owner_id: str) -> tuple[float, float, float]:
    if owner_id in COUNTRY_DEV_TIER:
        return COUNTRY_DEV_TIER[owner_id]
    # фоллбэк для любой страны, не попавшей явно в списки выше —
    # нейтральная низко-средняя оценка, а не 0 (лучше явный дефолт, чем тихий пропуск)
    return (0.20, 0.16, 0.35)


def resolve_country_tier_classifier(owner_id: str):
    return EXPLICIT_TIER_CLASSIFIERS.get(owner_id)


def compute_region_tier(owner_id: str, name: str, area: float, all_areas: list[float]) -> int:
    classifier = resolve_country_tier_classifier(owner_id)
    if classifier:
        return classifier(name)
    return generic_tier(name, area, all_areas)


def split_ruanda_urundi(regions: list[dict]) -> dict[str, int]:
    total = MULTI_FRAGMENT_TOTALS["RUANDA_URUNDI_TOTAL"].population
    rwa_area = sum(r["area"] for r in regions if r["ownerCountryId"] == "RWA")
    bdi_area = sum(r["area"] for r in regions if r["ownerCountryId"] == "BDI")
    total_area = rwa_area + bdi_area
    if total_area == 0:
        return {"RWA": total // 2, "BDI": total // 2}
    return {
        "RWA": round(total * rwa_area / total_area),
        "BDI": round(total * bdi_area / total_area),
    }


def resolve_country_population(owner_id: str, regions: list[dict]) -> int:
    if owner_id in DIRECT_OWNER_POPULATION:
        return DIRECT_OWNER_POPULATION[owner_id]
    if owner_id in ("RWA", "BDI"):
        return split_ruanda_urundi(regions)[owner_id]
    if owner_id in COUNTRY_POPULATION_1946:
        return COUNTRY_POPULATION_1946[owner_id].population
    raise ValueError(f"Нет анкера населения для '{owner_id}' — заполни anchors.py явно, не угадывай молча.")


def _raw_tier_area_weight(owner_id: str, r: dict, areas: list[float]) -> float:
    name = r["names"].get("en", "")
    tier = compute_region_tier(owner_id, name, r["area"], areas)
    jitter = det_jitter(r["id"], f"pop:{owner_id}")
    return (max(r["area"], 0.01) ** AREA_EXPONENT) * TIER_MULTIPLIER[tier] * jitter


def distribute_by_weight(owner_regions: list[dict], total_population: int, owner_id: str) -> dict[int, int]:
    areas = [r["area"] for r in owner_regions]
    raw = {r["id"]: _raw_tier_area_weight(owner_id, r, areas) for r in owner_regions}
    weights: dict[int, float] = {}

    if owner_id == "USA":
        # Переопределение для США (см. usa_states.py) — самый заметный кейс
        # прошлого аудита (Монтана/Невада). Реальный вес переписи 1940 по
        # штату вместо чистой tier×area эвристики; area/tier используются
        # только для распределения ВНУТРИ штата между его регионами —
        # нормализуем raw-вес на сумму по штату, чтобы штат в сумме получил
        # ровно свою реальную долю, а не raw×state_pop без нормировки.
        by_state: dict[str, list[dict]] = {}
        for r in owner_regions:
            by_state.setdefault(usa_state_key(r["names"].get("en", "")), []).append(r)

        for state_key, state_regions in by_state.items():
            state_pop = STATE_WEIGHT_1940.get(state_key)
            state_raw_sum = sum(raw[r["id"]] for r in state_regions)
            for r in state_regions:
                if state_pop is not None and state_raw_sum > 0:
                    weights[r["id"]] = state_pop * (raw[r["id"]] / state_raw_sum)
                else:
                    weights[r["id"]] = raw[r["id"]]  # штат не в таблице — фоллбэк на raw
    else:
        weights = raw

    total_w = sum(weights.values())
    if total_w <= 0:
        # все площади нулевые (не должно происходить) — равное деление как страховка
        share = total_population / len(owner_regions)
        return {r["id"]: round(share) for r in owner_regions}
    return {rid: round(total_population * w / total_w) for rid, w in weights.items()}


def distribute_colonial_bloc(owner_id: str, owner_regions: list[dict]) -> dict[int, int]:
    groups = COLONIAL_BLOC_GROUPS[owner_id]
    by_id: dict[int, dict] = {r["id"]: r for r in owner_regions}
    assigned_group: dict[int, str] = {}

    for group_name, spec in groups.items():
        match_ids = set(spec.get("match_ids", []))
        keywords = spec.get("match_any", [])
        for r in owner_regions:
            if r["id"] in assigned_group:
                continue
            name_lower = r["names"].get("en", "").lower()
            if r["id"] in match_ids or (keywords and any(k in name_lower for k in keywords)):
                assigned_group[r["id"]] = group_name

    result: dict[int, int] = {}
    for group_name, spec in groups.items():
        group_region_ids = [rid for rid, g in assigned_group.items() if g == group_name]
        if not group_region_ids:
            continue
        group_regions = [by_id[rid] for rid in group_region_ids]
        result.update(distribute_by_weight(group_regions, spec["population"], owner_id))

    # Остаток блока — регионы, не попавшие ни в одну группу. Честно
    # документированный fallback (низкая уверенность), не точное знание.
    unmatched = [r for r in owner_regions if r["id"] not in assigned_group]
    if unmatched:
        known_total = sum(spec["population"] for spec in groups.values())
        bloc_total = COUNTRY_POPULATION_1946.get(owner_id)
        # У колониальных блоков нет единого anchor в COUNTRY_POPULATION_1946 —
        # остаток оцениваем консервативно: 5% от суммы известных групп на
        # непокрытые мелкие территории (архипелаги, мелкие анклавы).
        residual_total = round(known_total * 0.05)
        result.update(distribute_by_weight(unmatched, residual_total, owner_id))

    return result


def compute_region_economics(r: dict, owner_id: str, population: int, all_areas: list[float]) -> None:
    base_dev, base_infra, base_stab = get_dev_tier(owner_id)
    tier = compute_region_tier(owner_id, r["names"].get("en", ""), r["area"], all_areas)
    factor = TIER_DEV_FACTOR[tier]

    r["population"] = population
    r["development"] = round(clamp(base_dev * factor * det_jitter(r["id"], "dev"), 0.02, 0.95), 3)
    r["infrastructure"] = round(clamp(base_infra * factor * det_jitter(r["id"], "infra"), 0.02, 0.95), 3)

    urban_ceiling = 1.0 if base_dev >= 0.6 else (0.7 if base_dev >= 0.35 else 0.5)
    r["urbanization"] = round(clamp(TIER_URBAN_BASE[tier] * urban_ceiling * det_jitter(r["id"], "urban"), 0.01, 0.95), 3)

    stab_tier_adj = {1: -0.03, 2: -0.01, 3: 0.0, 4: 0.01, 5: 0.02, 6: 0.03}[tier]
    r["stability"] = round(clamp((base_stab + stab_tier_adj) * det_jitter(r["id"], "stab", 0.92, 1.08), 0.05, 0.95), 3)

    r["gdp"] = round(r["population"] * r["development"] * r["infrastructure"] * 1000)

    resources: dict[str, int] = {}
    hotspots = RESOURCE_HOTSPOTS.get(owner_id, {})
    name_lower = r["names"].get("en", "").lower()
    for keyword, res_amounts in hotspots.items():
        if keyword == "none" or keyword in name_lower:
            for res, amount in res_amounts.items():
                if res in ACTIVE_RESOURCES_1946:
                    resources[res] = resources.get(res, 0) + amount

    # Универсальная база: food пропорционален population×development (везде
    # где есть люди — есть сельское хозяйство), timber в регионах с высокой
    # площадью относительно населения (лесная/неосвоенная земля).
    food_base = round(r["population"] / 1000 * (0.5 + r["development"]))
    if food_base > 0:
        resources["food"] = resources.get("food", 0) + food_base
    if r["area"] > 50_000 and r["population"] > 0:
        resources["timber"] = resources.get("timber", 0) + round(r["area"] / 5000)

    # deposit/extraction/output (docs/plans/04_RESOURCES.md): richness =
    # текущий output, extraction level = MAX (сразу развёрнуто) — так
    # extractionFactor=1.0 и стартовый output не сдвигается ни на процент.
    # MAX_EXTRACTION_LEVEL держать в синхроне со
    # shared/src/defines/resources.ts (нет единого TS↔Python источника, план 05).
    r["deposits"] = resources
    r["extraction"] = {res: MAX_EXTRACTION_LEVEL for res in resources}


def main() -> None:
    with open(REGIONS_PATH, encoding="utf-8") as f:
        regions = json.load(f)

    by_owner: dict[str, list[dict]] = {}
    for r in regions:
        by_owner.setdefault(r["ownerCountryId"], []).append(r)

    for owner_id, owner_regions in by_owner.items():
        if owner_id in COLONIAL_BLOCS:
            populations = distribute_colonial_bloc(owner_id, owner_regions)
        else:
            total_population = resolve_country_population(owner_id, regions)
            populations = distribute_by_weight(owner_regions, total_population, owner_id)

        all_areas = [r["area"] for r in owner_regions]
        for r in owner_regions:
            compute_region_economics(r, owner_id, populations[r["id"]], all_areas)

    with open(REGIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(regions, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Заполнено {len(regions)} регионов, {len(by_owner)} стран/владельцев.")
    print(f"Записано в {REGIONS_PATH}")


if __name__ == "__main__":
    main()
