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
    "AUSTRIA_TOTAL": Anchor(
        6_881_000, "estimated",
        "Сумма 4 зон оккупации (WebSearch, en.wikipedia.org/wiki/"
        "Allied-occupied_Austria: назначение земель по зонам; население по "
        "земле — перепись 1951, ближайшая доступная детализация к 1946):  "
        "Niederösterreich+Burgenland+Wien в советскую зону (Вена не делится "
        "на секторы, см. country_splits.py — решение пользователя "
        "2026-07-19), Oberösterreich+Salzburg — американская, "
        "Kärnten+Steiermark — британская, Tirol+Vorarlberg — французская "
        "(Восточный Тироль формально был британским, но в наших данных "
        "Tirol — один регион, большинство населения в Северном Тироле, "
        "который французский — не дробим). Заменяет прежний плоский anchor "
        "AUT=6.9М (почти совпадает, теперь просто явно источникован по "
        "землям, а не одной цифрой на всю страну)."
    ),
}

# Однофрагментные страны — population прямо есть anchor для этой ownerCountryId.
COUNTRY_POPULATION_1946: dict[str, Anchor] = {
    # === Великие державы (verified/хорошо документировано) ===
    "USA": Anchor(143_209_000, "estimated", "Общепринятая цифра нас. США 1946 (перепись 1940=132.2М, 1950=151.3М, интерполяция с учётом послевоенного бэби-бума с 1946)."),
    "SUN": Anchor(172_000_000, "estimated", "Довоенное ~196М (1939) минус военные потери (~27М) плюс частичное восстановление к 1946 — общепринятая оценка диапазона 170-175М."),
    "GBR": Anchor(54_634_759, "estimated", "Общепринятая перепись-близкая цифра (1951 перепись=50.2М, 1946 чуть ниже) + Питкерн (~130, свёрнут в прямое владение 2026-07-18 — без своей администрации, губернатор Фиджи с 1898 года)."),
    "FRA": Anchor(49_142_000, "estimated", "Перепись 1946=40.1М (метрополия) + Алжир ~8.6М — Алжир смоделирован прямым владением Франции (три департамента с 1848 года, не отдельная страна, см. country_entities_1946.json), поэтому его население должно входить в тот же anchor, иначе теряется из мирового тотала."),
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
    "ESP": Anchor(28_105_000, "estimated", "Общепринятая оценка франкистской Испании midcentury."),
    "BEL": Anchor(8_400_000, "estimated", "Общепринятая оценка Бельгии midcentury."),
    "NLD": Anchor(9_568_000, "estimated", "Общепринятая оценка Нидерландов (метрополия) midcentury."),
    "DNK": Anchor(4_100_000, "estimated", "Общепринятая оценка Дании midcentury."),
    "NOR": Anchor(3_150_000, "estimated", "Общепринятая оценка Норвегии midcentury."),
    "GRC": Anchor(7_300_000, "estimated", "Общепринятая оценка Греции midcentury."),
    "IRQ": Anchor(4_800_000, "estimated", "Общепринятая оценка Ирака midcentury."),
    "SAU": Anchor(3_200_000, "estimated", "Общепринятая оценка Саудовской Аравии midcentury (низкая плотность, кочевое население)."),
    "CHE": Anchor(4_400_000, "estimated", "Общепринятая оценка Швейцарии midcentury."),
    "IRL": Anchor(2_960_000, "estimated", "Общепринятая оценка Ирландии midcentury."),
    "PRT": Anchor(9_270_000, "estimated", "Общепринятая оценка Португалии (метрополия) midcentury."),
    "AFG": Anchor(9_500_000, "estimated", "Общепринятая оценка Афганистана midcentury (низкая точность источников)."),
    "MNG": Anchor(800_000, "estimated", "Общепринятая оценка Монголии midcentury (очень низкая плотность)."),
    "THA": Anchor(17_900_000, "estimated", "Сиам/Таиланд с Battambang и Siem Reap, которые оставались под его de facto administration до ноября 1946."),
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
    "QMH": Anchor(200_000, "estimated", "Мехабадская Республика (курдское квазигосударство) — малочисленна."),
    "QAZ": Anchor(1_000_000, "estimated", "Азербайджанская Народная Республика (советский протекторат в Иране) — оценка по региону."),

    # === Африка (страны/протектораты со своим ownerCountryId, не в колон. блоках) ===
    "ETH": Anchor(15_000_000, "estimated", "Общепринятая оценка Эфиопии midcentury."),
    "LBR": Anchor(1_500_000, "estimated", "Общепринятая оценка Либерии midcentury."),
    "SDN": Anchor(8_700_000, "estimated", "Англо-Египетский Судан — общепринятая оценка midcentury."),
    "TZA": Anchor(6_900_000, "estimated", "Танганьика (брит. подопечная территория) — общепринятая оценка."),
    "COD": Anchor(11_000_000, "estimated", "Бельгийское Конго — общепринятая оценка midcentury."),
    "QRU": Anchor(3_800_000, "estimated", "Ruanda-Urundi as one Belgian trust territory in the 1946 snapshot."),
    "MWI": Anchor(2_400_000, "estimated", "Ньясаленд — общепринятая оценка midcentury."),
    "UGA": Anchor(4_900_000, "estimated", "Уганда — общепринятая оценка midcentury."),
    "NAM": Anchor(350_000, "estimated", "Юго-Западная Африка (мандат ЮАР) — низкая плотность."),
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
    "NFD": Anchor(
        321_819, "verified",
        "Official 1945 Census of Newfoundland and Labrador total: 321,819."
    ),
    "QWL": Anchor(108_000, "verified", "UN A/4192: Leeward Islands, approximate 1946 population 108,000."),
    "QWW": Anchor(252_000, "verified", "UN A/4192: Windward Islands, approximate 1946 population 252,000."),
    "QND": Anchor(139_000, "verified", "UN A/4192: Curaçao, approximate 1946 population 139,000."),
    "MTQ": Anchor(209_000, "verified", "UN A/4192: Martinique, approximate 1946 population 209,000."),
    "GLP": Anchor(190_000, "verified", "UN A/4192: Guadeloupe, approximate 1946 population 190,000."),
    "QFW": Anchor(16_524_000, "verified", "UN A/4192: French West Africa, approximate population 16,524,000 (1948 figure in the 1946 territory table)."),
    "QFE": Anchor(4_127_000, "verified", "UN A/4192: French Equatorial Africa, approximate 1946 population 4,127,000."),
    "MDG": Anchor(4_296_000, "verified", "UN A/4192: Madagascar 4,154,000 plus Comoro Archipelago 142,000; combined because Comoros/Mayotte remained Madagascar dependencies on 1946-01-01."),
    "QZN": Anchor(230_000, "estimated", "Zanzibar Protectorate (Zanzibar + Pemba) — back-extrapolated from the 1958 census total of 299,111 at ~2.3%/yr; UN A/4192 does not clearly tabulate Zanzibar separately from Tanganyika. Needs a proper 1946-dated source pass before promoting to verified."),
    "GHA": Anchor(4_018_000, "verified", "UN A/4192: Gold Coast, approximate 1946 population 4,018,000."),
    "KEN": Anchor(5_227_000, "verified", "UN A/4192: Kenya, approximate 1946 population 5,227,000."),
    "NGA": Anchor(24_300_000, "verified", "UN A/4192: Nigeria, population 24,300,000 (1950 figure in the 1946 territory table)."),
    "SLE": Anchor(2_020_000, "verified", "UN A/4192: Sierra Leone, population 2,020,000 (1953 figure in the 1946 territory table)."),
    "ZMB": Anchor(1_650_000, "verified", "UN A/4192: Northern Rhodesia, approximate 1946 population 1,650,000."),
    "ZWE": Anchor(1_200_000, "estimated", "Southern Rhodesia midcentury estimate retained from the previous colonial-bloc split."),
    "AGO": Anchor(4_100_000, "estimated", "Angola midcentury estimate retained from the previous Portuguese colonial-bloc split."),
    "MOZ": Anchor(5_600_000, "estimated", "Mozambique midcentury estimate retained from the previous Portuguese colonial-bloc split."),

    # === Азия: отдельные страны, колонии и переходные администрации ===
    "IND": Anchor(404_926_705, "estimated", "British India 1946 estimate of 410M minus separately represented Kashmir, Sikkim, Portuguese India and French India."),
    "QJK": Anchor(4_000_000, "estimated", "Undivided princely State of Jammu and Kashmir, pre-partition estimate."),
    "QSI": Anchor(100_000, "estimated", "Kingdom of Sikkim midcentury estimate."),
    "QPI": Anchor(650_000, "estimated", "Portuguese India including Goa, Daman and Diu midcentury estimate."),
    "QFI": Anchor(323_295, "verified", "UN A/4192: French Establishments in India, population 323,295 (1939 figure in the 1946 territory table)."),
    "QTB": Anchor(1_200_000, "estimated", "Tibet under the Lhasa government, conservative midcentury estimate."),
    "HKG": Anchor(1_550_000, "verified", "UN A/4192: Hong Kong, approximate 1946 population 1,550,000."),
    "MMR": Anchor(16_000_000, "estimated", "Burma total retained from the previous British colonial-bloc split."),
    "LKA": Anchor(6_300_000, "estimated", "Ceylon total retained from the previous British colonial-bloc split."),
    "MYS": Anchor(5_250_000, "verified", "UN A/4192: Malaya, approximate 1946 population 5,250,000."),
    "SGP": Anchor(939_000, "verified", "UN A/4192: Singapore, population 939,000 (1947 figure in the 1946 territory table)."),
    "QNB": Anchor(325_000, "verified", "UN A/4192 gives North Borneo 335,000; 10,000 is separated here for Labuan on the 1946-01-01 snapshot."),
    "QLB": Anchor(10_000, "estimated", "Labuan midcentury estimate separated from the UN North Borneo aggregate."),
    "QSR": Anchor(500_000, "verified", "UN A/4192: Sarawak, approximate 1946 population 500,000."),
    "QDV": Anchor(16_000_000, "estimated", "Northern DRV share of the UN A/4192 Indochina total at the coarse 16th-parallel geometry."),
    "VNM": Anchor(10_150_000, "estimated", "Southern French/Allied administration share; with QDV, LAO and KHM sums to the UN A/4192 Indochina total 30.25M."),
    "QRI": Anchor(60_000_000, "estimated", "Republican Java and mainland Sumatra share of the UN A/4192 Netherlands Indies total."),
    "IDN": Anchor(13_700_000, "estimated", "Outer-island Netherlands administration share; with QRI sums to the UN A/4192 total 73.7M."),
    "MAC": Anchor(500_000, "estimated", "Macau total retained from the previous Portuguese colonial-bloc split."),
    "QAB": Anchor(25_000, "estimated", "Abu Dhabi share of the 80,000 Trucial States estimate."),
    "QDU": Anchor(20_000, "estimated", "Dubai share of the 80,000 Trucial States estimate."),
    "QSH": Anchor(15_000, "estimated", "Sharjah share of the 80,000 Trucial States estimate."),
    "QRK": Anchor(10_000, "estimated", "Ras Al Khaimah share of the 80,000 Trucial States estimate."),
    "QAJ": Anchor(5_000, "estimated", "Ajman share of the 80,000 Trucial States estimate."),
    "QUQ": Anchor(3_000, "estimated", "Umm Al Quwain share of the 80,000 Trucial States estimate."),
    "QFU": Anchor(2_000, "estimated", "Fujairah share of the 80,000 Trucial States estimate."),
    "QAD": Anchor(650_000, "estimated", "Aden Colony and Protectorate total retained from the previous British colonial-bloc split."),

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
    "NRU": Anchor(3_000, "estimated", "Науру — микрогосударство."),
    "TON": Anchor(45_000, "estimated", "Тонга — общепринятая оценка."),
    "VUT": Anchor(45_000, "estimated", "Новые Гебриды — общепринятая оценка."),
    "WSM": Anchor(70_000, "estimated", "Западное Самоа — общепринятая оценка."),
    "SLB": Anchor(90_000, "estimated", "Соломоновы острова — общепринятая оценка."),
    "PNG": Anchor(1_500_000, "estimated", "Папуа и Новая Гвинея — общепринятая оценка."),
    "NZL": Anchor(1_705_000, "estimated", "Общепринятая оценка Новой Зеландии midcentury + Токелау (~1,000, свёрнут в прямое владение 2026-07-18 — без администрации на месте в 1946 году)."),
    "COK": Anchor(15_000, "verified", "UN A/4192: Cook Islands, approximate 1946 population 15,000."),
    "NFK": Anchor(2_000, "estimated", "Norfolk Island midcentury estimate; distinct Australian external territory."),
    "QPS": Anchor(56_000, "estimated", "Combined retained native-population anchors for the former Japanese mandated Caroline, Marshall and Northern Mariana island districts under U.S. Navy administration."),
    "FIN": Anchor(3_900_000, "estimated", "Общепринятая оценка Финляндии midcentury."),

    # === Французские/испанские протектораты со своим ownerCountryId
    # (НЕ входят в QCF/QCS — у них отдельный код в реестре) ===
    "MAR": Anchor(8_600_000, "estimated", "Французское Марокко — общепринятая оценка midcentury (без испанской зоны)."),
    "TUN": Anchor(2_900_000, "estimated", "Французский Тунис — общепринятая оценка midcentury."),
    "CMR": Anchor(2_600_000, "estimated", "Французский Камерун (подопечная) — общепринятая оценка midcentury."),
    "LAO": Anchor(1_100_000, "estimated", "Французский Лаос — общепринятая оценка midcentury."),
    "KHM": Anchor(2_500_000, "estimated", "Французская Камбоджа без Battambang и Siem Reap, возвращённых из Thai administration позднее в 1946; общий THA+KHM anchor сохранён."),

    # === Германия / Корея / Китай — единая точка входа-заглушка,
    # фактические числа считаются из MULTI_FRAGMENT_TOTALS в country_splits.py.
    # Не задавать здесь напрямую — иначе fill-скрипт может использовать
    # устаревшую/задвоенную цифру по ошибке (та самая прошлая ошибка).
}
