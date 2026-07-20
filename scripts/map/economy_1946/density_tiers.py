"""
Классификаторы "тира плотности" (1=почти пусто .. 6=плотный город) по
реальным географическим фактам — не единая константа на страну (та самая
прошлая ошибка). Вес региона = area_km2**AREA_EXPONENT * TIER_MULTIPLIER[tier],
затем нормализуется на страновой тотал населения. Степень <1 у площади
структурно не даёт огромным малолюдным территориям (Якутия, Сахара, тундра)
получить абсурдную долю просто за размер — в отличие от прошлой ошибки
(линейная density×area, см. docs/DECISIONS.md 2026-07-04 "Аудит").

Явные классификаторы — только для стран первого эшелона (TIER_A1), где я
действительно располагаю релевантным географическим знанием (какие области/
штаты/провинции исторически гуще/реже населены). Для всех остальных стран —
generic-классификатор: наименьшие по площади регионы страны (типично
столица/город-регион) получают городской бонус, остальные — базовый тир,
что уже структурно отличается от "все регионы страны на одном множителе".
"""

AREA_EXPONENT = 0.55

TIER_MULTIPLIER = {1: 0.12, 2: 0.35, 3: 1.0, 4: 2.2, 5: 5.0, 6: 12.0}


def _contains_any(name: str, keywords: list[str]) -> bool:
    n = name.lower()
    return any(k in n for k in keywords)


# ---- SUN (Soviet Union, 174 регионов) ----
_SUN_TIER6 = ["moscow", "leningrad"]  # города Москва/Ленинград (id 318/319) + City of Minsk
_SUN_TIER5 = [
    "city of minsk", "donets'k", "luhans'k", "kharkiv", "dnipropetrovs'k",
    "kiev city", "kiev", "odessa", "zaporizhzhya", "moscow oblast", "leningrad oblast",
]
_SUN_TIER4 = [  # плотная европейская часть: Украина, Белоруссия, Прибалтика, Кавказ, чернозёмная Россия
    "gomel", "brest", "vitebsk", "grodno", "mogilev", "minsk",
    "chernihiv", "volyn", "rivne", "zhytomyr", "transcarpathia", "chernivtsi",
    "ivano-frankivs'k", "vinnytsya", "l'viv", "sumy", "kherson", "mykolayiv",
    "poltava", "khmel'nyts'kyy", "ternopil'", "cherkasy", "kirovohrad", "crimea",
    "sevastopol", "riga", "tartu", "vidzeme", "latgale", "zemgale", "kurzeme",
    "panevezio", "alytaus", "šiauliai", "saare", "hiiu", "moldavian",
    "kursk", "voronezh", "belgorod", "tula", "ryazan", "oryol", "lipetsk",
    "tambov", "bryansk", "kaluga", "vladimir", "ivanovo", "yaroslavl",
    "gorky", "kuybyshev", "saratov", "rostov", "krasnodar", "stavropol",
    "kvemo kartli", "samegrelo", "mtskheta", "lori", "aragatsotn", "gegharkunik",
    "ganja", "aran economic", "absheron", "guba-khachmaz",
]
_SUN_TIER2 = [  # Сибирь/Дальний Восток/Арктика/тундра — реально почти пусто
    "yakut", "chukotka", "kamchatka", "magadan", "sakhalin", "nenets",
    "yamalo-nenets", "khanty-mansi", "komi", "krasnoyarsk", "khabarovsk",
    "amur", "chita", "irkutsk", "buryat", "tuva", "gorno-altai", "murmansk",
    "arkhangelsk", "tomsk", "kamchatka",
]
_SUN_TIER1 = ["yakut assr"]  # особо экстремальный случай (3.07М км2, тундра)


def sun_tier(name: str) -> int:
    if _contains_any(name, ["yakut assr"]):
        return 1
    if _contains_any(name, _SUN_TIER6):
        return 6
    if _contains_any(name, _SUN_TIER5):
        return 5
    if _contains_any(name, _SUN_TIER4):
        return 4
    if _contains_any(name, _SUN_TIER2):
        return 2
    return 3  # Урал, Ц. Азия, Казахстан, зауральская Россия — умеренно


