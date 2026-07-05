"""
Разбивка многофрагментных исторических единиц на несколько ownerCountryId,
и группировка колониальных блоков (QCG/QCF/QCP/QCN/QCU/QCZ/QCS) на реальные
составляющие территории (не единая цифра на блок — история 2026-07-04
"Аудит" отметила это как второстепенную, но реальную неточность).

Каждая группа — { real_population: int, match: callable(name:str)->bool }.
Регионы блока, не попавшие ни в одну группу, получают долю ОСТАТКА
(bloc_total - sum(known groups)) пропорционально площади — этот остаток
документирован явно, не выдаётся за точное знание.
"""

from .anchors import MULTI_FRAGMENT_TOTALS, BRITISH_INDIA_1946


# ============================================================
# Китай: CHN (коммунисты, Северный Китай) / TWN (Гоминьдан,
# основная территория) / QMS (советская Маньчжурия)
# ============================================================
# Историческая пропорция на 1946: КПК контролировала МЕНЬШИНСТВО территории/
# населения (базовые районы Северного Китая после Long March, ~110М),
# Гоминьдан — основную часть материка (~350М), Маньчжурия под советской
# администрацией — отдельно (~30М). Сумма = 490М (CHINA_TOTAL).
# Прошлая ошибка (аудит 2026-07-04): каждому фрагменту присвоили ПОЛНЫЙ
# тотал Китая независимо — здесь исключено структурно: делим один тотал.
CHINA_SPLIT = {
    "CHN": 110_000_000,  # коммунистические базовые районы Сев. Китая
    "TWN": 350_000_000,  # Гоминьдан — основная территория материка
    "QMS": 30_000_000,   # советская администрация Маньчжурии
}
assert sum(CHINA_SPLIT.values()) == MULTI_FRAGMENT_TOTALS["CHINA_TOTAL"].population

# ============================================================
# Германия: 4 зоны оккупации (реальные цифры, WebSearch, конец 1946)
# ============================================================
GERMANY_SPLIT = {
    "QGS": 17_100_000,  # советская зона
    "QGA": 16_750_000,  # американская зона
    "QGF": 4_950_000,   # французская зона (с Саарской областью)
    "QGB": 26_000_000,  # британская зона — крупнейшая (включает Рур/Рейнланд)
}
assert sum(GERMANY_SPLIT.values()) == MULTI_FRAGMENT_TOTALS["GERMANY_TOTAL"].population

# ============================================================
# Корея: советская (север) / американская (юг) зоны
# ============================================================
# Юг исторически населённее (сельскохозяйственный, больше населения),
# север — меньше населения, но больше довоенной японской промышленности.
KOREA_SPLIT = {
    "QKS": 9_500_000,   # север
    "QKA": 16_000_000,  # юг
}
assert sum(KOREA_SPLIT.values()) == MULTI_FRAGMENT_TOTALS["KOREA_TOTAL"].population

# ============================================================
# Руанда-Урунди: задокументированный пробел реестра (docs/DECISIONS.md,
# 2026-06-28) — RWA и BDI делят одно имя. Не чиню владельца (вне мандата
# этой задачи), делю тотал по площади их регионов (RWA=5 рег., BDI=3 рег.).
# ============================================================
RUANDA_URUNDI_SPLIT_BY_AREA = True  # флаг для fill-скрипта: делить по area, не 50/50


# ============================================================
# Колониальные блоки — группировка по распознаваемым реальным территориям.
# match_any: список подстрок (case-insensitive) для names.en региона.
# Остаток блока (bloc_total - sum groups) распределяется по площади среди
# regions, не попавших в группу — документируется в fill-скрипте как
# "unmatched residual", не выдаётся за точное знание.
# ============================================================

