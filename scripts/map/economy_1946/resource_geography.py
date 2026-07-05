"""
Курируемая география ресурсов 1946 — реальные исторические месторождения/
районы добычи, привязанные к распознаваемым региональным именам. Только
ресурсы с eraIntroduced <= 1946 (18 из 20 в resourceCatalog.ts — без
rareEarths/lithium, eraIntroduced=1980).

food/timber — универсальная базовая добыча (см. fill-скрипт: пропорциональна
population×development), не входит в таблицу ниже — таблица только про
локализованные ресурсы, которых не может быть везде.
"""

# {country_id: {keyword_in_name_lowercase: {resource: amount}}}
# amount — условные единицы годовой добычи (не калибровано к $, gdp считается
# отдельно по формуле population×development×infrastructure — см. docs).
RESOURCE_HOTSPOTS: dict[str, dict[str, dict[str, int]]] = {
    # Баку — историческая нефтяная столица СССР на 1946
    "SUN": {
        "absheron": {"oil": 400, "gas": 100},
        "aran economic": {"oil": 150},
        "donets'k": {"coal": 500, "iron": 200},
        "luhans'k": {"coal": 400},
        "dnipropetrovs'k": {"iron": 400, "manganese": 150},
        "sverdlovsk": {"iron": 200, "copper": 100, "nickel": 80},
        "chelyabinsk": {"iron": 150, "coal": 150},
        "molotov oblast": {"oil": 100, "coal": 100},
        "kuybyshev": {"oil": 150},
        "chkalov oblast": {"oil": 80},
        "karaghandy": {"coal": 200},
        "kazakhstan": {"copper": 100},
        "kemerovo": {"coal": 250},
        "yakut": {"gold": 60},
        "kalmyk": {"oil": 40},
    },
    # Рур/Саар — угольно-стальное сердце Германии
    "QGB": {"nordrhein-westfalen": {"coal": 600, "iron": 300}},
    "QGF": {"saarland": {"coal": 300, "iron": 100}},
    "QGS": {"sachsen": {"iron": 100, "uranium": 30}},
    # Силезия — уголь Польши/Чехословакии
    "POL": {"none": {}},
    # Малайя/Ост-Индия — каучук/олово
    "QCG": {
        "perak": {"tin": 300, "rubber": 400},
        "pahang": {"rubber": 200, "tin": 100},
        "sabah": {"timber": 200},
        "sarawak": {"oil": 100, "rubber": 100},
    },
    "QCN": {
        "sumatera utara": {"rubber": 300, "oil": 150},
        "riau": {"oil": 400, "rubber": 100},
        "kalimantan timur": {"oil": 200},
        "bangka-belitung": {"tin": 250},
    },
    # Ближний Восток — нефть
    "IRQ": {"none": {"oil": 500}},
    "IRN": {"none": {"oil": 600}},
    "SAU": {"none": {"oil": 300}},
    "KWT": {"none": {"oil": 200}},
    "BHR": {"none": {"oil": 100}},
    "QAT": {"none": {"oil": 50}},
    # Чили — медь/нитраты
    "CHL": {"none": {"copper": 400, "nitrates": 300}},
    # Южная Африка — золото
    "ZAF": {"none": {"gold": 500, "coal": 200}},
    # Родезия/Конго — хром/уран/медь
    "COD": {"none": {"copper": 250, "uranium": 50}},
    # Египет/США Юг/Индия — хлопок
    "EGY": {"none": {"cotton": 400}},
    "USA": {
        "texas": {"oil": 400, "cotton": 200},
        "oklahoma": {"oil": 250},
        "louisiana": {"oil": 200},
        "west virginia": {"coal": 300},
        "kentucky": {"coal": 250},
        "pennsylvania": {"coal": 300, "iron": 150},
        "mississippi": {"cotton": 250},
        "alabama": {"cotton": 200, "iron": 100},
        "minnesota": {"iron": 200},
    },
    "CAN": {"alberta": {"oil": 200}, "ontario": {"nickel": 150, "iron": 100}},
    # Венесуэла/Мексика — нефть Латинской Америки
    "VEN": {"none": {"oil": 500}},
    "MEX": {"tamaulipas": {"oil": 150}},
    # Марокко/Тунис — фосфаты (нет в каталоге, пропускаем) — оставляем food-базу
}
