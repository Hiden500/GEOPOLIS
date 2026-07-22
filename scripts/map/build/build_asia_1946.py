"""
build_asia_1946.py
Этап 2-3 (Азия): маппинг + объединение ADM1-регионов game_map.json
в исторически осмысленные макро-регионы для сценария 1946 года.

Те же принципы, что и в build_europe_1946.py:
  - single     : вся страна -> 1 регион (микрогосударства + "потеряшки" с
                 отдельным iso_a2, не входившие в официальный список стран)
  - keep       : оставить как есть (уже компактно)
  - region     : группировка по properties.region (реальные области)
  - geometric  : геометрическое объединение по смежности до целевого числа
  - zoned      : то же самое, но раздельно внутри зон properties.region,
                 чтобы не сливать физически разные части страны
                 (напр. Маньчжурию с югом Китая)
"""
from paths import game_map, out, source
import json
import time
import math
from shapely.geometry import shape, mapping, box as shp_box
from shapely.ops import unary_union
from pyproj import Geod
from geometry_cleanup import absorb_slivers_until_stable, load_water_geoms

GEOD = Geod(ellps="WGS84")
SRC = game_map()
OUT = out("asia_1946.geojson")

# --------------------------------------------------------------------------
# Конфигурация по странам (iso_a2 -> метод)
# --------------------------------------------------------------------------

KEEP_AS_IS = {
    "TM": "Туркменская ССР — уже 5 областей",
    "PK": "Пакистан — уже компактно (8)",
    "IN": "Индия — план: 'сохранить текущую детализацию' (35-40, было 36)",
    "VN": "Вьетнам — оригинальные провинции, не группируем",
    "KR": "Южная Корея — оригинал (17), Сеул/Инчхон/Пусан/Тэгу и др. критичны для симуляции",
    "KP": "Северная Корея — оригинал (11), Пхеньян/Расон отдельно критичны для симуляции",
    # SY/JO/LB (2026-07-19-i): откат с geometric/custom_zoned-группировки на
    # сырые провинции game_map.json — пользователь потребовал перестать
    # курировать число/состав регионов без явного запроса ("Я потом скажу
    # какие провинции разбить"), см. docs/DECISIONS.md. Современные
    # анахронизмы источника (UNDOF в SY, An Nabatiyah в LB) оставлены
    # буквально, не сворачиваются — по прямому решению пользователя.
    "SY": "Сирия — сырые провинции game_map.json (было: geometric-слияние в 10)",
    "JO": "Иордания — сырые провинции game_map.json (было: geometric-слияние в 6)",
    "LB": "Ливан — сырые провинции game_map.json (было: курированные 5 мухафаз 1946)",
}

# Китай — НЕ из game_map.json (современные 32 провинции — потолок без
# реальной Маньчжурии 1946 года), а из отдельно обработанного shapefile
# Virtual Shanghai (1947-49, реорганизация Маньчжурии 1945-46 не менялась
# до 1949) — см. build_china_historical_1946.py. 40 регионов: 24 обычных
# провинции + Тибет + Синьцзян + 9 маньчжурских + Бэйпин/Тяньцзинь/Шанхай/
# Чунцин (вырезаны по современным контурам, других границ 1946 года нет) +
# Парасельские острова.
CHINA_HISTORICAL_FILE = out("china_1946_historical.json")

# Подмандатная Палестина (IL+PS в исходнике) — 2026-07-19-i: откат с
# исторической 16-подрайонной реконструкции (build_palestine_1946.py, файл
# и скрипт остаются на диске как справочный материал для будущего
# разбиения — см. докстринг скрипта) на сырые 6 округов Израиля + 2 пятна
# Палестины прямо из game_map.json, без объединения/группировки. Выходной
# iso_a2 остаётся единым "PS" для всех (одна территория Подмандатной
# Палестины в 1946 году — не решение о делении, конвенция не изменилась).
# Голан (см. GOLAN_SRC ниже) по-прежнему вырезается из HaZafon и уходит в
# Сирию — вопрос суверенитета 1946 года, не "провинция для разбиения".
GOLAN_SRC = source("palestine_hist/geoBoundaries-ISR-ADM2.geojson")
PALESTINE_RAW_ISO = {"IL", "PS"}

# Западный берег (2026-07-19-j) — раньше единое пятно raw "West Bank" из
# game_map.json, теперь заменяется 10 губернаторствами geoBoundaries PSE
# ADM2 (тот же источник/коммит, что уже используется для Голана и в
# superseded build_palestine_1946.py) — нужны для интифад/Осло-механик,
# которые одним блоком смоделировать нельзя. "Jerusalem" губернаторство PSE
# намеренно НЕ включено — совпало бы по имени с уже существующим raw
# регионом "Jerusalem" (ISR-источник), не дублируем. Губернаторства сектора
# Газа (Gaza/North Gaza/Deir Al Balah/Khan Yunis/Rafah) тоже не входят —
# это не Западный берег.
PSE_SRC = source("palestine_hist/geoBoundaries-PSE-ADM2.geojson")
WEST_BANK_GOVERNORATES = [
    "Jenin", "Tubas", "Tulkarm", "Nablus", "Qalqiliya", "Salfit",
    "Ramallah & Al Bireh", "Jericho & Al Aghwar", "Bethlehem", "Hebron",
]

# Микрогосударства + "потеряшки" с отдельным iso_a2, не входившие в список
# стран Азии (аналог Косово/Аландов/Гибралтара в Европе)
SINGLE_REGION = {
    "BH": "Бахрейн",
    "BN": "Бруней",
    "QA": "Катар",
    "SG": "Сингапур",
    "TL": "Восточный Тимор (Португальский Тимор)",
    "BT": "Бутан (план: 'каждый в отдельный регион')",
    "NP": "Непал (план: 'каждый в отдельный регион')",
    "LK": "Цейлон (план: 'каждый в отдельный регион')",
    "HK": "Гонконг (отдельный iso_a2='HK', не входил в список стран)",
    "MO": "Макао (отдельный iso_a2='MO', не входил в список стран)",
    # Мальдивы (2026-07-22, diagnose_missing_land.py: 21 фича полностью
    # отсутствовала на карте) — "архипелаг" по игровому определению
    # пользователя: разбросанные острова с политической значимостью ~0
    # сливаются в ОДИН регион, не курируются по атоллам отдельно. Владелец —
    # по сюзерену 1946 (британский протекторат, не независимое MDV).
    "MV": "Мальдивы",
}

