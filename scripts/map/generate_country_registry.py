"""
generate_country_registry.py — генерирует реестр стран сценария 1946 из MAP.

Заменяет 12 рукописных стран (server/src/data/countries/*.ts, оставлены для
сценариев 1836/2000) полным реестром, выведенным из scripts/map/out/countries_1946.json
и фактических владельцев в server/data/scenarios/1946/regions.state.json (генерируется
import_to_game.py — запускать первым; читается через economy_1946.region_files,
см. docs/plans/05_DATA_LAYOUT.md).

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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import load_regions_combined, write_regions_state

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "scripts" / "map" / "out"
CONFIG_DIR = REPO_ROOT / "scripts" / "map" / "config"
COUNTRIES_OUT = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "countries.json"
MERGE_OUT = CONFIG_DIR / "country_merge.json"
ENTITY_CONFIG = CONFIG_DIR / "country_entities_1946.json"

# Private-use коды для колониальных блоков (suzerain ISO3 -> блок-код).
COLONY_BLOC_CODES = {
    "GBR": "QCG", "FRA": "QCF", "PRT": "QCP", "NLD": "QCN",
    "USA": "QCU", "NZL": "QCZ", "ESP": "QCS",
}

# Кастомные записи, отсутствующие в каталоге MAP: зоны оккупации, Тайвань и
# исторические администрации, собранные из нескольких современных ISO-кодов.
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
    # Исторические карибские администрации на дату снимка. Современные ISO3
    # островов сводятся к ним через country_entities_1946.json.
    "QWL": {"name_en": "Leeward Islands", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QWW": {"name_en": "Windward Islands", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QND": {"name_en": "Curaçao and Dependencies", "ideology": "Liberal Democracy", "economy": "mixed"},
    "MTQ": {"name_en": "Martinique", "ideology": "Liberal Democracy", "economy": "mixed"},
    "GLP": {"name_en": "Guadeloupe", "ideology": "Liberal Democracy", "economy": "mixed"},
}

# Суверены, исторически идущие с плановой экономикой/коммунистической идеологией.
PLANNED_ECONOMY_SOVEREIGNS = {"SUN", "YUG", "CHN", "MNG"}

# Зависимые сущности без записи в каталоге MAP — добавляются в puppets/
# sphereOfInfluence сюзерена напрямую, минуя catalog-driven путь subject_of.
PUPPET_OVERRIDES = {
    "SUN": ["QAZ", "QMH"],
    "GBR": ["QWL", "QWW"],
    "NLD": ["QND"],
    "FRA": ["MTQ", "GLP"],
}

# Мандат/протекторат без subject_of в каталоге MAP, но политически зависимый —
# подставляется в catalog ПЕРЕД вычислением puppets/suzerain_of, чтобы пройти
# тот же путь, что и нативные subject_of записи (см. PSE). Трансиордания была
# британским мандатом до 25.05.1946, MAP отдаёт её как суверена.
SUBJECT_OVERRIDES = {"JOR": "GBR"}

# Тот же составной код MAP, что нормализуется в import_to_game.py — здесь
# нужен повторно, т.к. countries_1946.json (каталог) хранит исходный код
# ключом словаря, независимо от того, что regions.state.json уже на QSO.
CATALOG_CODE_ALIASES = {"SOM_GBR": "QSO"}

# Военное/договорное присутствие держав на 1946, НЕ территориальное владение —
# страны остаются суверенными (свой цвет, не тонируются), только входят в
# sphereOfInfluence сюзерена. Сирия/Ливан — французские войска до сер. 1946;
# Египет — британская зона Суэцкого канала.
SPHERE_OVERRIDES = {"FRA": ["SYR", "LBN"], "GBR": ["EGY"]}

# Курированные цвета для крупных/узнаваемых держав 1946 — приглушённая
# палитра в духе EU5/HOI4 (midtone, не неон), сохраняя традиционные
# ассоциации (СССР красный, "имперский розовый" Британии), а не хэш-рандом.
# Остальные страны — детерминированный хэш (deterministic_color), см. ниже.
MAJOR_POWER_COLORS = {
    "SUN": "#a23636",  # СССР — приглушённый кирпично-красный
    "USA": "#3b6e8f",  # США — приглушённый стальной синий
    "GBR": "#b5657c",  # Великобритания — "имперский розовый", но глубже и
                        # насыщеннее пастельного (был #e8a0bc, "не смотрелся")
    "FRA": "#3f8f86",  # Франция — приглушённая бирюза (традиция колон. карт)
    "CHN": "#bd6332",  # Китай (КПК) — приглушённый красно-оранжевый
    "TWN": "#33538f",  # Тайвань (Гоминьдан) — приглушённый синий (цвет партии)
    "ITA": "#4f8f63",  # Италия — приглушённый зелёный
    "JPN": "#8f4a4a",  # Япония — приглушённый тёмно-красный (отличим от СССР)
}

# Зоны оккупации/администрации тонируются от цвета державы-оккупанта (тот же
# механизм, что и для вассалов, см. tint_from_suzerain) — даже если формально
# не входят в diplomacy.puppets (другой механизм данных, см. occupation_overlay).
ZONE_TINT_SUZERAIN = {
    "QGS": "SUN", "QGA": "USA", "QGB": "GBR", "QGF": "FRA",
    "QKS": "SUN", "QKA": "USA", "QMS": "SUN",
    "QAZ": "SUN", "QMH": "SUN", "QSO": "GBR",
}

# Валютные зоны (docs/plans/10_CURRENCY_ZONES.md) — минимальный документированный
# набор: только прямые зоны военной оккупации/администрации 1946 года (чёткий
# исторический факт, не интерпретация) — обе стороны биполярного раздела
# Германии/Кореи и советская администрация Маньчжурии. Осознанно НЕ включены
# QAZ/QMH (просоветские квазигосударства, другая категория — политический
# клиент, не оккупационная администрация) и QSO (колониальная администрация) —
# "не тянуть спорные случаи" (docs/plans/10_CURRENCY_ZONES.md). Подмножество
# ZONE_TINT_SUZERAIN выше, не весь словарь.
CURRENCY_ZONE_ANCHOR = {
    "QGS": "SUN", "QKS": "SUN", "QMS": "SUN",
    "QGA": "USA", "QKA": "USA",
    "QGB": "GBR",
    "QGF": "FRA",
}

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


def load_entity_config(catalog: dict) -> tuple[set[str], dict[str, str]]:
    """Читает курированные сущности 1946 и проверяет их против MAP-каталога.

    `preserve` исключает реальную зависимую территорию из искусственного
    мирового блока. `ownerOverrides` сводит современный ISO-код к реально
    существовавшей на дату снимка администрации.
    """
    config = load_json(ENTITY_CONFIG)
    if config.get("_meta", {}).get("snapshotDate") != "1946-01-01":
        raise ValueError(f"{ENTITY_CONFIG}: snapshotDate должен быть 1946-01-01")

    preserve: set[str] = set()
    owner_overrides: dict[str, str] = {}
    for continent, section in config.get("continents", {}).items():
        if section.get("status") != "complete":
            raise ValueError(f"{ENTITY_CONFIG}: континент {continent} не помечен complete")
        if not section.get("sources"):
            raise ValueError(f"{ENTITY_CONFIG}: у континента {continent} нет provenance sources")

        for entity in section.get("preserve", []):
            code = entity["code"]
            if code in preserve:
                raise ValueError(f"{ENTITY_CONFIG}: дубликат preserve-кода {code}")
            if code not in catalog:
                raise ValueError(f"{ENTITY_CONFIG}: preserve-код {code} отсутствует в MAP-каталоге")
            catalog_entry = catalog[code]
            expected = {
                "name_en": entity["historicalName"],
                "subject_of": entity["subjectOf"],
                "subject_type": entity["subjectType"],
            }
            actual = {key: catalog_entry.get(key) for key in expected}
            if actual != expected:
                raise ValueError(
                    f"{ENTITY_CONFIG}: metadata drift для {code}: ожидалось {expected}, получено {actual}"
                )
            preserve.add(code)

        for override in section.get("ownerOverrides", []):
            source = override["from"]
            target = override["to"]
            if source in owner_overrides:
                raise ValueError(f"{ENTITY_CONFIG}: дубликат owner override для {source}")
            if source not in catalog or (target not in catalog and target not in CUSTOM_COUNTRIES):
                raise ValueError(
                    f"{ENTITY_CONFIG}: override {source}->{target} ссылается на отсутствующий owner-код"
                )
            owner_overrides[source] = target

    overlap = preserve & owner_overrides.keys()
    if overlap:
        raise ValueError(f"{ENTITY_CONFIG}: коды одновременно preserve и override source: {sorted(overlap)}")
    return preserve, owner_overrides


def build_merge_map(catalog: dict, preserve: set[str], owner_overrides: dict[str, str]) -> dict:
    """source ISO3 -> исторический owner или временный legacy block.

    Обработанные континенты задаются в country_entities_1946.json. Для ещё не
    обработанных колоний временно сохраняется прежнее объединение по сюзерену,
    чтобы каждый континент был самостоятельным валидным commit.
    """
    by_suzerain_colony = {}
    for code, info in catalog.items():
        subject_of = info.get("subject_of")
        if not subject_of or info.get("subject_type") != "colony":
            continue
        suzerain = subject_of[0] if isinstance(subject_of, list) else subject_of
        by_suzerain_colony.setdefault(suzerain, []).append(code)

    merge_map = dict(owner_overrides)
    for suzerain, members in by_suzerain_colony.items():
        if len(members) <= 1:
            continue
        bloc_code = COLONY_BLOC_CODES.get(suzerain)
        if not bloc_code:
            continue  # суверен без назначенного блок-кода — колонии остаются отдельными
        for m in members:
            if m in preserve or m in owner_overrides:
                continue
            merge_map[m] = bloc_code
    return merge_map


def deterministic_color(country_id: str) -> str:
    """Курированный цвет для крупных держав, иначе стабильный хэш-цвет (HSL).
    Диапазон sat/light приглушён под стиль EU5/HOI4 (midtone, не неон) —
    раньше 55-79%/40-59% давало слишком яркие "хэш"-цвета на фоне курированных
    держав; теперь та же идея, но темнее и менее насыщенно."""
    if country_id in MAJOR_POWER_COLORS:
        return MAJOR_POWER_COLORS[country_id]
    import hashlib
    h = int(hashlib.md5(country_id.encode("utf-8")).hexdigest(), 16)
    hue = h % 360
    sat = 32 + (h // 360) % 26  # 32-57%
    light = 36 + (h // 360 // 26) % 18  # 36-53%
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
                  capital_region_id: int | None, puppets: list[str], color: str,
                  currency_zone_anchor: str | None = None) -> dict:
    """Только авторские поля (docs/plans/05_DATA_LAYOUT.md, Срез 2) — нулевые
    рантайм-блоки (technology/military/stockpile/researchedTechnologyIds/goals/
    population, пустая diplomacy) не пишутся: их дефолтит createCountry на
    загрузке (server/src/data/countries/templates/CreateCountry.ts). politics —
    только ideology (реально варьируется по стране), остальные поля политики —
    единый дефолт для всего реестра стран, тоже не авторские данные."""
    profile = dict(ARCHETYPES[economy_type])
    profile["spending"] = dict(profile["spending"])
    country = {
        "id": country_id,
        "name": name_en,
        "shortName": name_en[:24],
        "color": color,
        "capitalRegionId": capital_region_id if capital_region_id is not None else 0,
        "economyType": economy_type,
        "economyProfile": profile,
        "politics": {"ideology": ideology},
    }
    if puppets:
        country["diplomacy"] = {"puppets": puppets, "sphereOfInfluence": list(puppets)}
    if currency_zone_anchor:
        country["currencyZoneAnchor"] = currency_zone_anchor
    return country


def main():
    catalog = load_json(OUT_DIR / "countries_1946.json")
    catalog = {CATALOG_CODE_ALIASES.get(k, k): v for k, v in catalog.items()}
    regions = load_regions_combined()

    # Подставляем subject_of там, где MAP отдаёт суверена, но политически
    # территория зависима (см. SUBJECT_OVERRIDES) — после этого код ниже
    # обрабатывает её как нативную subject_of запись (как PSE).
    for code, suzerain in SUBJECT_OVERRIDES.items():
        if code in catalog and not catalog[code].get("subject_of"):
            catalog[code]["subject_of"] = suzerain

    preserve, owner_overrides = load_entity_config(catalog)
    merge_map = build_merge_map(catalog, preserve, owner_overrides)
    MERGE_OUT.write_text(json.dumps(merge_map, ensure_ascii=False, indent=2), encoding="utf-8")

    # Применяем объединение к regions.state.json: владелец-колония -> код блока.
    # Без этого регионы продолжали бы ссылаться на ISO-коды, исчезнувшие
    # из реестра стран после объединения.
    changed = 0
    for r in regions:
        merged = merge_map.get(r["ownerCountryId"])
        if merged:
            r["ownerCountryId"] = merged
            changed += 1
    if changed:
        write_regions_state(regions)
        print(f"regions.state.json: {changed} регионов переключены на код блока-владельца")

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

    CAPITAL_REGION_OVERRIDES = {
        "SUN": 318,   # Москва
        "USA": 990,   # Округ Колумбия (Вашингтон)
        "GBR": 124,   # Большой Лондон
        "FRA": 108,   # Иль-де-Франс (Париж)
        "DNK": 67,    # Столичный регион (Копенгаген)
        "CAN": 787,   # Онтарио (Оттава)
        "BRA": 1055,  # Рио-де-Жанейро
        "ITA": 175,   # Лацио (Рим)
        "JPN": 557,   # Канто (Токио)
        "TWN": 382,   # Цзянсу (Нанкин)
        "AFG": 433,   # Баглан (Кабул)
        "EGY": 1134,  # Каир
        "GUY": 1114,  # регион, содержащий Джорджтаун (point-in-polygon)
        "SUR": 1116,  # регион, содержащий Парамарибо (point-in-polygon)
        "GUF": 1070,  # единственный регион, содержит Кайенну
        "FLK": 1072,  # Falkland Islands, содержит Стэнли; не South Georgia
        "BHS": 829,   # Bahamas, содержит Нассау
        "BLZ": 835,   # Belize District, содержит Belize City (столица в 1946)
        "BMU": 828,   # Bermuda, содержит Гамильтон
        "BRB": 827,   # Barbados, содержит Бриджтаун
        "JAM": 862,   # Jamaica, содержит Кингстон; не Cayman/Turks dependencies
        "NFD": 781,   # Newfoundland, содержит St. John's
        "PRI": 915,   # Puerto Rico, содержит San Juan
        "SPM": 914,   # Saint Pierre and Miquelon, содержит Saint-Pierre
        "TTO": 925,   # Trinidad, содержит Port of Spain; не Tobago
        "VIR": 928,   # US Virgin Islands, содержит Charlotte Amalie
        "QWL": 824,   # Antigua, содержит St. John's — резиденцию Governor
        "QWW": 845,   # Grenada, содержит St. George's — резиденцию Governor
        "QND": 843,   # Curaçao, содержит Willemstad
        "MTQ": 774,   # Martinique, содержит Fort-de-France
        "GLP": 775,   # Guadeloupe, содержит Basse-Terre
        "CYP": 41,    # Nicosia
        "GIB": 125,   # Gibraltar
        "MLT": 194,   # Malta Xlokk, содержит Valletta (point-in-polygon)
    }

    countries = []
    for country_id in sorted(final_owner_ids):
        capital_region_id = CAPITAL_REGION_OVERRIDES.get(country_id)
        if capital_region_id is None:
            capital_region_id = best_region_by_owner.get(country_id, (None, 0))[0]
        puppets = puppets_by_suzerain.get(country_id, [])
        color = colors[country_id]

        currency_zone_anchor = CURRENCY_ZONE_ANCHOR.get(country_id)

        if country_id in CUSTOM_COUNTRIES:
            meta = CUSTOM_COUNTRIES[country_id]
            countries.append(make_country(country_id, meta["name_en"], meta["economy"], meta["ideology"], capital_region_id, puppets, color, currency_zone_anchor))
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
        countries.append(make_country(country_id, name_en, economy_type, ideology, capital_region_id, puppets, color, currency_zone_anchor))

    # Военное/договорное присутствие (см. SPHERE_OVERRIDES) — только сфера
    # влияния, без тонирования цвета и без puppets (страны остаются
    # суверенными в данных, см. docs/DECISIONS.md).
    for country in countries:
        extra_sphere = SPHERE_OVERRIDES.get(country["id"])
        if extra_sphere:
            diplomacy = country.setdefault("diplomacy", {"puppets": [], "sphereOfInfluence": []})
            diplomacy["sphereOfInfluence"].extend(extra_sphere)

    COUNTRIES_OUT.parent.mkdir(parents=True, exist_ok=True)
    COUNTRIES_OUT.write_text(json.dumps(countries, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Стран: {len(countries)} -> {COUNTRIES_OUT}")
    bloc_codes = set(COLONY_BLOC_CODES.values())
    legacy_merged = {source: target for source, target in merge_map.items() if target in bloc_codes}
    historical_overrides = {source: target for source, target in merge_map.items() if target not in bloc_codes}
    print(f"Колониальных блоков: {len(set(legacy_merged.values()))}, объединено записей: {len(legacy_merged)}")
    print(f"Отдельных курированных сущностей: {len(preserve)}, historical owner overrides: {len(historical_overrides)}")
    print(f"Merge-карта -> {MERGE_OUT}")


if __name__ == "__main__":
    main()
