"""
Якоря населения по странам на январь 1946 (docs/tasks/REGION_ECONOMY_FILL.md,
docs/HISTORICAL_ACCURACY.md). Заменяет провалившую аудит попытку (Gemini,
docs/DECISIONS.md 2026-07-03/07-04) — там Китай был задвоен (~1.01 млрд вместо
~500М), потому что каждому из трёх фрагментов (CHN/TWN/QMS) присвоили ПОЛНЫЙ
страновой тотал вместо деления одного тотала на три части.

Confidence:
  "verified"  — перепроверено веб-поиском в этой сессии (см. source).
  "estimated" — общие исторические знания, не пере-верифицено индивидуально;
                для большинства 20-века населения это надёжная, но не
                идущая к первоисточнику оценка.

ВАЖНО про Китай: population ниже — это ОДИН тотал на всю историческую Китай
(CHN+TWN+QMS вместе), не три отдельных числа. Разбивка на фрагменты — в
country_splits.py (там же обоснование пропорции).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Anchor:
    population: int
    confidence: str  # "verified" | "estimated"
    source: str


# Многофрагментные страны: population — ОБЩИЙ тотал исторической единицы,
# делится между несколькими ownerCountryId в country_splits.py.
MULTI_FRAGMENT_TOTALS: dict[str, Anchor] = {
    "CHINA_TOTAL": Anchor(
        490_000_000, "estimated",
        "Довоенная/современная-1946 оценка (Лига Наций 1933: ~450М; общепринятый "
        "диапазон эпохи 450-510М). Перепись 1953г (582.6М) вышла НАМНОГО позже и "
        "удивила современников — не использую её как ретроспективный анкер на "
        "1946, беру то, что считалось верным в эпоху. Делится между CHN/TWN/QMS."
    ),
    "GERMANY_TOTAL": Anchor(
        64_800_000, "verified",
        "Сумма 4 зон на конец 1946 (WebSearch): Soviet ~17.1М, American ~16.75М, "
        "French ~4.95М (со Saar), British ~26.0М (крупнейшая зона, включает "
        "Рур/Рейнланд — цифра не найдена напрямую, но 'largest of four' "
        "подтверждено, оценена как остаток от известного тотала Германии "
        "~64.8М по историческим сводкам). Делится между QGS/QGA/QGF/QGB."
    ),
    "KOREA_TOTAL": Anchor(
        25_500_000, "estimated",
        "Корея в целом ~25-26М на 1945-46 (довоенная оценка ~24М + репатрианты "
        "из Японии/Маньчжурии после капитуляции). Делится между QKS (север, "
        "меньше населения, больше промышленности) и QKA (юг, больше населения)."
    ),
    "RUANDA_URUNDI_TOTAL": Anchor(
        3_800_000, "estimated",
        "Руанда-Урунди как единая бельгийская подопечная территория midcentury. "
        "В данных числится под ДВУМЯ разными ownerCountryId (RWA и BDI) с "
        "одинаковым именем 'Ruanda-Urundi' — известный, задокументированный "
        "пробел в реестре стран (docs/DECISIONS.md, 2026-06-28), не мой "
        "уровень чинить (только заполняю экономику в рамках уже заданного "
        "владельца, REGION_ECONOMY_FILL.md п.2). Делю тотал 50/50 по площади "
        "(RWA=5 регионов, BDI=3 региона — не по числу регионов, а по area,"
        " см. country_splits.py)."
    ),
}

# Доли British India относительно исторического её же населения на 1941/46 —
# используется в country_splits.py для разбивки QCG (British Colonies bloc).
BRITISH_INDIA_1946 = Anchor(
    410_000_000, "verified",
    "1941 перепись: 388.8М (без Бирмы) — WebSearch подтвердил (Bengal 60.3М, "
    "United Provinces 55.0М). Экстраполяция к 1946 (~1.1%/год, 5 лет) даёт "
    "~410М. Британская Индия — крупнейшая составляющая блока QCG."
)

# Однофрагментные страны — population прямо есть anchor для этой ownerCountryId.
COUNTRY_POPULATION_1946: dict[str, Anchor] = {
    # === Великие державы (verified/хорошо документировано) ===
    "USA": Anchor(141_000_000, "estimated", "Общепринятая цифра нас. США 1946 (перепись 1940=132.2М, 1950=151.3М, интерполяция с учётом послевоенного бэби-бума с 1946)."),
    "SUN": Anchor(172_000_000, "estimated", "Довоенное ~196М (1939) минус военные потери (~27М) плюс частичное восстановление к 1946 — общепринятая оценка диапазона 170-175М."),
    "GBR": Anchor(49_200_000, "estimated", "Общепринятая перепись-близкая цифра (1951 перепись=50.2М, 1946 чуть ниже)."),
    "FRA": Anchor(40_100_000, "estimated", "Общепринятая (перепись 1946=40.1М, первая послевоенная перепись Франции)."),
    "ARG": Anchor(15_900_000, "estimated", "Общепринятая оценка midcentury для Аргентины."),
    "CAN": Anchor(12_300_000, "estimated", "Общепринятая оценка (перепись 1941=11.5М, 1951=14.0М, интерполяция)."),

    # === Регионалы/крупные (estimated, широко известные цифры) ===
    "ITA": Anchor(45_700_000, "estimated", "Перепись 1936=42.4М + рост к 1946, общепринятая ~45-46М."),
    "JPN": Anchor(75_000_000, "estimated", "Довоенное ~72М (1940) + репатрианты из империи после капитуляции, общепринятая ~75М для 1946 (без колоний)."),
    "BRA": Anchor(47_300_000, "estimated", "Перепись 1940=41.2М, интерполяция к 1946 при типичном росте ~2.4%/год."),
    "AUS": Anchor(7_500_000, "estimated", "Общепринятая оценка нас. Австралии midcentury."),
    "MEX": Anchor(23_000_000, "estimated", "Перепись 1940=19.6М, интерполяция к 1946."),
    "ZAF": Anchor(11_400_000, "estimated", "Общепринятая оценка (включая все группы населения) midcentury ЮАР."),
    "EGY": Anchor(19_000_000, "estimated", "Перепись 1947=19.0М, близко к 1946."),
    "TUR": Anchor(19_000_000, "estimated", "Перепись 1945=18.8М."),
    "IRN": Anchor(14_500_000, "estimated", "Общепринятая оценка Ирана midcentury."),
    "POL": Anchor(23_900_000, "estimated", "Послевоенная Польша (новые границы после Ялты/Потсдама, изгнание немцев с востока) — перепись 1946=23.9М."),
    "CSK": Anchor(12_200_000, "estimated", "Послевоенная Чехословакия (после изгнания судетских немцев) — оценка ~12.2М."),
    "YUG": Anchor(15_800_000, "estimated", "Общепринятая оценка Югославии midcentury."),
    "BGR": Anchor(7_000_000, "estimated", "Общепринятая оценка Болгарии midcentury."),
    "ROU": Anchor(15_800_000, "estimated", "Общепринятая оценка Румынии (после потери Бессарабии/Северной Буковины) midcentury."),
    "HUN": Anchor(9_000_000, "estimated", "Общепринятая оценка Венгрии (Трианон-границы) midcentury."),
    "SWE": Anchor(6_800_000, "estimated", "Общепринятая оценка Швеции midcentury."),
    "ESP": Anchor(27_900_000, "estimated", "Общепринятая оценка франкистской Испании midcentury."),
    "BEL": Anchor(8_400_000, "estimated", "Общепринятая оценка Бельгии midcentury."),
    "NLD": Anchor(9_400_000, "estimated", "Общепринятая оценка Нидерландов (метрополия) midcentury."),
    "DNK": Anchor(4_100_000, "estimated", "Общепринятая оценка Дании midcentury."),
    "NOR": Anchor(3_150_000, "estimated", "Общепринятая оценка Норвегии midcentury."),
    "AUT": Anchor(6_900_000, "estimated", "Общепринятая оценка Австрии midcentury."),
    "GRC": Anchor(7_300_000, "estimated", "Общепринятая оценка Греции midcentury."),
    "IRQ": Anchor(4_800_000, "estimated", "Общепринятая оценка Ирака midcentury."),
    "SAU": Anchor(3_200_000, "estimated", "Общепринятая оценка Саудовской Аравии midcentury (низкая плотность, кочевое население)."),
    "CHE": Anchor(4_400_000, "estimated", "Общепринятая оценка Швейцарии midcentury."),
    "IRL": Anchor(2_960_000, "estimated", "Общепринятая оценка Ирландии midcentury."),
    "PRT": Anchor(8_100_000, "estimated", "Общепринятая оценка Португалии (метрополия) midcentury."),
    "AFG": Anchor(9_500_000, "estimated", "Общепринятая оценка Афганистана midcentury (низкая точность источников)."),
    "MNG": Anchor(800_000, "estimated", "Общепринятая оценка Монголии midcentury (очень низкая плотность)."),
    "THA": Anchor(17_400_000, "estimated", "Общепринятая оценка Сиама/Таиланда midcentury."),
    "PHL": Anchor(18_600_000, "estimated", "Перепись 1948=19.2М, близко к 1946."),

    # === Ближний Восток / Средняя Азия ===
    "SYR": Anchor(3_200_000, "estimated", "Общепринятая оценка Сирии midcentury."),
    "LBN": Anchor(1_200_000, "estimated", "Общепринятая оценка Ливана midcentury."),
    "JOR": Anchor(400_000, "estimated", "Трансиордания до массового притока палестинских беженцев (после 1948) — малочисленна."),
    "PSE": Anchor(1_900_000, "estimated", "Подмандатная Палестина 1946 (арабы+евреи) — общепринятая оценка."),
    "OMN": Anchor(500_000, "estimated", "Общепринятая оценка Омана midcentury (низкая точность)."),
    "YEM": Anchor(3_500_000, "estimated", "Общепринятая оценка Йемена midcentury (низкая точность)."),
    "KWT": Anchor(90_000, "estimated", "До нефтяного бума — очень малочисленный Кувейт midcentury."),
    "BHR": Anchor(120_000, "estimated", "Общепринятая оценка Бахрейна midcentury."),
    "QAT": Anchor(30_000, "estimated", "Общепринятая оценка Катара midcentury (крайне малочисленный)."),
    "ARE": Anchor(80_000, "estimated", "Trucial States до нефти — очень малочисленны."),
    "QMH": Anchor(200_000, "estimated", "Мехабадская Республика (курдское квазигосударство) — малочисленна."),
    "QAZ": Anchor(1_000_000, "estimated", "Азербайджанская Народная Республика (советский протекторат в Иране) — оценка по региону."),

    # === Африка (страны/протектораты со своим ownerCountryId, не в колон. блоках) ===
    "ETH": Anchor(15_000_000, "estimated", "Общепринятая оценка Эфиопии midcentury."),
    "LBR": Anchor(1_500_000, "estimated", "Общепринятая оценка Либерии midcentury."),
    "SDN": Anchor(8_700_000, "estimated", "Англо-Египетский Судан — общепринятая оценка midcentury."),
    "TZA": Anchor(6_900_000, "estimated", "Танганьика (брит. подопечная территория) — общепринятая оценка."),
    "COD": Anchor(11_000_000, "estimated", "Бельгийское Конго — общепринятая оценка midcentury."),
    # RWA/BDI намеренно НЕ здесь — обе делят RUANDA_URUNDI_TOTAL через
    # split_ruanda_urundi() (country_splits.py), прямой анкер на одну из
    # них конфликтовал бы с этим механизмом (см. фикс 2026-07-04).
    "MWI": Anchor(2_400_000, "estimated", "Ньясаленд — общепринятая оценка midcentury."),
    "UGA": Anchor(4_900_000, "estimated", "Уганда — общепринятая оценка midcentury."),
    "NAM": Anchor(350_000, "estimated", "Юго-Западная Африка (мандат ЮАР) — низкая плотность."),
    "BWA": Anchor(300_000, "estimated", "Бечуаналенд — низкая плотность."),
    "LSO": Anchor(560_000, "estimated", "Басутоленд — общепринятая оценка."),
    "SWZ": Anchor(180_000, "estimated", "Свазиленд — общепринятая оценка."),
    "QSO": Anchor(700_000, "estimated", "Британский Сомалиленд — общепринятая оценка."),
    "TGO": Anchor(700_000, "estimated", "Французское Того (подопечная) — общепринятая оценка."),

    # === Латинская Америка (не в блоках) ===
    "CUB": Anchor(4_800_000, "estimated", "Общепринятая оценка Кубы midcentury."),
    "DOM": Anchor(1_900_000, "estimated", "Общепринятая оценка Доминиканской Республики midcentury."),
    "HTI": Anchor(3_100_000, "estimated", "Общепринятая оценка Гаити midcentury."),
    "GTM": Anchor(3_000_000, "estimated", "Общепринятая оценка Гватемалы midcentury."),
    "HND": Anchor(1_200_000, "estimated", "Общепринятая оценка Гондураса midcentury."),
    "NIC": Anchor(1_100_000, "estimated", "Общепринятая оценка Никарагуа midcentury."),
    "CRI": Anchor(700_000, "estimated", "Общепринятая оценка Костa-Рики midcentury."),
    "PAN": Anchor(700_000, "estimated", "Общепринятая оценка Панамы midcentury."),
    "SLV": Anchor(1_900_000, "estimated", "Общепринятая оценка Сальвадора midcentury."),
    "COL": Anchor(10_000_000, "estimated", "Общепринятая оценка Колумбии midcentury."),
    "VEN": Anchor(4_100_000, "estimated", "Общепринятая оценка Венесуэлы midcentury."),
    "PER": Anchor(7_600_000, "estimated", "Общепринятая оценка Перу midcentury."),
    "BOL": Anchor(3_400_000, "estimated", "Общепринятая оценка Боливии midcentury."),
    "ECU": Anchor(3_200_000, "estimated", "Общепринятая оценка Эквадора midcentury."),
    "CHL": Anchor(5_300_000, "estimated", "Общепринятая оценка Чили midcentury."),
    "PRY": Anchor(1_300_000, "estimated", "Общепринятая оценка Парагвая midcentury."),
    "URY": Anchor(2_300_000, "estimated", "Общепринятая оценка Уругвая midcentury."),
    "GUY": Anchor(
        377_000, "verified",
        "UN A/4192, table of approximate populations of Non-Self-Governing "
        "Territories in 1946: British Guiana 377,000."
    ),
    "SUR": Anchor(
        168_000, "verified",
        "UN A/4192, table of approximate populations of Non-Self-Governing "
        "Territories in 1946: Surinam 168,000."
    ),
    "GUF": Anchor(
        27_000, "verified",
        "UN A/4192, table of approximate populations of Non-Self-Governing "
        "Territories in 1946: French Guiana 27,000."
    ),
    "FLK": Anchor(
        2_629, "verified",
        "Falkland Islands Gazette 1947: census 31.03.1946 = 2,239; estimated "
        "Dependencies population at end-1946 = South Georgia 360 + other 30. "
        "Combined anchor follows the scenario owner FLK, which includes SGS."
    ),
    "BHS": Anchor(73_000, "verified", "UN A/4192: Bahamas, approximate 1946 population 73,000."),
    "BLZ": Anchor(60_000, "verified", "UN A/4192: British Honduras, approximate 1946 population 60,000."),
    "BMU": Anchor(35_000, "verified", "UN A/4192: Bermuda, approximate 1946 population 35,000."),
    "BRB": Anchor(193_000, "verified", "UN A/4192: Barbados, approximate 1946 population 193,000."),
    "JAM": Anchor(
        1_298_000, "verified",
        "UN A/4192: Jamaica, approximate 1946 population 1,298,000. Scenario "
        "owner includes Cayman Islands and Turks and Caicos, administered as "
        "dependencies of Jamaica in the 1946 snapshot."
    ),
    "NFD": Anchor(
        321_819, "verified",
        "Official 1945 Census of Newfoundland and Labrador total: 321,819."
    ),
    "SPM": Anchor(4_000, "verified", "UN A/4192: St. Pierre and Miquelon, approximate 1946 population 4,000."),
    "TTO": Anchor(561_000, "verified", "UN A/4192: Trinidad and Tobago, approximate 1946 population 561,000."),
    "QWL": Anchor(108_000, "verified", "UN A/4192: Leeward Islands, approximate 1946 population 108,000."),
    "QWW": Anchor(252_000, "verified", "UN A/4192: Windward Islands, approximate 1946 population 252,000."),
    "QND": Anchor(139_000, "verified", "UN A/4192: Curaçao, approximate 1946 population 139,000."),
    "PRI": Anchor(2_141_000, "verified", "UN A/4192: Puerto Rico, approximate 1946 population 2,141,000."),
    "VIR": Anchor(27_000, "verified", "UN A/4192: United States Virgin Islands, approximate 1946 population 27,000."),
    "MTQ": Anchor(209_000, "verified", "UN A/4192: Martinique, approximate 1946 population 209,000."),
    "GLP": Anchor(190_000, "verified", "UN A/4192: Guadeloupe, approximate 1946 population 190,000."),
    "CYP": Anchor(447_000, "verified", "UN A/4192: Cyprus, approximate 1946 population 447,000."),
    "GIB": Anchor(20_000, "verified", "UN A/4192: Gibraltar, approximate 1946 population 20,000."),
    "MLT": Anchor(291_000, "verified", "UN A/4192: Malta, approximate 1946 population 291,000."),

    # === Прочие мелкие/микро (низкая цена ошибки, широкие оценки) ===
    "ALB": Anchor(1_100_000, "estimated", "Общепринятая оценка Албании midcentury."),
    "AND": Anchor(5_500, "estimated", "Общепринятая оценка Андорры midcentury (микрогосударство)."),
    "ALA": Anchor(28_000, "estimated", "Аландские острова — общепринятая оценка."),
    "ISL": Anchor(130_000, "estimated", "Общепринятая оценка Исландии midcentury."),
    "LIE": Anchor(12_000, "estimated", "Лихтенштейн — микрогосударство."),
    "LUX": Anchor(290_000, "estimated", "Общепринятая оценка Люксембурга midcentury."),
    "MCO": Anchor(20_000, "estimated", "Монако — микрогосударство."),
    "SMR": Anchor(14_000, "estimated", "Сан-Марино — микрогосударство."),
    "VAT": Anchor(1_000, "estimated", "Ватикан — микрогосударство."),
    "BRN": Anchor(35_000, "estimated", "Бруней — общепринятая оценка."),
    "BTN": Anchor(700_000, "estimated", "Бутан — низкая точность источников."),
    "NPL": Anchor(6_700_000, "estimated", "Общепринятая оценка Непала midcentury."),
    "GRL": Anchor(21_000, "estimated", "Гренландия — низкая плотность, известная цифра."),
    "MNP": Anchor(10_000, "estimated", "Северные Марианские острова — низкая плотность."),
    "NRU": Anchor(3_000, "estimated", "Науру — микрогосударство."),
    "MHL": Anchor(10_000, "estimated", "Маршалловы острова — низкая плотность."),
    "TON": Anchor(45_000, "estimated", "Тонга — общепринятая оценка."),
    "VUT": Anchor(45_000, "estimated", "Новые Гебриды — общепринятая оценка."),
    "WSM": Anchor(70_000, "estimated", "Западное Самоа — общепринятая оценка."),
    "PLW": Anchor(6_000, "estimated", "Палау — низкая плотность."),
    "FSM": Anchor(30_000, "estimated", "Микронезия — низкая плотность."),
    "SLB": Anchor(90_000, "estimated", "Соломоновы острова — общепринятая оценка."),
    "PNG": Anchor(1_500_000, "estimated", "Папуа и Новая Гвинея — общепринятая оценка."),
    "NZL": Anchor(1_700_000, "estimated", "Общепринятая оценка Новой Зеландии midcentury."),
    "FIN": Anchor(3_900_000, "estimated", "Общепринятая оценка Финляндии midcentury."),

    # === Французские/испанские протектораты со своим ownerCountryId
    # (НЕ входят в QCF/QCS — у них отдельный код в реестре) ===
    "MAR": Anchor(8_600_000, "estimated", "Французское Марокко — общепринятая оценка midcentury (без испанской зоны)."),
    "TUN": Anchor(2_900_000, "estimated", "Французский Тунис — общепринятая оценка midcentury."),
    "CMR": Anchor(2_600_000, "estimated", "Французский Камерун (подопечная) — общепринятая оценка midcentury."),
    "LAO": Anchor(1_100_000, "estimated", "Французский Лаос — общепринятая оценка midcentury."),
    "KHM": Anchor(3_000_000, "estimated", "Французская Камбоджа — общепринятая оценка midcentury."),

    # === Германия / Корея / Китай — единая точка входа-заглушка,
    # фактические числа считаются из MULTI_FRAGMENT_TOTALS в country_splits.py.
    # Не задавать здесь напрямую — иначе fill-скрипт может использовать
    # устаревшую/задвоенную цифру по ошибке (та самая прошлая ошибка).
}