REGION_FIELD = {
    "AZ": {},  # 10 экономических районов Азербайджана (включая Нахичевань)
    "JP": {},  # 9 традиционных областей Японии (план: 10-15 ✓)
    "PH": {},  # 17 официальных регионов Филиппин
}

ZONED_GEOMETRIC = {
    "IQ": {
        # Ближний Восток — максимальная детализация для будущей войны.
        # Киркук (At-Ta'mim, 2026-07-19-j) вынесен в свою зону-синглтон
        # ("Kirkuk": 1) прямо в main() ДО geometric_merge_by_zone — главная
        # спорная территория курдского вопроса (ст. 140 конституции Ирака,
        # референдум 2017), иначе тонет в одном из 7 обычных кластеров.
        # "Iraq" снижен с 7 до 6, т.к. At-Ta'mim больше не в этой корзине.
        "field": "region",
        "targets": {"Iraq": 6, "Kurdistan": 3, "Kirkuk": 1},
    },
}

# Зонирование по ИМЕНИ провинции (не по полю region, которого тут нет) —
# чтобы геометрическое слияние не пересекало границы зон.
CUSTOM_ZONED = {
    "TR": {
        # п.4: европейская часть (Фракия+Стамбул) слилась с азиатской —
        # разделяю явно по проливам, слияние через Босфор запрещено
        "zone_of": {
            "Edirne": "Europe", "Kirklareli": "Europe",
            "Tekirdag": "Europe", "Istanbul": "Europe",
        },
        "default_zone": "Asia",
        "targets": {"Europe": 2, "Asia": 7},
    },
    "IR": {
        # п.5: Азербайджанская Народная Правительство и Мехабадская
        # Республика — два просоветских квазигосударства, существовавших
        # ровно в 1946 году (разгромлены Тегераном в декабре 1946) —
        # критичные для самого стартового сценария, не сливаю с остальным
        # Ираном
        "zone_of": {
            "East Azarbaijan": "AzGov", "West Azarbaijan": "AzGov",
            "Ardebil": "AzGov", "Kordestan": "Mahabad",
        },
        "default_zone": "Rest",
        "targets": {"AzGov": 3, "Mahabad": 1, "Rest": 6},
    },
    # LB (курированные 5 мухафаз 1946) отменено 2026-07-19-i — откат на
    # сырые провинции через KEEP_AS_IS, см. запись в docs/DECISIONS.md.
}

GEOMETRIC = {
    "AF": 8, "AM": 3, "GE": 3, "KG": 4, "TJ": 4,
    "MM": 6, "KH": 5, "LA": 4, "MN": 8, "KZ": 10, "UZ": 6, "MY": 6,
    "ID": 20, "SA": 8, "OM": 4,
    # AE (ОАЭ/Договорной Оман) — консолидировано обратно в 1 полигон/страну
    # (2026-07-19, разворот решения 2026-06-28 о разделе на 7 отдельных
    # шейхств-стран — см. docs/DECISIONS.md). Все 7 шейхств были одной и
    # той же формой правления под одним и тем же британским протекторатом,
    # без геймплейно различимого поведения — "бессмысленное деление" по
    # принципу docs/HISTORICAL_ACCURACY.md.
    "AE": 1,
    "YE": 6, "BD": 5, "TW": 4, "TH": 11, "KW": 2,
}

ALL_COUNTRIES = (set(KEEP_AS_IS) | set(REGION_FIELD) | set(GEOMETRIC)
                  | set(SINGLE_REGION) | set(ZONED_GEOMETRIC) | set(CUSTOM_ZONED))

# --------------------------------------------------------------------------
# Переименования для контекста 1946 года (без изменения геометрии)
# --------------------------------------------------------------------------
NAME_OVERRIDES_1946 = {
    "CHN-1155": "Бэйпин",  # Пекин в 1946 называлcя Бэйпин, столица была в Нанкине
    "IRQ-3049": "Kirkuk",  # губернаторство переименовано в At-Ta'mim только в 1976
                            # (Баасистский режим); на 1946 год — Kirkuk, тот же
                            # источник даёт name_en="Kirkuk" при name="At-Ta'mim"
}

# --------------------------------------------------------------------------
# Отдельные фичи по конкретному adm1_code, минуя страновой фильтр —
# для анклавов с iso_a2='-1' (не страна) и спорных территорий, у которых
# реально ЕСТЬ собственный полигон в датасете (в отличие от тега
# strategic_points, который ставится когда полигона нет).
# --------------------------------------------------------------------------
EXTRA_SINGLE_FEATURES = [
    # (adm1_code, итоговое название, iso_a2 для вывода)
    ("KAB+00?", "Туратам", "KZ"),     # п.1: историческое название Байконура в 1946
    ("KAS+00?", "Кашмир", "KAS"),      # спорная территория Индия/Пакистан с 1947
    ("PGA+00?", "Спратли", "PGA"),     # спорные острова Южно-Китайского моря
]



# --------------------------------------------------------------------------
# Стратегические точки — места, не имеющие собственных ADM1-границ (часто
# потому что в 1946 году ещё не существуют как поселения), но важные для
# игровой механики на горизонте 1836-2100. Вместо вырезания произвольного
# полигона (для которого нет источника границ) точка просто помечается
# тегом на том регионе, в чей контур она физически попадает после
# объединения. Список расширяемый — координаты lon,lat.
# --------------------------------------------------------------------------
from shapely.geometry import Point

STRATEGIC_POINTS = [
    ("Нанкин", 118.78, 32.06, "столица Китайской Республики в 1946 г. "
     "(сам город не выделен отдельным ADM1 в современных данных)"),
]