QCG_GROUPS = {
    # British India (включает пост-1947 индийские И пакистанские названия —
    # артефакт геометрии, не моя правка; в 1946 это единая Британская Индия)
    "british_india": {
        "population": BRITISH_INDIA_1946.population,
        "match_any": [
            "kashmir", "chittagong", "rangpur", "rajshahi", "khulna", "dhaka",
            "ladakh", "arunachal", "sikkim", "bengal", "assam", "uttarakhand",
            "nagaland", "manipur", "mizoram", "tripura", "meghalaya", "punjab",
            "rajasthan", "gujarat", "himachal", "jammu", "bihar", "pradesh",
            "odisha", "dadra", "maharashtra", "goa", "karnataka", "kerala",
            "puducherry", "tamil nadu", "lakshadweep", "andaman", "jharkhand",
            "delhi", "chandigarh", "chhattisgarh", "haryana", "telangana",
            "northern areas", "k.p.", "f.a.t.a.", "baluchistan", "sind",
            "azad kashmir", "f.c.t.",
        ],
    },
    "burma": {"population": 16_000_000, "match_any": ["kachin", "bago", "magway", "shan", "sagaing", "kayin"]},
    "ceylon": {"population": 6_300_000, "match_any": ["ceylon"]},
    "malaya_borneo": {"population": 5_800_000, "match_any": ["sabah", "sarawak", "johor", "labuan", "perak", "pahang", "singapore"]},
    "hong_kong": {"population": 1_600_000, "match_any": ["hong kong"]},
    "cyprus": {"population": 450_000, "match_any": ["larnaca", "famagusta", "nicosia", "limassol", "paphos"]},
    "malta": {"population": 305_000, "match_any": ["malta", "gozo"]},
    "gibraltar": {"population": 24_000, "match_any": ["gibraltar"]},
    "aden_protectorate": {"population": 650_000, "match_any": ["hadramawt", "al mahrah", "shabwah", "lahij"]},
    "newfoundland": {"population": 320_000, "match_any": ["newfoundland"]},
    "caribbean": {
        "population": 2_900_000,
        "match_any": [
            "antigua", "anguilla", "barbados", "bermuda", "bahamas", "cayo",
            "orange walk", "corozal", "toledo", "stann creek", "belize",
            "dominica", "grenada", "jamaica", "nevis", "saint kitts", "cayman",
            "saint lucia", "montserrat", "turks and caicos", "tobago",
            "rio claro", "saint vincent", "virgin islands",
        ],
    },
    "falklands": {"population": 2_500, "match_any": ["south georgia", "falkland"]},
    "guyana": {"population": 375_000, "match_any": ["pomeroon", "demerara"]},
    "st_helena": {"population": 5_000, "match_any": ["saint helena", "indian ocean territory"]},
    "gambia": {"population": 260_000, "match_any": ["gambia"]},
    "nigeria_north": {"population": 7_500_000, "match_any": ["zamfara", "benue", "bauchi"]},
    "kenya": {"population": 2_000_000, "match_any": ["rift valley"], "match_ids": [1237, 1238, 1239, 1240]},
    "gold_coast": {"population": 2_000_000, "match_ids": [1245, 1246, 1247]},
    "n_rhodesia": {"population": 1_300_000, "match_ids": [1267, 1268, 1269, 1270]},
    "s_rhodesia": {"population": 1_200_000, "match_ids": [1271, 1272, 1273]},
    "seychelles": {"population": 25_000, "match_ids": [1289, 1290, 1291, 1292]},
    "mauritius": {"population": 150_000, "match_ids": [1306, 1307, 1308, 1309]},
    "pacific_micro": {"population": 35_000, "match_any": ["norfolk", "pitcairn", "tuvalu", "kiribati"]},
    "fiji": {"population": 260_000, "match_ids": [1365]},
}

