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
import hashlib
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

# Кастомные записи, отсутствующие в каталоге MAP: зоны оккупации, Тайвань и
# исторические администрации, собранные из нескольких современных ISO-кодов.
CUSTOM_COUNTRIES = {
    "QGS": {"name_en": "Soviet Occupation Zone (Germany)", "name_ru": "Советская оккупационная зона (Германия)", "ideology": "Communism", "economy": "planned"},
    "QGA": {"name_en": "American Occupation Zone (Germany)", "name_ru": "Американская оккупационная зона (Германия)", "ideology": "Liberal Democracy", "economy": "market"},
    "QGB": {"name_en": "British Occupation Zone (Germany)", "name_ru": "Британская оккупационная зона (Германия)", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QGF": {"name_en": "French Occupation Zone (Germany)", "name_ru": "Французская оккупационная зона (Германия)", "ideology": "Liberal Democracy", "economy": "mixed"},
    "TWN": {"name_en": "Republic of China (Kuomintang)", "name_ru": "Китайская Республика (Гоминьдан)", "ideology": "Nationalism", "economy": "mixed"},
    "QKS": {"name_en": "Soviet Occupation Zone (Korea)", "name_ru": "Советская оккупационная зона (Корея)", "ideology": "Communism", "economy": "planned"},
    "QKA": {"name_en": "American Occupation Zone (Korea)", "name_ru": "Американская оккупационная зона (Корея)", "ideology": "Liberal Democracy", "economy": "market"},
    "QMS": {"name_en": "Soviet-administered Manchuria", "name_ru": "Маньчжурия под советским управлением", "ideology": "Communism", "economy": "planned"},
    # Иранский кризис 1946 — два просоветских квазигосударства (разгромлены
    # Тегераном в декабре 1946), см. occupation_overlay.json::_iran_crisis_1946.
    "QAZ": {"name_en": "Azerbaijan People's Government", "name_ru": "Азербайджанское национальное правительство", "ideology": "Communism", "economy": "planned"},
    "QMH": {"name_en": "Republic of Mahabad", "name_ru": "Мехабадская Республика", "ideology": "Communism", "economy": "planned"},
    # Британский Сомалиленд — код нормализован из составного MAP-кода SOM_GBR
    # на 3-буквенный private-use (см. import_to_game.py::OWNER_CODE_ALIASES);
    # из-за смены кода каталог MAP по нему не матчится напрямую, поэтому здесь.
    # Юридически британский протекторат (см. docs/DECISIONS.md, запись
    # 2026-06-28) — не заведён как `preserve`-запись в country_entities_1946.json:
    # `CATALOG_CODE_ALIASES` (SOM_GBR -> QSO) применяется только в `main()`
    # этого файла, а тестовый harness (`test_country_entities_1946.py`)
    # читает сырой каталог без алиаса, где ключ всё ещё `SOM_GBR` — preserve-
    # запись под `QSO` там не смогла бы найти код и падала бы.
    "QSO": {"name_en": "British Somaliland", "name_ru": "Британский Сомалиленд", "ideology": "Liberal Democracy", "economy": "mixed"},
    # Исторические карибские администрации на дату снимка. Современные ISO3
    # островов сводятся к ним через country_entities_1946.json.
    "QWL": {"name_en": "Leeward Islands", "name_ru": "Наветренные острова", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QWW": {"name_en": "Windward Islands", "name_ru": "Подветренные острова", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QND": {"name_en": "Curaçao and Dependencies", "name_ru": "Кюрасао и зависимые территории", "ideology": "Liberal Democracy", "economy": "mixed"},
    "MTQ": {"name_en": "Martinique", "name_ru": "Мартиника", "ideology": "Liberal Democracy", "economy": "mixed"},
    "GLP": {"name_en": "Guadeloupe", "name_ru": "Гваделупа", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QFW": {"name_en": "French West Africa", "name_ru": "Французская Западная Африка", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QFE": {"name_en": "French Equatorial Africa", "name_ru": "Французская Экваториальная Африка", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QRU": {"name_en": "Ruanda-Urundi", "name_ru": "Руанда-Урунди", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QTB": {"name_en": "Tibet", "name_ru": "Тибет", "ideology": "Traditionalism", "economy": "mixed"},
    "QSI": {"name_en": "Kingdom of Sikkim", "name_ru": "Королевство Сикким", "ideology": "Traditionalism", "economy": "mixed"},
    "QJK": {"name_en": "Jammu and Kashmir", "name_ru": "Джамму и Кашмир", "ideology": "Traditionalism", "economy": "mixed"},
    "QPI": {"name_en": "Portuguese India", "name_ru": "Португальская Индия", "ideology": "Authoritarianism", "economy": "mixed"},
    "QFI": {"name_en": "French India", "name_ru": "Французская Индия", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QNB": {"name_en": "North Borneo", "name_ru": "Северный Борнео", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QSR": {"name_en": "Sarawak", "name_ru": "Саравак", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QLB": {"name_en": "Labuan", "name_ru": "Лабуан", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QDV": {"name_en": "Democratic Republic of Vietnam", "name_ru": "Демократическая Республика Вьетнам", "ideology": "Communism", "economy": "planned"},
    "QRI": {"name_en": "Republic of Indonesia", "name_ru": "Республика Индонезия", "ideology": "Nationalism", "economy": "mixed"},
    # QAB/QDU/QSH/QAJ/QUQ/QRK/QFU (Trucial Sheikhdoms) are, per the same UK
    # Home Office 1949 terminology as KWT/BHR/QAT/BRN (see country_entities_
    # 1946.json, asia.subjectOverrides), British Protected States rather than
    # Protectorates — each ruler retained full internal government, Britain
    # controlled only external affairs. Not modeled as a subjectOverride
    # because these are CUSTOM_COUNTRIES entries with no catalog subject_of/
    # subject_type field for subjectOverrides to target; documentation parity
    # only, no mechanical effect (see build_merge_map/build_puppets_by_suzerain).
    "QAB": {"name_en": "Abu Dhabi", "name_ru": "Абу-Даби", "ideology": "Traditionalism", "economy": "mixed"},
    "QDU": {"name_en": "Dubai", "name_ru": "Дубай", "ideology": "Traditionalism", "economy": "mixed"},
    "QSH": {"name_en": "Sharjah", "name_ru": "Шарджа", "ideology": "Traditionalism", "economy": "mixed"},
    "QAJ": {"name_en": "Ajman", "name_ru": "Аджман", "ideology": "Traditionalism", "economy": "mixed"},
    "QUQ": {"name_en": "Umm Al Quwain", "name_ru": "Умм-эль-Кайвайн", "ideology": "Traditionalism", "economy": "mixed"},
    "QRK": {"name_en": "Ras Al Khaimah", "name_ru": "Рас-эль-Хайма", "ideology": "Traditionalism", "economy": "mixed"},
    "QFU": {"name_en": "Fujairah", "name_ru": "Фуджейра", "ideology": "Traditionalism", "economy": "mixed"},
    "QAD": {"name_en": "Aden Colony and Protectorate", "name_ru": "Колония и протекторат Аден", "ideology": "Traditionalism", "economy": "mixed"},
    "NFK": {"name_en": "Norfolk Island", "name_ru": "Остров Норфолк", "ideology": "Liberal Democracy", "economy": "mixed"},
    "QPS": {"name_en": "U.S. Naval Administration of the Former Japanese Mandated Islands", "name_ru": "Военно-морская администрация США бывших японских подмандатных островов", "ideology": "Liberal Democracy", "economy": "mixed"},
    # Занзибарский протекторат (свой султан) — юридически отделён от
    # Танганьики в 1946; уния (Танзания) состоялась только в 1964.
    "QZN": {"name_en": "Zanzibar Protectorate", "name_ru": "Занзибарский протекторат", "ideology": "Traditionalism", "economy": "mixed"},
}

# Суверены, исторически идущие с плановой экономикой/коммунистической идеологией.
PLANNED_ECONOMY_SOVEREIGNS = {"SUN", "YUG", "CHN", "MNG"}

# Зависимые сущности без записи в каталоге MAP — добавляются в puppets/
# sphereOfInfluence сюзерена напрямую, минуя catalog-driven путь subject_of.
PUPPET_OVERRIDES = {
    "SUN": ["QAZ", "QMH"],
    "GBR": ["QWL", "QWW", "QSI", "QJK", "QNB", "QSR", "QLB",
            "QAB", "QDU", "QSH", "QAJ", "QUQ", "QRK", "QFU", "QAD", "QZN"],
    "NLD": ["QND"],
    "FRA": ["MTQ", "GLP", "QFW", "QFE", "QFI"],
    "PRT": ["QPI"],
    "BEL": ["QRU"],
    "USA": ["QPS"],
    "AUS": ["NFK"],
}

# Тот же составной код MAP, что нормализуется в import_to_game.py — здесь
# нужен повторно, т.к. countries_1946.json (каталог) хранит исходный код
# ключом словаря, независимо от того, что regions.state.json уже на QSO.
CATALOG_CODE_ALIASES = {"SOM_GBR": "QSO"}

# Военное/договорное присутствие держав на 1946, НЕ территориальное владение —
# страны остаются суверенными (свой цвет, не тонируются), только входят в
# sphereOfInfluence сюзерена. Сирия/Ливан — французские войска до сер. 1946;
# Египет — британская зона Суэцкого канала.
SPHERE_OVERRIDES = {"FRA": ["SYR", "LBN"], "GBR": ["EGY"]}

# Курированные цвета для крупных/узнаваемых держав 1946 — яркая, контрастная
# палитра в духе классических цветов Paradox-игр (HOI4/EU4), не приглушённый
# midtone (было раньше, пользователь попросил "сочнее" 2026-07-18) и не
# хэш-рандом. Традиционные ассоциации: СССР красный, "имперский розовый"
# Британии, США синий и т.д. Остальные страны — deterministic_color, см. ниже.
MAJOR_POWER_COLORS = {
    "SUN": "#C13A3A",  # СССР — яркий кирпично-красный
    "USA": "#3D6FB4",  # США — насыщенный синий (классическая Paradox-ассоциация)
    "GBR": "#C25B7C",  # Великобритания — "имперский розовый", насыщеннее
    "FRA": "#3FA0A0",  # Франция — яркая бирюза (традиция колон. карт)
    "CHN": "#D9722E",  # Китай (КПК) — яркий красно-оранжевый
    "TWN": "#2E5FA6",  # Тайвань (Гоминьдан) — синий (цвет партии)
    "ITA": "#4CA86A",  # Италия — яркий зелёный
    "JPN": "#A33F3F",  # Япония — тёмно-красный, отличим от СССР
}

# Дополнительные узнаваемые суверенные державы — та же яркая палитра, реальные
# флаго-геральдические ассоциации ("что твердят про Испанию — жёлтый" и т.п.,
# пользовательский ориентир). Доминионы (CAN/AUS/NZL/ZAF) сюда же — формально
# у них есть subject_of=GBR в данных (Content Commonwealth), но геймплейно
# это самоуправляемые державы, не колонии — не тонируются от Британии,
# получают свою идентичность, как и суверены выше.
CURATED_SOVEREIGN_COLORS = {
    "CAN": "#C0453F",  # Канада — красный (Red Ensign 1946)
    "AUS": "#3E8F4A",  # Австралия — зелёный (нац. цвета "green and gold")
    "NZL": "#2B3A6B",  # Новая Зеландия — тёмно-синий (Кодекс Silver Fern/флаг)
    "ZAF": "#D98A2E",  # Южно-Африканский Союз — оранжевый (полоса флага 1946)
    "ESP": "#E0B62E",  # Испания — жёлтый
    "SWE": "#3560B0",  # Швеция — синий
    "POL": "#C0393F",  # Польша — красный
    "TUR": "#B5452E",  # Турция — терракотовый красный (отличим от Польши/СССР)
    "MEX": "#4FA23E",  # Мексика — зелёный (флаг), оттенок отличим от Австралии
    "BRA": "#4CA860",  # Бразилия — зелёный (флаг), светлее/ярче
    "ARG": "#6EB5E0",  # Аргентина — голубой
    "EGY": "#1F1F5C",  # Египет — тёмно-синий (отличим от соседей по региону)
    "IRN": "#4A9C5C",  # Иран — зелёный, свой оттенок
    "IRQ": "#2A2A2A",  # Ирак — чёрный (пан-арабские цвета)
    "SAU": "#1F6B3F",  # Саудовская Аравия — глубокий зелёный (флаг)
    "NLD": "#D9722E",  # Нидерланды — оранжевый (Дом Оранских)
    "BEL": "#C0393F",  # Бельгия — красный
    "DNK": "#A8303F",  # Дания — красный, чуть темнее (отличим от Бельгии)
    "NOR": "#8F2E3F",  # Норвегия — тёмно-красный
    "GRC": "#3560B0",  # Греция — синий
    "CHE": "#B03040",  # Швейцария — красный, свой оттенок
    "PRT": "#2E7A4A",  # Португалия — зелёный, темнее/лесной
    "YUG": "#3560B0",  # Югославия — синий (пан-славянские цвета)
    "ROU": "#E0B62E",  # Румыния — жёлтый
    "HUN": "#3E7A3A",  # Венгрия — зелёный, темнее/лесной
    "CSK": "#4560A0",  # Чехословакия — синий, свой оттенок
    "BGR": "#5C9C3E",  # Болгария — светло-зелёный
    "FIN": "#2B3A6B",  # Финляндия — тёмно-синий
}

# Зоны оккупации/администрации тонируются от цвета державы-оккупанта (тот же
# механизм, что и для вассалов, см. tint_from_suzerain) — даже если формально
# не входят в diplomacy.puppets (другой механизм данных, см. occupation_overlay).
# QSO (Британский Сомалиленд) сюда исторически попадал, но фактически уже
# тонировался через suzerain_of (аналогичный catalog-driven путь) — реальный
# протекторат с будущей независимой идентичностью (Сомали, 1960), не временная
# военная администрация, поэтому теперь в CURATED_DEPENDENCY_COLORS вместо
# зонового тонирования (см. ниже).
ZONE_TINT_SUZERAIN = {
    "QGS": "SUN", "QGA": "USA", "QGB": "GBR", "QGF": "FRA",
    "QKS": "SUN", "QKA": "USA", "QMS": "SUN",
    "QAZ": "SUN", "QMH": "SUN",
}

# Двойной сюзерен (condominium) — единственный настоящий структурный случай,
# где "тонировка от сюзерена" не определена однозначно (два сюзерена, откуда
# брать оттенок?). Раньше (2026-07-18, первый черновик) сюда же попадали ВСЕ
# зависимые территории с собственным identity-цветом — по фидбеку пользователя
# это неверно: зависимость должна визуально читаться как "принадлежит X"
# (тонировка от сюзерена, см. tint_from_suzerain), а не быть неотличимой от
# суверенной страны. Обычные зависимости (Ямайка, Гонконг, Кувейт и т.д.)
# больше не здесь — идут через tint_from_suzerain() ниже.
CURATED_DEPENDENCY_COLORS = {
    "VUT": "#7a5c8f", "SDN": "#8f7a4a",
}

# Русские названия суверенных стран каталога MAP (2026-07-18, по запросу
# пользователя перевести весь оставшийся реестр) — обычные общепринятые
# русские экзонимы. Не через preserve/historicalNameRu, т.к. это не
# зависимые территории и не требуют provenance-аудита колониального статуса;
# просто прямой словарь код -> русское имя, читается в name_ru_by_code (main()).
SOVEREIGN_NAME_RU = {
    "AFG": "Афганистан", "ALA": "Аландские острова", "ALB": "Албания", "AND": "Андорра",
    "ARG": "Аргентина", "AUS": "Австралия", "AUT": "Австрия", "BEL": "Бельгия",
    "BGR": "Болгария", "BOL": "Боливия", "BRA": "Бразилия", "BTN": "Бутан",
    "CAN": "Канада", "CHE": "Швейцария", "CHL": "Чили", "CHN": "Китай",
    "CMR": "Французский Камерун", "COD": "Бельгийское Конго", "COL": "Колумбия",
    "CRI": "Коста-Рика", "CSK": "Чехословакия", "CUB": "Куба", "DNK": "Дания",
    "DOM": "Доминиканская Республика", "ECU": "Эквадор", "EGY": "Египет", "ESP": "Испания",
    "ETH": "Эфиопия", "FIN": "Финляндия", "FRA": "Франция", "GBR": "Великобритания",
    "GRC": "Греция", "GRL": "Гренландия", "GTM": "Гватемала", "HND": "Гондурас",
    "HTI": "Гаити", "HUN": "Венгрия", "IRL": "Ирландия", "IRN": "Иран",
    "IRQ": "Ирак", "ISL": "Исландия", "ITA": "Италия", "JOR": "Иордания",
    "JPN": "Япония", "KHM": "Французская Камбоджа", "LAO": "Французский Лаос",
    "LBN": "Ливан", "LBR": "Либерия", "LIE": "Лихтенштейн", "LUX": "Люксембург",
    "MCO": "Монако", "MEX": "Мексика", "MNG": "Монголия", "NAM": "Юго-Западная Африка",
    "NIC": "Никарагуа", "NLD": "Нидерланды", "NOR": "Норвегия", "NPL": "Непал",
    "NRU": "Науру", "NZL": "Новая Зеландия", "OMN": "Оман", "PAN": "Панама",
    "PER": "Перу", "PHL": "Филиппины", "POL": "Польша", "PRT": "Португалия",
    "PRY": "Парагвай", "PSE": "Подмандатная Палестина", "ROU": "Румыния",
    "SAU": "Саудовская Аравия", "SLV": "Сальвадор", "SMR": "Сан-Марино",
    "SUN": "Советский Союз", "SWE": "Швеция", "SYR": "Сирия", "TGO": "Французское Того",
    "THA": "Таиланд", "TUR": "Турция", "TZA": "Танганьика", "URY": "Уругвай",
    "USA": "Соединённые Штаты Америки", "VAT": "Ватикан", "VEN": "Венесуэла",
    "YEM": "Йемен", "YUG": "Югославия", "ZAF": "Южно-Африканский Союз",
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


def load_entity_config(catalog: dict) -> tuple[set[str], dict[str, str], dict[str, str]]:
    """Читает курированные сущности 1946 и проверяет их против MAP-каталога.

    `preserve` исключает реальную зависимую территорию из искусственного
    мирового блока. `ownerOverrides` сводит современный ISO-код к реально
    существовавшей на дату снимка администрации. `subjectOverrides` исправляет
    историческую зависимость до построения diplomacy.
    """
    config = load_json(ENTITY_CONFIG)
    if config.get("_meta", {}).get("snapshotDate") != "1946-01-01":
        raise ValueError(f"{ENTITY_CONFIG}: snapshotDate должен быть 1946-01-01")

    subject_overrides: dict[str, str] = {}
    for continent, section in config.get("continents", {}).items():
        for override in section.get("subjectOverrides", []):
            code = override["code"]
            target = override["to"]
            if code in subject_overrides:
                raise ValueError(f"{ENTITY_CONFIG}: дубликат subject override для {code}")
            if code not in catalog or target not in catalog:
                raise ValueError(
                    f"{ENTITY_CONFIG}: subject override {code}->{target} ссылается на отсутствующий код"
                )
            subject_overrides[code] = target
            catalog[code]["subject_of"] = target
            catalog[code]["subject_type"] = override["subjectType"]

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
    return preserve, owner_overrides, subject_overrides


def build_merge_map(catalog: dict, preserve: set[str], owner_overrides: dict[str, str]) -> dict:
    """source ISO3 -> исторический owner.

    Все шесть континентов обработаны в country_entities_1946.json — каждая
    колония с count > 1 на суверена либо явно preserve, либо явно
    owner_overrides. Временный fallback на искусственные колониальные блоки
    (`QCG/QCF/QCP/QCN/QCU/QCZ/QCS`), нужный только пока континенты
    коммитились по одному, удалён — проверено (test_country_entities_1946.py,
    полный regen), что ни один код в него больше не попадает.

    Разрешает цепочки транзитивно (fixed point): например
    `SGS -> FLK` + `FLK -> GBR` (Falkland Islands сам свёрнут в прямое
    владение 2026-07-18) даёт `SGS -> GBR` напрямую — без этого South Georgia
    осталась бы приписана к несуществующему более "FLK" вместо реального
    финального владельца."""
    merge_map = dict(owner_overrides)
    changed = True
    while changed:
        changed = False
        for source, target in list(merge_map.items()):
            resolved = merge_map.get(target)
            if resolved and resolved != target:
                merge_map[source] = resolved
                changed = True
    return merge_map


def build_puppets_by_suzerain(catalog: dict, merge_map: dict) -> dict[str, list[str]]:
    """suzerain -> список subject-кодов, для стран не вошедших в merge.

    `subject_of` может быть списком (двойной сюзерен — condominium, напр.
    New Hebrides/`["GBR","FRA"]`, Anglo-Egyptian Sudan/`["GBR","EGY"]`) — код
    добавляется puppet'ом КАЖДОГО сюзерена, иначе второй сюзерен молча теряет
    запись в `diplomacy.puppets`/`sphereOfInfluence` (был баг: бралcя только
    `subject_of[0]`).
    """
    puppets_by_suzerain: dict[str, list[str]] = {}
    for code, info in catalog.items():
        subject_of = info.get("subject_of")
        if not subject_of or code in merge_map:
            continue
        suzerains = subject_of if isinstance(subject_of, list) else [subject_of]
        for suzerain in suzerains:
            puppets_by_suzerain.setdefault(suzerain, []).append(code)

    for suzerain, subs in PUPPET_OVERRIDES.items():
        puppets_by_suzerain.setdefault(suzerain, []).extend(subs)
    return puppets_by_suzerain


def deterministic_color(country_id: str) -> str:
    """Курированный цвет для крупных/узнаваемых держав, иначе стабильный
    хэш-цвет (HSL). Диапазон sat/light — яркий, "сочный" Paradox-стиль
    (2026-07-18, по фидбеку пользователя; было приглушённо-муторное
    32-57%/36-53%, читалось как "нужно напрягаться, чтобы отличить")."""
    if country_id in MAJOR_POWER_COLORS:
        return MAJOR_POWER_COLORS[country_id]
    if country_id in CURATED_SOVEREIGN_COLORS:
        return CURATED_SOVEREIGN_COLORS[country_id]
    h = int(hashlib.md5(country_id.encode("utf-8")).hexdigest(), 16)
    hue = h % 360
    sat = 55 + (h // 360) % 31  # 55-85%
    light = 38 + (h // 360 // 31) % 22  # 38-59%
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


def tint_from_suzerain(suzerain_hex: str, territory_code: str) -> str:
    """Зависимая территория: детерминированный разброс оттенка от цвета
    сюзерена (не плоская desaturate/lighten) — территория явно читается как
    "из той же цветовой семьи" сюзерена (пользователь 2026-07-18: должно быть
    видно, кто кому принадлежит), но каждая зависимость получает свой оттенок,
    засеянный собственным кодом, так что два вассала одного сюзерена не
    рендерятся совсем одним цветом. Легче осветление/десатурация, чем раньше —
    "сочный" стиль вместо приглушённого midtone."""
    h, s, l = hex_to_hsl(suzerain_hex)
    seed = int(hashlib.md5(territory_code.encode("utf-8")).hexdigest(), 16)
    hue_offset = (seed % 41) - 20
    sat_offset = 2 + (seed // 41) % 10
    light_offset = 6 + (seed // 41 // 10) % 12
    new_h = (h + hue_offset) % 360
    new_s = max(35.0, s - sat_offset)
    new_l = min(78.0, l + light_offset)
    return hsl_to_hex(new_h, new_s, new_l)


# Доминионы — формально subject_of=GBR в исходных данных (Content
# Commonwealth), но геймплейно самоуправляемые державы 1946 года (свой
# внешнеполитический курс, не колонии) — получают собственный identity-цвет,
# не тонировку от Британии (см. CURATED_SOVEREIGN_COLORS выше).
DOMINION_EXCEPTIONS = {"CAN", "AUS", "NZL", "ZAF"}


def build_country_adjacency(regions: list[dict], merge_map: dict) -> dict[str, set[str]]:
    """country -> множество стран, чьи регионы граничат с её регионами.
    Нужно для disambiguate_from_neighbors — две соседние страны на карте не
    должны получать одинаковый/почти одинаковый цвет."""
    by_id = {r["id"]: r for r in regions}
    adjacency: dict[str, set[str]] = {}
    for r in regions:
        owner = merge_map.get(r["ownerCountryId"], r["ownerCountryId"])
        for neighbor_id in r.get("neighboringRegionIds") or []:
            neighbor = by_id.get(neighbor_id)
            if not neighbor:
                continue
            other_owner = merge_map.get(neighbor["ownerCountryId"], neighbor["ownerCountryId"])
            if other_owner != owner:
                adjacency.setdefault(owner, set()).add(other_owner)
                adjacency.setdefault(other_owner, set()).add(owner)
    return adjacency


def _hue_distance(h1: float, h2: float) -> float:
    d = abs(h1 - h2) % 360
    return min(d, 360 - d)


def _colors_too_similar(hex_a: str, hex_b: str) -> bool:
    """Эвристика "на глаз почти одно и то же": близкий оттенок И близкая
    насыщенность И близкая светлота одновременно — если хоть одна ось сильно
    отличается, цвета уже читаются как разные, даже у соседей."""
    h1, s1, l1 = hex_to_hsl(hex_a)
    h2, s2, l2 = hex_to_hsl(hex_b)
    return _hue_distance(h1, h2) < 28 and abs(s1 - s2) < 22 and abs(l1 - l2) < 16


def disambiguate_from_neighbors(candidate_hex: str, neighbor_hexes: list[str], seed: str) -> str:
    """Если candidate слишком похож на цвет уже раскрашенного соседа —
    детерминированно вращаем оттенок шагами по 15° (направление засеяно кодом
    страны) пока не наберём контраст со ВСЕМИ уже раскрашенными соседями, или
    не исчерпаем бюджет попыток (тогда отдаём последнюю — лучше небольшая
    оставшаяся близость, чем зависание)."""
    if not any(_colors_too_similar(candidate_hex, n) for n in neighbor_hexes):
        return candidate_hex
    h, s, l = hex_to_hsl(candidate_hex)
    seed_val = int(hashlib.md5(seed.encode("utf-8")).hexdigest(), 16)
    direction = 1 if seed_val % 2 == 0 else -1
    best = candidate_hex
    for step in range(1, 13):
        new_h = (h + direction * step * 15) % 360
        attempt = hsl_to_hex(new_h, s, l)
        best = attempt
        if not any(_colors_too_similar(attempt, n) for n in neighbor_hexes):
            return attempt
    return best


def make_country(country_id: str, name_en: str, economy_type: str, ideology: str,
                  capital_region_id: int | None, puppets: list[str], color: str,
                  currency_zone_anchor: str | None = None, name_ru: str | None = None) -> dict:
    """Только авторские поля (docs/plans/05_DATA_LAYOUT.md, Срез 2) — нулевые
    рантайм-блоки (technology/military/stockpile/researchedTechnologyIds/goals/
    population, пустая diplomacy) не пишутся: их дефолтит createCountry на
    загрузке (server/src/data/countries/templates/CreateCountry.ts). politics —
    только ideology (реально варьируется по стране), остальные поля политики —
    единый дефолт для всего реестра стран, тоже не авторские данные.
    name/shortName — LocalizedText (shared/src/types/i18n/LocalizedText.ts):
    en всегда есть, ru — только если реально известен (name_ru), без
    выдуманного перевода для остальных стран реестра."""
    profile = dict(ARCHETYPES[economy_type])
    profile["spending"] = dict(profile["spending"])
    name: dict[str, str] = {"en": name_en}
    short_name: dict[str, str] = {"en": name_en[:24]}
    if name_ru:
        name["ru"] = name_ru
        short_name["ru"] = name_ru[:24]
    country = {
        "id": country_id,
        "name": name,
        "shortName": short_name,
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

    # Конфиг подставляет исторический subject status до вычисления diplomacy,
    # чтобы такие случаи, как Transjordan и Commonwealth Philippines, прошли
    # тот же catalog-driven путь, что и нативные зависимости.
    preserve, owner_overrides, _subject_overrides = load_entity_config(catalog)
    merge_map = build_merge_map(catalog, preserve, owner_overrides)
    MERGE_OUT.write_text(json.dumps(merge_map, ensure_ascii=False, indent=2), encoding="utf-8")

    # Русские имена: полный реестр 2026-07-18 (по запросу пользователя) —
    # SOVEREIGN_NAME_RU для суверенов каталога MAP, name_ru в CUSTOM_COUNTRIES
    # для кастомных сущностей, historicalNameRu в preserve для зависимых
    # территорий. Явный словарь на каждом уровне — без автоматического
    # перевода "на глаз", чтобы не внести ошибку в непроверенном имени.
    entity_config = load_json(ENTITY_CONFIG)
    name_ru_by_code: dict[str, str] = dict(SOVEREIGN_NAME_RU)
    name_ru_by_code.update({
        code: meta["name_ru"] for code, meta in CUSTOM_COUNTRIES.items() if "name_ru" in meta
    })
    for section in entity_config.get("continents", {}).values():
        for entry in section.get("preserve", []):
            if "historicalNameRu" in entry:
                name_ru_by_code[entry["code"]] = entry["historicalNameRu"]

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

    puppets_by_suzerain = build_puppets_by_suzerain(catalog, merge_map)

    # subject -> suzerain, для тонирования цвета вассалов (не колониальных
    # блоков — те держат отдельный акцентный цвет по решению, см. план).
    # Для двойного сюзерена (VUT/SDN) здесь остаётся только последний
    # встреченный суверен — не проблема, обе сущности получают собственный
    # курированный цвет (CURATED_DEPENDENCY_COLORS), минуя этот lookup.
    suzerain_of = {subj: suz for suz, subs in puppets_by_suzerain.items() for subj in subs}

    # Граф соседства стран (по общим границам регионов) — нужен, чтобы две
    # соседние страны никогда не получали одинаковый/почти одинаковый цвет
    # (пользователь 2026-07-18: "не пойму, какой субъект кому принадлежит").
    adjacency = build_country_adjacency(regions, merge_map)

    # Порядок обработки внутри каждого прохода — по убыванию числа соседей
    # (больше всего "стеснённые" страны сначала, пока выбор цвета ещё
    # максимально свободен; классическая Welsh-Powell-эвристика для раскраски
    # графов), при равенстве — по коду для детерминированности.
    processing_order = sorted(final_owner_ids, key=lambda c: (-len(adjacency.get(c, ())), c))

    colors: dict[str, str] = {}

    def finalize_color(country_id: str, candidate_hex: str) -> None:
        neighbor_hexes = [colors[n] for n in adjacency.get(country_id, ()) if n in colors]
        colors[country_id] = (
            disambiguate_from_neighbors(candidate_hex, neighbor_hexes, country_id)
            if neighbor_hexes else candidate_hex
        )

    # Проход 1 — суверены (включая доминионы, формально с subject_of=GBR в
    # данных, но геймплейно самоуправляемые, не тонируются, см.
    # DOMINION_EXCEPTIONS) и зоны оккупации/political clients (ZONE_TINT_SUZERAIN
    # тонируются от суверена, обрабатываются во 2 проходе). Нужен первым, чтобы
    # у зависимостей был готовый цвет сюзерена для тонировки.
    for country_id in processing_order:
        if country_id in DOMINION_EXCEPTIONS:
            finalize_color(country_id, deterministic_color(country_id))
            continue
        if country_id in suzerain_of or country_id in ZONE_TINT_SUZERAIN:
            continue
        finalize_color(country_id, deterministic_color(country_id))

    # Проход 2 — зависимые территории: тонировка от уже посчитанного цвета
    # сюзерена (или курированный цвет для структурных исключений с двойным
    # сюзереном, см. CURATED_DEPENDENCY_COLORS), с disambiguation против уже
    # раскрашенных соседей (суверенов и других зависимостей раньше в этом же порядке).
    for country_id in processing_order:
        if country_id in colors:
            continue
        if country_id in CURATED_DEPENDENCY_COLORS:
            finalize_color(country_id, CURATED_DEPENDENCY_COLORS[country_id])
            continue
        suzerain = suzerain_of.get(country_id) or ZONE_TINT_SUZERAIN.get(country_id)
        suzerain_color = colors.get(suzerain) or (deterministic_color(suzerain) if suzerain else None)
        candidate = tint_from_suzerain(suzerain_color, country_id) if suzerain_color else deterministic_color(country_id)
        finalize_color(country_id, candidate)

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
        "NFD": 781,   # Newfoundland, содержит St. John's
        "QWL": 824,   # Antigua, содержит St. John's — резиденцию Governor
        "QWW": 845,   # Grenada, содержит St. George's — резиденцию Governor
        "QND": 843,   # Curaçao, содержит Willemstad
        "MTQ": 774,   # Martinique, содержит Fort-de-France
        "GLP": 775,   # Guadeloupe, содержит Basse-Terre
        "QFW": 1275,  # Louga, содержит Dakar — столицу AOF
        "QFE": 1320,  # Pool, содержит Brazzaville — столицу AEF
        "QRU": 1322,  # Bujumbura Rural, содержит Usumbura — административный центр
        "QZN": 1208,  # AFR-0089 "Zanzibar South and Central", содержит Zanzibar Town/Stone Town
        "AGO": 1221,  # Cuando Cubango source polygon, содержащий Luanda
        "MOZ": 1224,  # Gaza source polygon, содержит Lourenço Marques
        "MDG": 1207,  # Bongolava source polygon, содержащий Tananarive
        "GHA": 1245,  # Eastern source polygon, содержащий Accra
        "KEN": 1240,  # Rift Valley source polygon, содержащий Nairobi
        "NGA": 1192,  # Benue source polygon, содержащий Lagos
        "SLE": 1309,  # единственный Sierra Leone polygon, содержит Freetown
        "ZMB": 1269,  # Southern source polygon, содержащий Lusaka
        "ZWE": 1272,  # Mashonaland West source polygon, содержащий Salisbury
        "QTB": 413,   # Xizang polygon, содержит Lhasa
        "QSI": 491,   # Sikkim, содержит Gangtok
        "QJK": 504,   # Jammu and Kashmir, содержит Srinagar
        "QPI": 511,   # Goa, административный центр Portuguese India
        "QFI": 514,   # Puducherry
        "HKG": 462,   # Hong Kong
        "IND": 519,   # Delhi
        "LKA": 619,   # Ceylon, содержит Colombo
        "MMR": 621,   # Bago source polygon, содержащий Rangoon
        "MYS": 639,   # Perak source polygon, содержащий Kuala Lumpur
        "SGP": 682,   # Singapore
        "QNB": 635,   # Sabah, содержит Jesselton
        "QSR": 636,   # Sarawak, содержит Kuching
        "QLB": 638,   # Labuan
        "QDV": 749,   # Hà Nội
        "VNM": 751,   # Hồ Chí Minh city / Saigon
        "QRI": 482,   # Java polygon, содержит Yogyakarta
        "IDN": 479,   # Sulawesi Selatan, Dutch eastern-administration anchor
        "MAC": 634,   # Macau
        "QSH": 423,   # Sharjah
        "QRK": 424,   # Ras Al Khaimah
        "QAB": 425,   # Abu Dhabi
        "QUQ": 426,   # Umm Al Quwain
        "QAJ": 427,   # Ajman
        "QFU": 428,   # Fujairah
        "QDU": 429,   # Dubai
        "QAD": 772,   # Lahij source polygon, содержащий Aden
        "QPS": 1329,  # Northern Mariana Islands, Saipan administration anchor
        "COK": 1330,  # Cook Islands, Rarotonga
        "NFK": 1332,  # Norfolk Island, Kingston
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
            countries.append(make_country(country_id, meta["name_en"], meta["economy"], meta["ideology"], capital_region_id, puppets, color, currency_zone_anchor, name_ru_by_code.get(country_id)))
            continue

        if country_id in catalog:
            name_en = catalog[country_id]["name_en"]
        else:
            name_en = country_id

        economy_type = "planned" if country_id in PLANNED_ECONOMY_SOVEREIGNS else "mixed"
        ideology = "Communism" if economy_type == "planned" else "Liberal Democracy"
        countries.append(make_country(country_id, name_en, economy_type, ideology, capital_region_id, puppets, color, currency_zone_anchor, name_ru_by_code.get(country_id)))

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
    print(f"Отдельных курированных сущностей: {len(preserve)}, historical owner overrides: {len(merge_map)}")
    print(f"Merge-карта -> {MERGE_OUT}")


if __name__ == "__main__":
    main()