def fill_china_gaps(features, gap_threshold=0.6):
    """v2: глобальный расчёт зазора между объединённым Китаем и объединёнными
    соседями, затем каждый СВЯЗНЫЙ кусок зазора отдаётся ровно одной (ближайшей)
    китайской провинции. В отличие от первой версии (попарно по каждому соседу
    отдельно), это не может создать пересечение между самими провинциями
    Китая — каждый кусок присваивается только одному получателю."""
    NEIGHBOR_ISO = {"MN", "TJ", "KZ", "IN", "BT", "NP", "PK", "MM", "VN", "KP", "LA", "KG", "TW", "AF", "KAS"}
    china_feats = [ft for ft in features if ft["properties"]["iso_a2"] == "CN"]
    neighbor_feats = [ft for ft in features if ft["properties"]["iso_a2"] in NEIGHBOR_ISO]
    if not china_feats or not neighbor_feats:
        return

    china_geoms = {id(ft): shape(ft["geometry"]) for ft in china_feats}
    china_union = unary_union(list(china_geoms.values()))
    neighbor_union = unary_union([shape(ft["geometry"]) for ft in neighbor_feats])

    buffered_china = china_union.buffer(gap_threshold)
    buffered_neighbors = neighbor_union.buffer(gap_threshold)
    gap_zone = buffered_china.intersection(buffered_neighbors)
    gap_zone = gap_zone.difference(china_union).difference(neighbor_union)

    if gap_zone.is_empty:
        print("  [GAP-FILL] зазоров не найдено")
        return

    components = list(gap_zone.geoms) if gap_zone.geom_type.startswith("Multi") else [gap_zone]
    components = [c for c in components if c.area > 1e-10]
    print(f"  [GAP-FILL] найдено {len(components)} связных компонент зазора")

    assigned = {}
    for comp in components:
        best_ft, best_dist = None, None
        for ft in china_feats:
            d = china_geoms[id(ft)].distance(comp)
            if best_dist is None or d < best_dist:
                best_ft, best_dist = ft, d
        assigned.setdefault(id(best_ft), []).append(comp)

    for ft in china_feats:
        pieces = assigned.get(id(ft))
        if not pieces:
            continue
        new_g = unary_union([china_geoms[id(ft)]] + pieces)
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        ft["geometry"] = mapping(new_g)
        ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
        print(f"    -> {ft['properties']['name']}: +{len(pieces)} куск(ов)")


def clip_china_to_neighbors(features):
    """Историческая граница Китая 1946 (claims-based shapefile) залезает на
    современные Монголию/Таджикистан/Казахстан/Индию/Бутан/Пакистан/Мьянму/
    Вьетнам/КНДР/Лаос/Киргизию/Тайвань. Современные границы соседей остаются
    приоритетными — обрезаем Китай по их уже построенным полигонам."""
    NEIGHBOR_ISO = {"MN", "TJ", "KZ", "IN", "BT", "NP", "PK", "MM", "VN", "KP", "LA", "KG", "TW", "HK", "MO", "AF", "KAS"}
    neighbor_geoms = [shape(ft["geometry"]) for ft in features
                       if ft["properties"]["iso_a2"] in NEIGHBOR_ISO]
    neighbors_union = unary_union(neighbor_geoms)

    for ft in features:
        if ft["properties"]["iso_a2"] != "CN":
            continue
        g = shape(ft["geometry"])
        if g.intersects(neighbors_union):
            clipped = g.difference(neighbors_union)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)


VIETNAM_EXPLICIT_MERGES = [
    # Ханой-делта (без самого Ханоя) - вокруг Хайфона
    (["VNM-461", "VNM-466", "VNM-468", "VNM-471", "VNM-4600",
      "VNM-463", "VNM-460", "VNM-467"], "Hải Phòng"),
    # Большой Ханой (включает сам VNM-462 Ha Noi). Vĩnh Phúc (464) сюда, а
    # не в Hải Phòng - физически граничит с Tuyên Quang/Phú Thọ/Ha Noi,
    # а с группой Hải Phòng не граничит вообще (Ханой стоит между ними -
    # в группе Hải Phòng без этого переноса получалась разрывная геометрия)
    (["VNM-512", "VNM-511", "VNM-5483", "VNM-453", "VNM-454", "VNM-429",
      "VNM-457", "VNM-458", "VNM-469", "VNM-462", "VNM-470", "VNM-464"], "Hà Nội"),
    # Дельта Меконга (без Хошимина/Кантхо/Хаузянга - те остаются отдельно)
    (["VNM-503", "VNM-500", "VNM-498", "VNM-502", "VNM-508", "VNM-4834",
      "VNM-507", "VNM-506", "VNM-510", "VNM-509", "VNM-504"], "Đồng Bằng Sông Cửu Long"),
]


def clip_palestine_to_neighbors(features):
    """Границы Подмандатной Палестины (build_palestine_1946.py) построены из
    geoBoundaries ADM2 — другого источника, чем game_map.json/Natural Earth,
    из которого строятся Иордания/Сирия/Ливан. Проверка через
    merge_world_1946.py нашла реальные пересечения на стыке (Беэр-Шева/
    Акаба ~0.024 deg2, Беэр-Шева/Карак, Иерусалим/Амман и т.д.) — граница
    современной Иордании (Natural Earth) остаётся приоритетной, обрезаем
    Палестину по уже построенным полигонам соседей (тот же принцип, что и
    clip_china_to_neighbors для Китая 1946 v1)."""
    NEIGHBOR_ISO = {"JO", "SY", "LB"}
    neighbor_geoms = [shape(ft["geometry"]) for ft in features
                       if ft["properties"]["iso_a2"] in NEIGHBOR_ISO]
    if not neighbor_geoms:
        return
    neighbors_union = unary_union(neighbor_geoms)

    for ft in features:
        if ft["properties"]["iso_a2"] != "PS":
            continue
        g = shape(ft["geometry"])
        if g.intersects(neighbors_union):
            clipped = g.difference(neighbors_union)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)