# ---- USA (114 регионов) ----
_USA_TIER6 = ["district of columbia"]
_USA_TIER5 = [  # плотный Северо-Восток / промышленный пояс
    "new york — richmond", "rhode island", "connecticut", "new jersey",
    "massachusetts", "delaware", "maryland", "hawaii — honolulu",
]
_USA_TIER4 = [  # населённый Средний Запад/Юг/Северо-Восток
    "pennsylvania", "ohio", "michigan", "new york", "vermont", "new hampshire",
    "maine", "louisiana", "mississippi", "alabama", "florida", "georgia",
    "south carolina", "north carolina", "virginia", "illinois", "indiana",
    "kentucky", "tennessee", "west virginia", "wisconsin", "iowa", "missouri",
    "arkansas", "minnesota", "guantanamo",
]
_USA_TIER2 = [  # горный Запад / пустыни / Аляска — реально малолюдно
    "montana", "wyoming", "nevada", "idaho", "utah", "new mexico",
    "north dakota", "south dakota", "alaska", "oregon — harney",
]
def usa_tier(name: str) -> int:
    if _contains_any(name, _USA_TIER6):
        return 6
    if _contains_any(name, _USA_TIER5):
        return 5
    if _contains_any(name, _USA_TIER4):
        return 4
    if _contains_any(name, _USA_TIER2):
        return 2
    return 3  # California/Texas/Arizona/Colorado/Washington/Nebraska/Kansas/Oklahoma — умеренно (агро+города)


# ---- GBR (24 региона) ----
def gbr_tier(name: str) -> int:
    n = name.lower()
    if "greater london" in n:
        return 6
    if _contains_any(n, ["north west", "west midlands", "yorkshire", "south east", "north eastern", "east"]):
        return 4
    if _contains_any(n, ["tripolitania", "cyrenaica", "bari", "mudug", "hiiraan", "bay", "gash barka", "debub", "highlands and islands"]):
        return 1  # Ливия/Сомали/Эритрея под брит. администрацией — пустыня, малолюдно
    return 3


# ---- FRA (19 регионов) ----
def fra_tier(name: str) -> int:
    n = name.lower()
    if "île-de-france" in n:
        return 6
    if _contains_any(n, ["hauts-de-france", "auvergne-rhône-alpes", "nouvelle-aquitaine", "occitanie", "grand est"]):
        return 4
    if _contains_any(n, ["fezzan", "clipperton"]):
        return 1
    if _contains_any(n, ["martinique", "guadeloupe", "réunion", "mayotte"]):
        return 5  # плотные острова
    return 3


# ---- ITA (20 регионов) ----
def ita_tier(name: str) -> int:
    n = name.lower()
    if _contains_any(n, ["lombardia", "lazio", "campania", "veneto"]):
        return 5
    if _contains_any(n, ["piemonte", "emilia-romagna", "sicily", "apulia", "toscana"]):
        return 4
    if _contains_any(n, ["valle d'aosta", "molise", "basilicata"]):
        return 2
    return 3


# ---- JPN (11 регионов) ----
def jpn_tier(name: str) -> int:
    n = name.lower()
    if "kanto" in n:
        return 6  # Токио
    if _contains_any(n, ["kinki", "chubu", "kyushu"]):
        return 5  # Осака/Нагоя/Фукуока
    if _contains_any(n, ["saga", "nagasaki", "okinawa"]):
        return 2  # малые площади, но НЕ городская плотность модерн-Нагасаки — эффект 1946 сильно ниже
    if "hokkaido" in n:
        return 2
    return 3


# ---- BRA (28 регионов) ----
def bra_tier(name: str) -> int:
    n = name.lower()
    if "distrito federal" in n:
        return 5
    if _contains_any(n, ["são paulo", "rio de janeiro", "minas gerais", "pernambuco", "rio grande do sul", "bahia", "ceará", "paraíba", "alagoas", "sergipe"]):
        return 4
    if _contains_any(n, ["amazonas", "pará", "mato grosso", "goiás", "acre", "amapá", "rio branco", "guaporé"]):
        return 1  # Амазония/фронтир — почти пусто в 1946
    return 3


# ---- CAN (11 регионов) ----
def can_tier(name: str) -> int:
    n = name.lower()
    if _contains_any(n, ["ontario", "québec", "nova scotia", "prince edward"]):
        return 4
    if _contains_any(n, ["northwest territories", "yukon"]):
        return 1
    return 3