QCF_GROUPS = {
    "vietnam": {
        "population": 21_500_000,
        "match_any": [
            "kon tum", "đắk", "gia lai", "bình phước", "tây ninh", "cửu long",
            "điện biên", "son la", "thanh hóa", "nghệ an", "ha tinh", "quảng",
            "thừa thiên", "hà nội", "bà rịa", "hồ chí minh", "khánh hòa",
            "hau giang", "đông nam bộ", "bình thuận", "ninh thuận", "phú yên",
            "bình định", "đà nẵng", "hòa bình", "đông bắc", "hải phòng",
            "thái nguyên", "bình dương", "lâm đồng", "can tho",
        ],
    },
    "laos_cambodia_leftover": {"population": 0, "match_any": []},  # LAO/KHM отдельные ownerCountryId, не в QCF
    "aof_west_africa": {
        "population": 15_000_000,
        "match_any": [
            "constantine", "oran", "alger", "cascades", "sahel", "boucle",
            "hauts-bassins", "plateau-central", "faranah", "kindia", "mamou",
            "nzérékoré", "kankan", "boke", "labé", "conakry", "n'zi-comoé",
            "worodougou", "savanes", "bas-sassandra", "gao", "kidal",
            "koulikoro", "timbuktu", "diffa", "zinder", "agadez", "matam",
            "louga", "tambacounda", "alibori", "borgou", "hodh",
        ],
    },
    "aef_equatorial_africa": {
        "population": 3_600_000,
        "match_any": ["ennedi", "kanem", "borkou", "guéra", "ombella", "haute-kotto", "pool", "cuvette", "ngounié", "ogooué"],
    },
    "madagascar": {"population": 4_200_000, "match_any": ["atsimo-andrefana", "anosy", "menabe", "sofia", "bongolava"]},
    "algeria_south": {"population": 400_000, "match_any": ["territoires du sud", "est", "sud-ouest", "nord", "centre"]},
    "djibouti": {"population": 60_000, "match_any": ["tadjourah"]},
    "comoros": {"population": 160_000, "match_any": ["comoros"]},
    "guyane": {"population": 30_000, "match_any": ["guyane"]},
    "pacific_france": {"population": 90_000, "match_any": ["new caledonia", "french polynesia", "wallis"]},
    "st_pierre": {"population": 4_500, "match_any": ["saint pierre"]},
}

QCP_GROUPS = {
    "angola": {"population": 4_100_000, "match_any": ["cabinda", "moxico", "huíla", "cuando cubango", "lunda norte"]},
    "mozambique": {"population": 5_600_000, "match_any": ["tete", "sofala", "gaza", "niassa", "zambezia"]},
    "portuguese_timor": {"population": 460_000, "match_any": ["portuguese timor"]},
    "guinea_bissau": {"population": 500_000, "match_any": ["bissau", "leste", "sul", "norte"]},
    "cape_verde": {"population": 150_000, "match_any": ["brava", "maio", "boa vista", "sal", "vicente", "filipe", "ribeira brava", "porto novo", "santa catarina"]},
    "sao_tome": {"population": 60_000, "match_any": ["são tomé", "príncipe"]},
    "macau": {"population": 500_000, "match_any": ["macau"]},
}

QCN_GROUPS = {
    "indonesia": {
        "population": 71_000_000,
        "match_any": [
            "kalimantan", "nusa tenggara", "papua", "maluku", "riau",
            "sumatera", "aceh", "bali", "bangka", "sulawesi", "jambi", "jawa",
        ],
    },
    "dutch_caribbean": {"population": 220_000, "match_any": ["aruba", "curaçao", "sint maarten"]},
    "suriname": {"population": 200_000, "match_any": ["para", "sipaliwini"]},
}

QCU_GROUPS = {
    "puerto_rico": {"population": 2_100_000, "match_any": ["puerto rico"]},
    "us_virgin_islands": {"population": 26_000, "match_any": ["virgin islands"]},
    "us_pacific": {"population": 60_000, "match_any": ["american samoa", "guam", "outlying"]},
}

QCZ_GROUPS = {
    "nz_pacific": {"population": 20_000, "match_any": ["cook islands", "niue", "tokelau"]},
}

QCS_GROUPS = {
    "western_sahara": {"population": 25_000, "match_any": ["western sahara"]},
    "equatorial_guinea": {"population": 180_000, "match_any": ["annobón", "bioko", "centro sur"]},
}

COLONIAL_BLOC_GROUPS = {
    "QCG": QCG_GROUPS,
    "QCF": QCF_GROUPS,
    "QCP": QCP_GROUPS,
    "QCN": QCN_GROUPS,
    "QCU": QCU_GROUPS,
    "QCZ": QCZ_GROUPS,
    "QCS": QCS_GROUPS,
}