def absorb_middle_east_slivers(features):
    """Gap-first устранение "зиппер"-разрывов между Палестиной/Иорданией/
    Сирией/Ливаном, их швов с авторитетными соседями (Ирак/Турция/Саудия —
    context, не двигаются) и с водой. Заменяет buffer-based дозаполнение
    с пост-клипами (см. docs/DECISIONS.md "2026-07-19-d" -> "-e"): вместо
    наращивания полигонов буфером навстречу друг другу находим САМУ пустоту
    (polygonize всех границ) и раздаём её по самой длинной общей границе.
    Метод, защиты (Кинерет как намеренная озеро-дыра и т.п.) и причины
    замены — в geometry_cleanup.py."""
    MUTABLE_ISO = {"PS", "JO", "SY", "LB"}
    mutable = [ft for ft in features if ft["properties"]["iso_a2"] in MUTABLE_ISO]
    if not mutable:
        return
    minx, miny, maxx, maxy = unary_union(
        [shape(ft["geometry"]) for ft in mutable]).bounds
    clip_box = shp_box(minx - 0.5, miny - 0.5, maxx + 0.5, maxy + 0.5)
    context = []
    for ft in features:
        if ft["properties"]["iso_a2"] in MUTABLE_ISO:
            continue
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))
    water = load_water_geoms(clip_box)
    absorb_slivers_until_stable(mutable, context, water, clip_box, label="MidEast")


# Озёра, по которым обрезается суша (регион не должен закрывать воду) —
# у каждого источника суши берег оцифрован грубее реального. НЕ включает
# Аральское: пользователь отложил его на будущее (отдельная история с
# восстановлением границ 1946 года, см. lakes_1946.geojson).
CLIP_LAKE_NAMES = {
    "Мёртвое море",             # Иордания/Иерусалим/Беэр-Шева заходили на 0.01-0.03 deg2
    "Кинерет (Галилейское море)",  # Tiberias закрывал озеро сушей (2026-07-19-f)
}


def clip_against_dead_sea(features):
    """Обрезает сушу по озёрам CLIP_LAKE_NAMES (scripts/map/out/
    lakes_1946.geojson) — реальный берег ближе к воде, чем оцифровка
    источников суши. Найдено 2026-07-19 по жалобе на "границы заходят на
    Мёртвое море"; 2026-07-19-f сюда же добавлен Кинерет (округ Kinneret в
    geoBoundaries ISR включает воду сплошняком, из-за чего Tiberias закрывал
    озеро сушей — теперь озеро вырезано в настоящий водоём). geometry_cleanup
    подхватывает эти озёра как воду автоматически (load_water_geoms), поэтому
    absorb_slivers не заполняет вырезанное."""
    lakes_path = out("lakes_1946.geojson")
    with open(lakes_path, encoding="utf-8") as f:
        lakes_fc = json.load(f)
    lake_geoms = [shape(ft["geometry"]) for ft in lakes_fc["features"]
                   if ft["properties"].get("name") in CLIP_LAKE_NAMES]
    if not lake_geoms:
        print(f"  [LAKES] ВНИМАНИЕ: не найдено ни одного из {CLIP_LAKE_NAMES} в lakes_1946.geojson")
        return
    lakes_union = unary_union(lake_geoms)
    n_clipped = 0
    for ft in features:
        g = shape(ft["geometry"])
        if g.intersects(lakes_union):
            clipped = g.difference(lakes_union)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)
                n_clipped += 1
    print(f"  [LAKES] обрезано регионов по озёрам: {n_clipped}")


def apply_vietnam_explicit_merges(features):
    """По явному списку кодов от пользователя (агломерации Ханоя и Хошимина
    на современной спутниковой карте) — а не автоматическим слиянием с
    ближайшим соседом, как было раньше."""
    by_code = {}
    for ft in features:
        if ft["properties"]["iso_a2"] != "VN":
            continue
        for code in ft["properties"]["source_adm1"]:
            by_code[code] = ft

    for codes, label in VIETNAM_EXPLICIT_MERGES:
        feats_to_merge = []
        for code in codes:
            ft = by_code.get(code)
            if ft is None:
                print(f"  [VN-MERGE] ВНИМАНИЕ: код {code} не найден")
                continue
            if ft not in feats_to_merge:
                feats_to_merge.append(ft)
        if not feats_to_merge:
            continue
        geoms = [shape(ft["geometry"]) for ft in feats_to_merge]
        merged_geom = unary_union(geoms)
        if not merged_geom.is_valid:
            merged_geom = merged_geom.buffer(0)
        all_codes = []
        for ft in feats_to_merge:
            all_codes.extend(ft["properties"]["source_adm1"])
        # первая фича группы становится итоговой, остальные удаляются
        main_ft = feats_to_merge[0]
        main_ft["geometry"] = mapping(merged_geom)
        main_ft["properties"]["name"] = label
        main_ft["properties"]["source_adm1"] = all_codes
        main_ft["properties"]["source_count"] = len(all_codes)
        main_ft["properties"]["area_km2"] = round(area_km2(merged_geom), 1)
        main_ft["properties"]["merge_method"] = "explicit_agglomeration"
        if merged_geom.geom_type == "MultiPolygon" and len(merged_geom.geoms) > 1:
            parts_area = sorted([area_km2(p) for p in merged_geom.geoms], reverse=True)
            second_largest = parts_area[1]
            # мелкие куски (десятки-сотни км2) - это настоящие прибрежные
            # острова провинции (напр. Phú Quốc), не ошибка. Предупреждаем
            # только если второй кусок действительно крупный.
            if second_largest > 2000:
                print(f"  [VN-MERGE] ВНИМАНИЕ: '{label}' получился РАЗРЫВНЫМ — "
                      f"второй по величине кусок {second_largest:.0f} км2 "
                      f"(всего частей: {len(parts_area)}) — проверь смежность кодов")
        for ft in feats_to_merge[1:]:
            if ft in features:
                features.remove(ft)


def tag_strategic_points(features):
    for name, lon, lat, note in STRATEGIC_POINTS:
        pt = Point(lon, lat)
        hit, hit_dist = None, None
        for ft in features:
            g = shape(ft["geometry"])
            if g.contains(pt):
                hit, hit_dist = ft, None
                break
            d = g.distance(pt)
            if hit_dist is None or d < hit_dist:
                hit, hit_dist = ft, d
        if hit and (hit_dist is None or hit_dist < 1.0):
            hit["properties"].setdefault("strategic_points", []).append(
                {"name": name, "note": note})
            tag = "contains" if hit_dist is None else f"nearest, gap={hit_dist:.3f}°"
            print(f"  [STRATEGIC] '{name}' -> {hit['properties']['name']} ({tag})")
        else:
            print(f"  [STRATEGIC] '{name}' НЕ НАЙДЕН ни в одном регионе ({lon},{lat})")

