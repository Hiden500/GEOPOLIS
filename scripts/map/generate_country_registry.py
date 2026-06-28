"""
generate_country_registry.py — генерирует реестр стран сценария 1946 из MAP.

Заменяет 12 рукописных стран (server/src/data/countries/*.ts, оставлены для
сценариев 1836/2000) полным реестром, выведенным из scripts/map/out/countries_1946.json
и фактических владельцев в server/data/scenarios/1946/regions.json (генерируется
import_to_game.py — запускать первым).

Конвенция кодов стран (см. план интеграции, "Конвенция кодов стран"):
  - Суверены — ISO 3166-1 alpha-3 как есть в MAP.
  - Исчезнувшие государства — исторические alpha-3 (SUN, YUG...) как есть в MAP.
  - Сущности без кода в MAP (зоны оккупации Германии, склеенные колониальные
    блоки) — private-use диапазон ISO (Q**), назначаются здесь.

Германия (DEU) как единая страна не получает территории — все её регионы
переходят зонам оккупации через occupation_overlay.json (см. import_to_game.py).
Тайвань (TWN) не входит в каталог MAP 1946 года — добавляется как кастомная
запись (см. TAIWAN_OVERRIDE), представляющая гоминьдановское правительство
(привязка к реальному ISO-коду Тайваня осознанна: тот же субъект после 1949).

Объединение микро-субъектов (политика по умолчанию, см. план):
  - Колонии (subject_type == "colony") одного суверена с количеством > 1
    объединяются в один игровой субъект с private-use кодом.
  - dominion/protectorate/mandate/occupied/condominium остаются отдельными
    странами — это политически отличающиеся друг от друга статусы с
    достаточно большим числом единиц, чтобы не схлопывать их по умолчанию.
  - Колонии-одиночки (count == 1 на суверена) остаются отдельной страной
    под своим ISO3 (не создаём блок на одну запись).

Результат — рабочая база ("дефолт"), не финал: дальнейшая ручная доводка
группировки ожидаема (см. открытые вопросы плана).
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "scripts" / "map" / "out"
CONFIG_DIR = REPO_ROOT / "scripts" / "map" / "config"
REGIONS_PATH = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "regions.json"
COUNTRIES_OUT = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "countries.json"
MERGE_OUT = CONFIG_DIR / "country_merge.json"

# Private-use коды для колониальных блоков (suzerain ISO3 -> блок-код).
COLONY_BLOC_CODES = {
    "GBR": "QCG", "FRA": "QCF", "PRT": "QCP", "NLD": "QCN",
    "USA": "QCU", "NZL": "QCZ", "ESP": "QCS",
}

# Кастомные записи, отсутствующие в каталоге MAP (зоны оккупации + Тайвань).
CUSTOM_COUNTRIES = {
    "QGS": {"name_en": "Soviet Occupation Zone (Germany)", "ideology": "Communism", "economy": "planned"},
    "QGA": {"name_en": "American Occupation Zone (Germany)", "ideology": "Liberal Democracy", "economy": "market"},
    "QGB": {"name_en": "British Occupation Zone (Germany)", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QGF": {"name_en": "French Occupation Zone (Germany)", "ideology": "Liberal Democracy", "economy": "mixed"},
    "TWN": {"name_en": "Republic of China (Kuomintang)", "ideology": "Nationalism", "economy": "mixed"},
    "QKS": {"name_en": "Soviet Occupation Zone (Korea)", "ideology": "Communism", "economy": "planned"},
    "QKA": {"name_en": "American Occupation Zone (Korea)", "ideology": "Liberal Democracy", "economy": "market"},
    "QMS": {"name_en": "Soviet-administered Manchuria", "ideology": "Communism", "economy": "planned"},
    # Иранский кризис 1946 — два просоветских квазигосударства (разгромлены
    # Тегераном в декабре 1946), см. occupation_overlay.json::_iran_crisis_1946.
    "QAZ": {"name_en": "Azerbaijan People's Government", "ideology": "Communism", "economy": "planned"},
    "QMH": {"name_en": "Republic of Mahabad", "ideology": "Communism", "economy": "planned"},
    # Британский Сомалиленд — код нормализован из составного MAP-кода SOM_GBR
    # на 3-буквенный private-use (см. import_to_game.py::OWNER_CODE_ALIASES);
    # из-за смены кода каталог MAP по нему не матчится напрямую, поэтому здесь.
    "QSO": {"name_en": "British Somaliland", "ideology": "Liberal Democracy", "economy": "mixed"},
}

# Суверены, исторически идущие с плановой экономикой/коммунистической идеологией.
PLANNED_ECONOMY_SOVEREIGNS = {"SUN", "YUG", "CHN", "MNG"}

# Марионетки без записи в каталоге MAP (QAZ/QMH — кастомные коды, см. выше) —
# добавляются в puppets/sphereOfInfluence сюзерена напрямую, минуя обычный
# catalog-driven путь (subject_of), который их не видит.
PUPPET_OVERRIDES = {"SUN": ["QAZ", "QMH"]}

# Мандат/протекторат без subject_of в каталоге MAP, но политически зависимый —
# подставляется в catalog ПЕРЕД вычислением puppets/suzerain_of, чтобы пройти
# тот же путь, что и нативные subject_of записи (см. PSE). Трансиордания была
# британским мандатом до 25.05.1946, MAP отдаёт её как суверена.
SUBJECT_OVERRIDES = {"JOR": "GBR"}

# Тот же составной код MAP, что нормализуется в import_to_game.py — здесь
# нужен повторно, т.к. countries_1946.json (каталог) хранит исходный код
# ключом словаря, независимо от того, что regions.json уже на QSO.
CATALOG_CODE_ALIASES = {"SOM_GBR": "QSO"}

# Военное/договорное присутствие держав на 1946, НЕ территориальное владение —
# страны остаются суверенными (свой цвет, не тонируются), только входят в
# sphereOfInfluence сюзерена. Сирия/Ливан — французские войска до сер. 1946;
# Египет — британская зона Суэцкого канала.
SPHERE_OVERRIDES = {"FRA": ["SYR", "LBN"], "GBR": ["EGY"]}

# Курированные цвета для крупных/узнаваемых держав 1946 — приближены к
# реальным флагам/традиции раскраски исторических карт, а не хэш-рандом.
# Остальные страны — детерминированный хэш (deterministic_color), см. ниже.
MAJOR_POWER_COLORS = {
    "SUN": "#c0392b",  # СССР — красный
    "USA": "#2980b9",  # США — синий
    "GBR": "#e8a0bc",  # Великобритания — традиционный "имперский розовый"
    "FRA": "#45b8ac",  # Франция — бирюзовый (традиция колониальных карт)
    "CHN": "#d35400",  # Китай (КПК) — красно-оранжевый
    "TWN": "#1f3a93",  # Тайвань (Гоминьдан) — синий (цвет партии)
    "ITA": "#2e8b57",  # Италия — зелёный
}

# Зоны оккупации/администрации тонируются от цвета державы-оккупанта (тот же
# механизм, что и для вассалов, см. tint_from_suzerain) — даже если формально
# не входят в diplomacy.puppets (другой механизм данных, см. occupation_overlay).
ZONE_TINT_SUZERAIN = {
    "QGS": "SUN", "QGA": "USA", "QGB": "GBR", "QGF": "FRA",
    "QKS": "SUN", "QKA": "USA", "QMS": "SUN",
    "QAZ": "SUN", "QMH": "SUN", "QSO": "GBR",
}

EQUIPMENT_TYPES = ["rifles", "trucks", "tanks", "fighters", "bombers", "artillery", "destroyers", "submarines"]
TECH_DOMAINS_1946 = ["nuclear", "rocketry", "electronics", "computing", "microelectronics", "aviation",
                     "radar", "biology", "armor", "naval", "infantry", "space", "materials", "industry"]
RESOURCE_KEYS = ["oil", "coal", "gas", "iron", "copper", "gold", "tin", "nickel", "bauxite", "tungsten",
                 "manganese", "chromium", "uranium", "rareEarths", "lithium", "food", "timber", "cotton",
                 "rubber", "nitrates"]

ARCHETYPES = {
    "planned": {
        "taxRate": 0.20,
        "spending": {"military": 0.30, "research": 0.08, "education": 0.10, "infrastructure": 0.25, "welfare": 0.12, "other": 0.10},
        "treasuryShare": 0.05, "exportShare": 0.03, "stateEnterpriseShare": 0.10, "otherIncomeShare": 0.01,
        "inflation": 2, "unemployment": 1, "tradeBalance": 0,
    },
    "mixed": {
        "taxRate": 0.15,
        "spending": {"military": 0.20, "research": 0.08, "education": 0.15, "infrastructure": 0.20, "welfare": 0.22, "other": 0.10},
        "treasuryShare": 0.05, "exportShare": 0.05, "stateEnterpriseShare": 0.03, "otherIncomeShare": 0.02,
        "inflation": 3, "unemployment": 4, "tradeBalance": 0,
    },
    "market": {
        "taxRate": 0.10,
        "spending": {"military": 0.15, "research": 0.10, "education": 0.15, "infrastructure": 0.15, "welfare": 0.30, "other": 0.10},
        "treasuryShare": 0.04, "exportShare": 0.06, "stateEnterpriseShare": 0.01, "otherIncomeShare": 0.02,
        "inflation": 2, "unemployment": 5, "tradeBalance": 0,
    },
}


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_merge_map(catalog: dict) -> dict:
    """subject ISO3 -> блок-код, для колоний с count>1 на суверена."""
    by_suzerain_colony = {}
    for code, info in catalog.items():
        subject_of = info.get("subject_of")
        if not subject_of or info.get("subject_type") != "colony":
            continue
        suzerain = subject_of[0] if isinstance(subject_of, list) else subject_of
        by_suzerain_colony.setdefault(suzerain, []).append(code)

    merge_map = {}
    for suzerain, members in by_suzerain_colony.items():
        if len(members) <= 1:
            continue
        bloc_code = COLONY_BLOC_CODES.get(suzerain)
        if not bloc_code:
            continue  # суверен без назначенного блок-кода — колонии остаются отдельными
        for m in members:
            merge_map[m] = bloc_code
    return merge_map


def empty_stockpile():
    return {k: 0 for k in RESOURCE_KEYS}


def empty_economy_state():
    return {
        "gdp": 0, "treasury": 0, "taxRevenue": 0, "exportIncome": 0, "stateEnterpriseIncome": 0,
        "otherIncome": 0, "militarySpending": 0, "researchSpending": 0, "educationSpending": 0,
        "infrastructureSpending": 0, "welfareSpending": 0, "debtInterest": 0, "otherExpenses": 0,
        "inflation": 0, "unemployment": 0, "tradeBalance": 0, "budgetBalance": 0,
    }


def deterministic_color(country_id: str) -> str:
    """Курированный цвет для крупных держав, иначе стабильный хэш-цвет (HSL)."""
    if country_id in MAJOR_POWER_COLORS:
        return MAJOR_POWER_COLORS[country_id]
    import hashlib
    h = int(hashlib.md5(country_id.encode("utf-8")).hexdigest(), 16)
    hue = h % 360
    sat = 55 + (h // 360) % 25  # 55-79%
    light = 40 + (h // 360 // 25) % 20  # 40-59%
    return hsl_to_hex(hue, sat, light)


def hsl_to_hex(h: float, s: float, l: float) -> str:
    s /= 100
    l /= 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    if h < 60: r, g, b = c, x, 0
    elif h < 120: r, g, b = x, c, 0
    elif h < 180: r, g, b = 0, c, x
    elif h < 240: r, g, b = 0, x, c
    elif h < 300: r, g, b = x, 0, c
    else: r, g, b = c, 0, x
    r, g, b = (round((v + m) * 255) for v in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, l * 100
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60, s * 100, l * 100


def tint_from_suzerain(suzerain_hex: str) -> str:
    """Вассал/зона окраски: тот же оттенок, светлее и менее насыщенно —
    визуально читается как "принадлежит" этому цвету, но отличим от него."""
    h, s, l = hex_to_hsl(suzerain_hex)
    return hsl_to_hex(h, max(20.0, s - 20), min(82.0, l + 18))


def make_country(country_id: str, name_en: str, economy_type: str, ideology: str,
                  capital_region_id: int | None, puppets: list[str], color: str) -> dict:
    profile = dict(ARCHETYPES[economy_type])
    profile["spending"] = dict(profile["spending"])
    return {
        "id": country_id,
        "name": name_en,
        "shortName": name_en[:24],
        "color": color,
        "capitalRegionId": capital_region_id if capital_region_id is not None else 0,
        "population": 0,
        "economyProfile": profile,
        "economy": empty_economy_state(),
        "economyType": economy_type,
        "technology": {"domains": {d: 0 for d in TECH_DOMAINS_1946}, "projects": []},
        "researchedTechnologyIds": [],
        "military": {
            "manpower": 0, "activePersonnel": 0, "reservePersonnel": 0, "militaryBudget": 0,
            "armyStrength": 0, "navyStrength": 0, "airStrength": 0, "nuclearWarheads": 0,
            "units": [], "equipment": {e: 0 for e in EQUIPMENT_TYPES},
        },
        "diplomacy": {
            "allies": [], "rivals": [], "puppets": puppets, "sphereOfInfluence": list(puppets),
            "relations": {}, "influence": {}, "guarantees": [], "sanctions": {},
        },
        "politics": {
            "ideology": ideology, "governmentType": "Unknown", "stability": 50,
            "legitimacy": 50, "corruption": 30, "governmentSupport": 50,
        },
        "stockpile": empty_stockpile(),
        "goals": [],
    }


def main():
    catalog = load_json(OUT_DIR / "countries_1946.json")
    catalog = {CATALOG_CODE_ALIASES.get(k, k): v for k, v in catalog.items()}
    regions = load_json(REGIONS_PATH)

    # Подставляем subject_of там, где MAP отдаёт суверена, но политически
    # территория зависима (см. SUBJECT_OVERRIDES) — после этого код ниже
    # обрабатывает её как нативную subject_of запись (как PSE).
    for code, suzerain in SUBJECT_OVERRIDES.items():
        if code in catalog and not catalog[code].get("subject_of"):
            catalog[code]["subject_of"] = suzerain

    merge_map = build_merge_map(catalog)
    MERGE_OUT.write_text(json.dumps(merge_map, ensure_ascii=False, indent=2), encoding="utf-8")

    # Применяем объединение к regions.json: владелец-колония -> код блока.
    # Без этого регионы продолжали бы ссылаться на ISO-коды, исчезнувшие
    # из реестра стран после объединения.
    changed = 0
    for r in regions:
        merged = merge_map.get(r["ownerCountryId"])
        if merged:
            r["ownerCountryId"] = merged
            changed += 1
    if changed:
        REGIONS_PATH.write_text(json.dumps(regions, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"regions.json: {changed} регионов переключены на код блока-владельца")

    # Фактические владельцы по сгенерированным регионам — источник истины,
    # какие страны реально нужны (а не весь каталог MAP, часть которого
    # никогда не владеет ни одним регионом в этом сценарии).
    owners_in_regions = {r["ownerCountryId"] for r in regions}
    final_owner_ids = {merge_map.get(o, o) for o in owners_in_regions}

    # area по owner для эвристики capitalRegionId (регион с максимальной area)
    best_region_by_owner: dict[str, tuple[int, float]] = {}
    for r in regions:
        owner = merge_map.get(r["ownerCountryId"], r["ownerCountryId"])
        area = r.get("area", 0)
        if owner not in best_region_by_owner or area > best_region_by_owner[owner][1]:
            best_region_by_owner[owner] = (r["id"], area)

    # puppets: subject -> suzerain, для стран не вошедших в merge (остаются отдельными)
    puppets_by_suzerain: dict[str, list[str]] = {}
    for code, info in catalog.items():
        subject_of = info.get("subject_of")
        if not subject_of or code in merge_map:
            continue
        suzerain = subject_of[0] if isinstance(subject_of, list) else subject_of
        puppets_by_suzerain.setdefault(suzerain, []).append(code)

    for suzerain, subs in PUPPET_OVERRIDES.items():
        puppets_by_suzerain.setdefault(suzerain, []).extend(subs)

    # subject -> suzerain, для тонирования цвета вассалов (не колониальных
    # блоков — те держат отдельный акцентный цвет по решению, см. план).
    suzerain_of = {subj: suz for suz, subs in puppets_by_suzerain.items() for subj in subs}

    # Базовые цвета считаем в два прохода: сначала все суверены/обычные
    # страны (нужны как источник тона для вассалов/зон), затем вассалы и
    # зоны оккупации тонируются от уже посчитанного цвета суверена.
    base_colors: dict[str, str] = {}
    for country_id in sorted(final_owner_ids):
        if country_id in suzerain_of or country_id in ZONE_TINT_SUZERAIN:
            continue
        base_colors[country_id] = deterministic_color(country_id)

    colors: dict[str, str] = dict(base_colors)
    for country_id in sorted(final_owner_ids):
        if country_id in colors:
            continue
        suzerain = suzerain_of.get(country_id) or ZONE_TINT_SUZERAIN.get(country_id)
        suzerain_color = base_colors.get(suzerain) or deterministic_color(suzerain) if suzerain else None
        colors[country_id] = tint_from_suzerain(suzerain_color) if suzerain_color else deterministic_color(country_id)

    countries = []
    for country_id in sorted(final_owner_ids):
        capital_region_id = best_region_by_owner.get(country_id, (None, 0))[0]
        puppets = puppets_by_suzerain.get(country_id, [])
        color = colors[country_id]

        if country_id in CUSTOM_COUNTRIES:
            meta = CUSTOM_COUNTRIES[country_id]
            countries.append(make_country(country_id, meta["name_en"], meta["economy"], meta["ideology"], capital_region_id, puppets, color))
            continue

        if country_id in catalog:
            name_en = catalog[country_id]["name_en"]
        elif country_id in COLONY_BLOC_CODES.values():
            suzerain = next(s for s, b in COLONY_BLOC_CODES.items() if b == country_id)
            name_en = f"{catalog.get(suzerain, {}).get('name_en', suzerain)} Colonies"
        else:
            name_en = country_id

        economy_type = "planned" if country_id in PLANNED_ECONOMY_SOVEREIGNS else "mixed"
        ideology = "Communism" if economy_type == "planned" else "Liberal Democracy"
        countries.append(make_country(country_id, name_en, economy_type, ideology, capital_region_id, puppets, color))

    # Военное/договорное присутствие (см. SPHERE_OVERRIDES) — только сфера
    # влияния, без тонирования цвета и без puppets (страны остаются
    # суверенными в данных, см. docs/DECISIONS.md).
    for country in countries:
        extra_sphere = SPHERE_OVERRIDES.get(country["id"])
        if extra_sphere:
            country["diplomacy"]["sphereOfInfluence"].extend(extra_sphere)

    COUNTRIES_OUT.parent.mkdir(parents=True, exist_ok=True)
    COUNTRIES_OUT.write_text(json.dumps(countries, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Стран: {len(countries)} -> {COUNTRIES_OUT}")
    print(f"Колониальных блоков: {len(set(merge_map.values()))}, объединено записей: {len(merge_map)}")
    print(f"Merge-карта -> {MERGE_OUT}")


if __name__ == "__main__":
    main()