# ---- Германия (зоны — реальные земли, известная относительная плотность) ----
def germany_tier(name: str) -> int:
    n = name.lower()
    if "berlin" in n:
        return 6
    if _contains_any(n, ["nordrhein-westfalen", "sachsen", "hamburg"]):
        return 5  # Рур/Саксония — плотная индустрия
    if _contains_any(n, ["saarland"]):
        return 4
    return 3


# ---- Корея (зоны) ----
def korea_tier(name: str) -> int:
    n = name.lower()
    if _contains_any(n, ["seoul", "p'yŏngyang", "busan", "daegu", "incheon"]):
        return 6
    if _contains_any(n, ["gyeonggi", "south gyeongsang", "p'yŏngan-namdo"]):
        return 4
    if _contains_any(n, ["ryanggang", "chagang"]):
        return 1  # горный север — малолюдно
    return 3


# ---- Китай (три фрагмента — известная относительная плотность провинций) ----
def china_fragment_tier(name: str) -> int:
    n = name.lower()
    if _contains_any(n, ["shanghai", "beijing", "tianjin", "nanjing", "guangzhou", "dalian", "harbin", "qingdao"]):
        return 6  # крупные города — но БЕЗ современного населения, тир даёт лишь относительный бонус
    if _contains_any(n, ["jiangsu", "shandong", "hebei", "henan", "hunan", "sichuan", "anhui", "hubei", "guangdong", "zhejiang"]):
        return 4  # плотные равнинные аграрные провинции
    if _contains_any(n, ["xinjiang", "qinghai", "xizang", "xikang", "gansu", "ningxia", "suiyuan"]):
        return 1  # пустыни/высокогорье Запада — реально почти пусто
    return 3


def dnk_tier(name: str) -> int:
    """Дания: `generic_tier` трактует самый маленький по площади регион
    страны как "вероятно столица/город" (тир 5, x5.0) — верно для
    материковых регионов (Hovedstaden реально плотнее прочих), но НЕ для
    Фарерских островов (2026-07-19-o: добавлены как отдельный регион,
    оказались меньше материковых по площади и получили тир 5 наравне со
    столицей — 1.2M населения при реальных ~25-30 тыс. на 1946 год).
    Явный по-имени классификатор (как остальные EXPLICIT_TIER_CLASSIFIERS -
    сигнатура classifier(name), area/country_areas сюда не передаются):
    Фарерские острова — редконаселённая периферия (тир 1), Hovedstaden
    (столичный регион) — городской бонус (тир 5), остальные материковые
    регионы — базовый тир 3."""
    if _contains_any(name, ["faroe"]):
        return 1
    if _contains_any(name, ["hovedstaden"]):
        return 5
    return 3


EXPLICIT_TIER_CLASSIFIERS = {
    "DNK": dnk_tier,
    "SUN": sun_tier,
    "USA": usa_tier,
    "GBR": gbr_tier,
    "FRA": fra_tier,
    "ITA": ita_tier,
    "JPN": jpn_tier,
    "BRA": bra_tier,
    "CAN": can_tier,
    "QGS": germany_tier,
    "QGA": germany_tier,
    "QGB": germany_tier,
    "QGF": germany_tier,
    "QKS": korea_tier,
    "QKA": korea_tier,
    "CHN": china_fragment_tier,
    "TWN": china_fragment_tier,
    "QMS": china_fragment_tier,
}


def generic_tier(name: str, area: float, country_areas: list[float]) -> int:
    """
    Фоллбэк для стран без явного классификатора (TIER_A2 + TIER_B):
    наименьшие по площади регионы страны (типично столица/город-округ)
    получают городской бонус, крупнейшие (обычно периферия/пустыня/фронтир)
    получают понижение — структурно отличается от "все регионы на одном
    множителе" даже без индивидуального исследования каждого региона.
    """
    if len(country_areas) < 2:
        return 3
    sorted_areas = sorted(country_areas)
    n = len(sorted_areas)
    small_cut = sorted_areas[max(0, n // 5)]       # нижние ~20% по площади
    large_cut = sorted_areas[min(n - 1, n - n // 5)]  # верхние ~20% по площади
    if area <= small_cut and area < sorted_areas[-1] * 0.15:
        return 5  # компактный регион относительно остальных — вероятно, столица/город
    if area >= large_cut and n >= 5:
        return 2  # крупнейшие регионы страны с >=5 регионами — обычно периферия
    return 3