# --------------------------------------------------------------------------
# Общие функции (идентичны build_europe_1946.py)
# --------------------------------------------------------------------------

def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_features(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data["features"]


def to_item(feat):
    p = feat["properties"]
    geom = shape(feat["geometry"])
    code = p.get("adm1_code")
    name = NAME_OVERRIDES_1946.get(code, p.get("name"))
    return {
        "adm1_code": code,
        "name": name,
        "region_field": (p.get("region") or "").strip(),
        "geom": geom,
        "area": area_km2(geom),
    }


def make_output_feature(cluster, iso2, source="?"):
    geom = cluster["geom"]
    names = cluster["names"]
    main_name = names[0]
    label = main_name if len(names) == 1 else f"{main_name} ({len(names)})"
    return {
        "type": "Feature",
        "properties": {
            "iso_a2": iso2,
            "name": label,
            "source_adm1": cluster["codes"],
            "source_count": len(cluster["codes"]),
            "area_km2": round(cluster["area"], 1),
            "merge_method": source,
        },
        "geometry": mapping(geom),
    }


def group_by_region(items, exclude_region=None):
    exclude_region = exclude_region or set()
    buckets = {}
    singles = []
    excluded = []
    for it in items:
        rf = it["region_field"]
        if rf in exclude_region:
            excluded.append(it)
            continue
        if not rf:
            singles.append(it)
            continue
        buckets.setdefault(rf, []).append(it)

    clusters = []
    for key, grp in buckets.items():
        geom = unary_union([g["geom"] for g in grp]) if len(grp) > 1 else grp[0]["geom"]
        clusters.append({
            "codes": [g["adm1_code"] for g in grp],
            "names": [key],
            "geom": geom,
            "area": sum(g["area"] for g in grp),
        })

    for it in singles:
        clusters.append({
            "codes": [it["adm1_code"]],
            "names": [it["name"]],
            "geom": it["geom"],
            "area": it["area"],
        })

    return clusters, excluded


def adjacency(clusters, buffer_deg=0.0005):
    n = len(clusters)
    adj = {i: set() for i in range(n)}
    buffered = [c["geom"].buffer(buffer_deg) for c in clusters]
    for i in range(n):
        for j in range(i + 1, n):
            try:
                if buffered[i].intersects(buffered[j]):
                    adj[i].add(j)
                    adj[j].add(i)
            except Exception:
                pass
    return adj


def clusters_from_items(items):
    return [{
        "codes": [it["adm1_code"]],
        "names": [it["name"]],
        "geom": it["geom"],
        "area": it["area"],
    } for it in items]


def compactness(geom):
    """Polsby-Popper: 4*pi*Area/Perimeter^2. 1.0 = идеальный круг, чем ближе
    к 0, тем более вытянута/изрезана форма."""
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def reduce_clusters(clusters, target):
    clusters = list(clusters)
    if len(clusters) <= target:
        return clusters

    while len(clusters) > target:
        adj = adjacency(clusters)
        candidates = [i for i in range(len(clusters)) if adj[i]]
        if not candidates:
            break
        i = min(candidates, key=lambda idx: clusters[idx]["area"])
        # сосед выбирается не по минимальной площади, а по тому, какое
        # слияние даёт наиболее компактную (не вытянутую) форму результата
        best_j, best_score = None, -1.0
        for j in adj[i]:
            trial = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
            score = compactness(trial)
            if score > best_score:
                best_j, best_score = j, score
        j = best_j
        merged_geom = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
        all_parts = [(nm, ar) for nm, ar in zip(
            clusters[i]["names"] + clusters[j]["names"],
            [clusters[i]["area"]] * len(clusters[i]["names"]) + [clusters[j]["area"]] * len(clusters[j]["names"])
        )]
        merged = {
            "codes": clusters[i]["codes"] + clusters[j]["codes"],
            "names": [max(all_parts, key=lambda x: x[1])[0]] + [n for n, _ in all_parts],
            "geom": merged_geom,
            "area": clusters[i]["area"] + clusters[j]["area"],
        }
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]

    return clusters


def geometric_merge(items, target):
    return reduce_clusters(clusters_from_items(items), target)


# TW идёт через GEOMETRIC (target=4): Kinmen/Penghu остаются 1-уездными
# кластерами (имя = реальный уезд, корректно), а 2 больших кластера (17 и 19
# слитых уездов) получают имя "победившего" по площади уезда — вводит в
# заблуждение (напр. регион назывался "Hsinchu" при 7x площади реального
# Синьчжу). Пользователь (2026-07-22): "Только починить имена" — 4 региона
# не менять, только переименовать многоуездные по географическому положению.
TW_MULTI_NAMES_BY_LAT_DESC = ["Северный Тайвань", "Южный Тайвань", "Центральный Тайвань"]


def rename_taiwan_clusters(clusters):
    multi = [c for c in clusters if len(c["codes"]) > 1]
    multi.sort(key=lambda c: -c["geom"].centroid.y)
    for i, c in enumerate(multi):
        name = (TW_MULTI_NAMES_BY_LAT_DESC[i] if i < len(TW_MULTI_NAMES_BY_LAT_DESC)
                else f"Тайвань ({i + 1})")
        c["names"][0] = name  # заменяем "победивший" уезд на геогр. имя, len(names) не трогаем (счётчик в скобках)
    return clusters


def geometric_merge_by_zone(items, sub_targets):
    buckets = {}
    for it in items:
        key = it["region_field"] or "_none"
        buckets.setdefault(key, []).append(it)
    all_clusters = []
    for zone, grp in buckets.items():
        target = sub_targets.get(zone, len(grp))
        all_clusters.extend(geometric_merge(grp, target))
    return all_clusters


def geometric_merge_by_custom_zone(items, zone_of, default_zone, sub_targets):
    buckets = {}
    for it in items:
        zone = zone_of.get(it["name"], default_zone)
        buckets.setdefault(zone, []).append(it)
    all_clusters = []
    for zone, grp in buckets.items():
        target = sub_targets.get(zone, len(grp))
        all_clusters.extend(geometric_merge(grp, target))
    return all_clusters


def main():
    t0 = time.time()
    feats = load_features(SRC)
    by_code = {f["properties"].get("adm1_code"): f for f in feats}
    by_country = {}
    for f in feats:
        iso2 = f["properties"].get("iso_a2")
        if iso2 in ALL_COUNTRIES:
            by_country.setdefault(iso2, []).append(to_item(f))

    out_features = []
    report = []

    # Китай — отдельно обработанный исторический набор (см. выше)
    with open(CHINA_HISTORICAL_FILE, encoding="utf-8") as f:
        china_fc = json.load(f)
    for ft in china_fc["features"]:
        ft["properties"]["merge_method"] = ft["properties"].get("merge_method", "historical")
        ft["properties"]["source_adm1"] = [ft["properties"]["name"]]
        ft["properties"]["source_count"] = 1
        out_features.append(ft)
    report.append({"iso2": "CN", "method": "historical_shapefile",
                    "source_units": 36, "output_regions": len(china_fc["features"])})

    # Подмандатная Палестина (2026-07-19-i) — сырые провинции game_map.json
    # (6 округов Израиля + 2 пятна Палестины), не историческая 16-подрайонная
    # реконструкция (откат по требованию пользователя, build_palestine_
    # 1946.py остаётся на диске справочным материалом для будущего
    # разбиения). iso_a2="PS" на выходе для ВСЕХ (владелец резолвится в PSE
    # через occupation_overlay.json) — единый тег вместо исходных IL/PS,
    # т.к. это была одна территория в 1946 году (конвенция не изменилась).
    golan_src_fc = None
    golan_ft = None
    with open(GOLAN_SRC, encoding="utf-8") as f:
        golan_src_fc = json.load(f)
    for ft in golan_src_fc["features"]:
        if ft["properties"].get("shapeName") == "Golan":
            golan_ft = ft
            break
    if golan_ft is None:
        print("  [PS] ВНИМАНИЕ: 'Golan' не найден в geoBoundaries ISR ADM2 — Голан не вырезан")

    golan_geom = shape(golan_ft["geometry"]) if golan_ft is not None else None
    hazafon_clipped_geom = None
    if golan_geom is not None:
        # geoBoundaries ISR-полигон Golan слегка заходит на границы
        # Иордании И Ливана (Natural Earth) — обрезаем по СЫРЫМ исходным
        # юнитам обеих стран, уже в by_country (SY/JO/LB все теперь
        # KEEP_AS_IS, см. выше). Иордания: 0.00073 deg2 наложение
        # Amman/Rif Dimashq (2026-07-19); Ливан: 0.00013 deg2 наложение
        # South Lebanon/Rif Dimashq в районе Шебаа/Хермон (2026-07-19-e).
        raw_neighbors = by_country.get("JO", []) + by_country.get("LB", [])
        if raw_neighbors:
            neighbors_union = unary_union([it["geom"] for it in raw_neighbors])
            if golan_geom.intersects(neighbors_union):
                golan_geom = golan_geom.difference(neighbors_union)
                if not golan_geom.is_valid:
                    golan_geom = golan_geom.buffer(0)
        # HaZafon (Natural Earth) и Golan (geoBoundaries ISR) — независимо
        # оцифрованные границы вдоль одного и того же шва. difference()
        # между ними режет HaZafon не одной чистой линией, а зигзагом,
        # оставляя несколько мелких кусков HaZafon, отрезанных от её
        # основного тела и висящих прямо на границе Golan (2026-07-19-j,
        # прямой скриншот пользователя — 3 подписи "HaZafon" на карте).
        # Проверено численно: все такие обрезки касаются Golan на
        # distance=0.0, но отстоят от основного тела HaZafon на 0.02-0.1° —
        # это не отдельная территория, а шовный мусор. Тот же принцип, что
        # уже применён к UNDOF: Golan авторитетен для своей границы,
        # обрезки уходят в него, а не остаются висячими кусками HaZafon.
        hazafon_ft = next((f for f in feats if f["properties"].get("iso_a2") in PALESTINE_RAW_ISO
                             and f["properties"].get("name") == "HaZafon"), None)
        if hazafon_ft is not None:
            hz_clipped = shape(hazafon_ft["geometry"]).difference(golan_geom)
            if not hz_clipped.is_valid:
                hz_clipped = hz_clipped.buffer(0)
            if hz_clipped.geom_type == "MultiPolygon":
                parts = sorted(hz_clipped.geoms, key=lambda p: -p.area)
                hz_main, hz_strays = parts[0], parts[1:]
                stray_km2 = sum(area_km2(p) for p in hz_strays)
                if hz_strays:
                    golan_geom = unary_union([golan_geom] + hz_strays)
                    if not golan_geom.is_valid:
                        golan_geom = golan_geom.buffer(0)
                    print(f"  [PS] HaZafon: {len(hz_strays)} обрезков "
                          f"({round(stray_km2, 2)} km2) у границы Golan "
                          f"переданы в Golan, осталось основное тело")
                hazafon_clipped_geom = hz_main
            else:
                hazafon_clipped_geom = hz_clipped

        # Раздельные источники: сырые сирийские провинции (Natural Earth,
        # включая анахроничный UNDOF) и Golan (geoBoundaries ISR) реально
        # накладываются — UNDOF (буферная зона ООН 1974 года) сидит именно
        # на границе Голана, оцифрован независимо. Найдено численно
        # (merge_world_1946.py: 'ASI-0313 UNDOF x ASI-0328 Golan 0.00412
        # deg2' = 42.6 km2, ~16% площади UNDOF, 2026-07-19-i). Golan —
        # специально построенная историческая граница, авторитетна для
        # своей области; обрезаем по нему уже загруженные сырые сирийские
        # юниты (UNDOF и любой другой, кто случайно заходит), не наоборот.
        syria_raw = by_country.get("SY", [])
        for it in syria_raw:
            if it["geom"].intersects(golan_geom):
                clipped = it["geom"].difference(golan_geom)
                if not clipped.is_valid:
                    clipped = clipped.buffer(0)
                if clipped.area > 1e-9:
                    removed_km2 = it["area"] - area_km2(clipped)
                    it["geom"] = clipped
                    it["area"] = area_km2(clipped)
                    print(f"  [SY] {it['name']} обрезана по Golan "
                          f"(-{round(removed_km2, 1)} km2)")

        # Приклеиваем как доп. исходный юнит Сирии ДО того, как SY пройдёт
        # через KEEP_AS_IS/clusters_from_items — станет отдельным сирийским
        # регионом "Golan", как и остальные сырые провинции.
        by_country.setdefault("SY", []).append({
            "adm1_code": "GEOB-ISR-GOLAN",
            "name": golan_ft["properties"]["shapeName"],
            "region_field": "",
            "geom": golan_geom,
            "area": area_km2(golan_geom),
        })

    with open(PSE_SRC, encoding="utf-8") as f:
        pse_src_fc = json.load(f)
    pse_by_name = {ft["properties"]["shapeName"]: shape(ft["geometry"]) for ft in pse_src_fc["features"]}

    # Остальные сырые PS-фичи (ISR-источник) уже занимают часть общей
    # границы с новыми PSE-губернаторствами Западного берега (граница
    # перемирия 1949 года/"зелёная линия" оцифрована по-разному в двух
    # независимых источниках) — авторитетны существующие ISR-регионы,
    # новые PSE-губернаторства обрезаются по ним, не наоборот.
    existing_ps_geoms = []
    for f in feats:
        if f["properties"].get("iso_a2") not in PALESTINE_RAW_ISO:
            continue
        nm = f["properties"].get("name")
        if nm == "West Bank":
            continue
        gg = hazafon_clipped_geom if (nm == "HaZafon" and hazafon_clipped_geom is not None) else shape(f["geometry"])
        existing_ps_geoms.append(gg)
    existing_ps_union = unary_union(existing_ps_geoms) if existing_ps_geoms else None

    # PSE ADM2 "Jerusalem" губернаторство намеренно НЕ выделяется отдельным
    # регионом (совпало бы по имени с уже существующим raw "Jerusalem" из
    # ISR-источника) — но покрывает на 282.6 km2 больше, чем raw "Jerusalem"
    # (восточная/окружная часть, Абу-Дис и т.п.), иначе эта площадь осталась
    # бы настоящей дырой между Ramallah/Bethlehem/Jericho (2026-07-19-j,
    # найдено рендером). Довешиваем недостающий кусок к существующему
    # "Jerusalem" вместо создания дублирующего по имени региона.
    pse_jerusalem_extra = None
    pse_jerusalem_geom = pse_by_name.get("Jerusalem")
    if pse_jerusalem_geom is not None and existing_ps_union is not None:
        if not pse_jerusalem_geom.is_valid:
            pse_jerusalem_geom = pse_jerusalem_geom.buffer(0)
        pse_jerusalem_extra = pse_jerusalem_geom.difference(existing_ps_union)
        if not pse_jerusalem_extra.is_valid:
            pse_jerusalem_extra = pse_jerusalem_extra.buffer(0)
        if pse_jerusalem_extra.area <= 1e-9:
            pse_jerusalem_extra = None

    ps_count = 0
    for f in feats:
        iso2 = f["properties"].get("iso_a2")
        if iso2 not in PALESTINE_RAW_ISO:
            continue
        it = to_item(f)
        if it["name"] == "West Bank":
            # Заменяем единое пятно 10 губернаторствами PSE ADM2 — см.
            # WEST_BANK_GOVERNORATES выше за обоснованием.
            wb_neighbors_union = existing_ps_union
            for gov_name in WEST_BANK_GOVERNORATES:
                gg = pse_by_name.get(gov_name)
                if gg is None:
                    print(f"  [PS] ВНИМАНИЕ: губернаторство '{gov_name}' не найдено в geoBoundaries PSE ADM2")
                    continue
                if not gg.is_valid:
                    gg = gg.buffer(0)
                # Соседние губернаторства из ЭТОГО же источника, уже
                # разложенные раньше по списку, плюс остальные PS-регионы
                # (ISR-источник) — обрезаем по ним, чтобы не плодить
                # внутренние наложения на общей границе.
                if wb_neighbors_union is not None and gg.intersects(wb_neighbors_union):
                    gg = gg.difference(wb_neighbors_union)
                    if not gg.is_valid:
                        gg = gg.buffer(0)
                wb_neighbors_union = gg if wb_neighbors_union is None else unary_union([wb_neighbors_union, gg])
                out_features.append({
                    "type": "Feature",
                    "properties": {
                        "iso_a2": "PS",
                        "name": gov_name,
                        "source_adm1": [f"PSE-ADM2-{gov_name}"],
                        "source_count": 1,
                        "area_km2": round(area_km2(gg), 1),
                        "merge_method": "west_bank_governorate",
                    },
                    "geometry": mapping(gg),
                })
                ps_count += 1
            continue
        g = it["geom"]
        if it["name"] == "HaZafon" and hazafon_clipped_geom is not None:
            g = hazafon_clipped_geom
        if it["name"] == "Jerusalem" and pse_jerusalem_extra is not None:
            g = unary_union([g, pse_jerusalem_extra])
            if not g.is_valid:
                g = g.buffer(0)
        out_features.append({
            "type": "Feature",
            "properties": {
                "iso_a2": "PS",
                "name": it["name"],
                "source_adm1": [it["adm1_code"]],
                "source_count": 1,
                "area_km2": round(area_km2(g), 1),
                "merge_method": "keep_raw",
            },
            "geometry": mapping(g),
        })
        ps_count += 1
    report.append({"iso2": "PS", "method": "keep_raw",
                    "source_units": ps_count, "output_regions": ps_count})

    # Довесок PSE-Иерусалима выше union'ится с raw "Jerusalem" не идеально
    # чисто — общая граница даёт несколько крошечных обрезков (<0.4 km2
    # суммарно, 2026-07-19-j), все касаются Bethlehem (distance=0.0), не
    # основного тела Иерусалима. Тот же приём, что для HaZafon/Golan:
    # оставляем в Иерусалиме только наибольший кусок, обрезки — в Bethlehem.
    jerusalem_ft = next((ft for ft in out_features if ft["properties"].get("iso_a2") == "PS"
                          and ft["properties"].get("name") == "Jerusalem"), None)
    if jerusalem_ft is not None:
        jg = shape(jerusalem_ft["geometry"])
        if jg.geom_type == "MultiPolygon" and len(jg.geoms) > 1:
            parts = sorted(jg.geoms, key=lambda p: -p.area)
            jer_main, jer_strays = parts[0], parts[1:]
            bethlehem_ft = next((ft for ft in out_features if ft["properties"].get("iso_a2") == "PS"
                                  and ft["properties"].get("name") == "Bethlehem"), None)
            if bethlehem_ft is not None:
                bg = unary_union([shape(bethlehem_ft["geometry"])] + list(jer_strays))
                if not bg.is_valid:
                    bg = bg.buffer(0)
                bethlehem_ft["geometry"] = mapping(bg)
                bethlehem_ft["properties"]["area_km2"] = round(area_km2(bg), 1)
                stray_km2 = sum(area_km2(p) for p in jer_strays)
                print(f"  [PS] Jerusalem: {len(jer_strays)} обрезков "
                      f"({round(stray_km2, 2)} km2) у границы Bethlehem "
                      f"переданы в Bethlehem, осталось основное тело")
            jerusalem_ft["geometry"] = mapping(jer_main)
            jerusalem_ft["properties"]["area_km2"] = round(area_km2(jer_main), 1)

    # Киркук (At-Ta'mim) — 2026-07-19-j: вынести из зоны "Iraq" в свою
    # зону-синглтон "Kirkuk" ДО geometric_merge_by_zone, чтобы не утонуть в
    # одном из 7 обычных иракских кластеров. Главная спорная территория
    # курдского вопроса (ст. 140 конституции Ирака, референдум 2017,
    # столкновения пешмерга/иракской армии в 2017) — по значимости должна
    # быть отдельным регионом, не частью произвольного соседа.
    for it in by_country.get("IQ", []):
        if it["name"] == "Kirkuk":  # NAME_OVERRIDES_1946 переименовал At-Ta'mim
            it["region_field"] = "Kirkuk"
            break
    else:
        print("  [IQ] ВНИМАНИЕ: 'Kirkuk' (At-Ta'mim) не найден среди сырых провинций")

    # Отдельные фичи по adm1_code (анклавы с iso_a2='-1', спорные территории)
    for code, label, out_iso2 in EXTRA_SINGLE_FEATURES:
        f = by_code.get(code)
        if not f:
            print(f"  [EXTRA] ВНИМАНИЕ: '{label}' ({code}) не найден в game_map.json")
            continue
        it = to_item(f)
        cluster = {"codes": [code], "names": [label], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cluster, out_iso2, "extra"))
        report.append({"iso2": out_iso2, "method": "extra", "source_units": 1, "output_regions": 1})

    for iso2 in sorted(ALL_COUNTRIES):
        items = by_country.get(iso2, [])
        n_source = len(items)
        if n_source == 0:
            print(f"  [{iso2}] ВНИМАНИЕ: 0 регионов найдено в game_map.json")
            continue

        if iso2 in KEEP_AS_IS:
            clusters = clusters_from_items(items)
            method = "keep"

        elif iso2 in SINGLE_REGION:
            geom = unary_union([it["geom"] for it in items]) if len(items) > 1 else items[0]["geom"]
            clusters = [{
                "codes": [it["adm1_code"] for it in items],
                "names": [SINGLE_REGION[iso2]],
                "geom": geom,
                "area": sum(it["area"] for it in items),
            }]
            method = "single"

        elif iso2 in REGION_FIELD:
            cfg = REGION_FIELD[iso2]
            clusters, excluded = group_by_region(items, cfg.get("exclude_region"))
            post_target = cfg.get("post_target")
            if post_target and len(clusters) > post_target:
                clusters = reduce_clusters(clusters, post_target)
            method = "region"

        elif iso2 in ZONED_GEOMETRIC:
            cfg = ZONED_GEOMETRIC[iso2]
            clusters = geometric_merge_by_zone(items, cfg["targets"])
            method = "zoned"

        elif iso2 in CUSTOM_ZONED:
            cfg = CUSTOM_ZONED[iso2]
            clusters = geometric_merge_by_custom_zone(
                items, cfg["zone_of"], cfg["default_zone"], cfg["targets"])
            method = "custom_zoned"

        elif iso2 in GEOMETRIC:
            target = GEOMETRIC[iso2]
            clusters = geometric_merge(items, target)
            if iso2 == "TW":
                clusters = rename_taiwan_clusters(clusters)
            method = "geometric"

        else:
            continue

        # LB (2026-07-19-i): раньше здесь переименовывался слитый кластер
        # "South Lebanon"+"An Nabatiyah" — с откатом на KEEP_AS_IS слияния
        # больше нет, An Nabatiyah выходит отдельной сырой провинцией под
        # своим именем (буквально, по решению пользователя).

        for c in clusters:
            out_features.append(make_output_feature(c, iso2, method))

        report.append({
            "iso2": iso2, "method": method,
            "source_units": n_source, "output_regions": len(clusters),
        })

    # v2: Китай теперь на современной основе (см. build_china_1946_v2.py) —
    # границы с соседями (Россия/Монголия/Корея/Вьетнам/Индия/Афганистан и
    # т.д.) совпадают по построению, отдельная борьба с зазорами/
    # пересечениями больше не нужна
    clip_palestine_to_neighbors(out_features)
    clip_against_dead_sea(out_features)
    # Разрывы ("зиппер") между PS/JO/SY/LB и их швы с Ираком/Турцией/водой —
    # gap-first поглощение слайверов вместо прежнего buffer-based
    # дозаполнения с пост-клипами (см. geometry_cleanup.py за методом и
    # docs/DECISIONS.md "2026-07-19-e" за историей замены).
    absorb_middle_east_slivers(out_features)
    apply_vietnam_explicit_merges(out_features)
    tag_strategic_points(out_features)

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    total_area_out = sum(ft["properties"]["area_km2"] for ft in out_features)

    print(f"Готово за {time.time()-t0:.1f} сек")
    print(f"Итоговых регионов: {len(out_features)} (исходных ADM1: {sum(r['source_units'] for r in report)})")
    print(f"Суммарная площадь результата: {total_area_out:,.0f} km2")
    print()
    print(f"{'iso2':5}{'метод':10}{'было':6}{'стало':6}")
    for r in sorted(report, key=lambda r: -r["source_units"]):
        print(f"{r['iso2']:5}{r['method']:10}{r['source_units']:6}{r['output_regions']:6}")

    return report, total_area_out, len(out_features)


if __name__ == "__main__":
    main()
