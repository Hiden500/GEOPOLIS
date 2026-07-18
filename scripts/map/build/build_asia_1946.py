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
from paths import game_map, out
import json
import time
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

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
}

# Китай — НЕ из game_map.json (современные 32 провинции — потолок без
# реальной Маньчжурии 1946 года), а из отдельно обработанного shapefile
# Virtual Shanghai (1947-49, реорганизация Маньчжурии 1945-46 не менялась
# до 1949) — см. build_china_historical_1946.py. 40 регионов: 24 обычных
# провинции + Тибет + Синьцзян + 9 маньчжурских + Бэйпин/Тяньцзинь/Шанхай/
# Чунцин (вырезаны по современным контурам, других границ 1946 года нет) +
# Парасельские острова.
CHINA_HISTORICAL_FILE = out("china_1946_historical.json")

# Подмандатная Палестина (IL+PS в исходнике) — реальный 1946 год: 16
# подрайонов / 6 округов мандата, не 6 современных израильских округов + 2
# нерасчленённых пятна. См. build_palestine_1946.py за источниками и
# группировкой (в источнике нет native controller/historical shapefile, как
# у Германии/Кореи/Китая — построено объединением совр. ADM2-юнитов
# geoBoundaries по историческому подрайону).
PALESTINE_HISTORICAL_FILE = out("palestine_1946_historical.json")

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
}

REGION_FIELD = {
    "AZ": {},  # 10 экономических районов Азербайджана (включая Нахичевань)
    "JP": {},  # 9 традиционных областей Японии (план: 10-15 ✓)
    "PH": {},  # 17 официальных регионов Филиппин
}

ZONED_GEOMETRIC = {
    "IQ": {
        # Ближний Восток — максимальная детализация для будущей войны
        "field": "region",
        "targets": {"Iraq": 7, "Kurdistan": 3},
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
    "LB": {
        # Ливан — курированная группировка в 5 РЕАЛЬНЫХ мухафаз 1946 года
        # (Бейрут/Гора Ливан/Северный Ливан/Южный Ливан/Бекаа), не слепой
        # geometric-merge (2026-07-19, по принципу "совместимость с будущими
        # конфликтами" — см. docs/HISTORICAL_ACCURACY.md). Гражданская война
        # 1975-1990 и последующие конфликты (южноливанская "зона
        # безопасности" Израиля 1982-2000, война 2006) проходят ровно по
        # линиям этих 5 мухафаз (Бейрут — христ./мусульм. раздел города;
        # Гора Ливан — христиане/друзы; Север — сунниты; Бекаа — шииты,
        # позже Хезболла и сирийское влияние; Юг — шииты/палестинские
        # лагеря/зона израильской оккупации) — слепой алгоритм мог бы
        # смешать ровно эти значимые для будущих сценариев линии.
        # "An Nabatiyah" (мухафаза с 1975, выделена из Южного Ливана) на
        # 1946 год не существовала — сворачиваю обратно в South Lebanon,
        # территорию её происхождения.
        "zone_of": {
            "Beirut": "Beirut", "Mount Lebanon": "Mount Lebanon",
            "North Lebanon": "North Lebanon", "South Lebanon": "South Lebanon",
            "An Nabatiyah": "South Lebanon", "Beqaa": "Beqaa",
        },
        "default_zone": "South Lebanon",
        "targets": {"Beirut": 1, "Mount Lebanon": 1, "North Lebanon": 1,
                     "South Lebanon": 1, "Beqaa": 1},
    },
}

GEOMETRIC = {
    "AF": 8, "AM": 3, "GE": 3, "JO": 6, "KG": 4, "TJ": 4,
    "MM": 6, "KH": 5, "LA": 4, "MN": 8, "KZ": 10, "UZ": 6, "MY": 6,
    "ID": 20, "SY": 10, "SA": 8, "OM": 4,
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


def clip_against_dead_sea(features):
    """Иордания (Karak/Amman, game_map.json/Natural Earth) и Иерусалим/
    Беэр-Шева (geoBoundaries) независимо заходят на полигон Мёртвого моря
    (scripts/map/out/lakes_1946.geojson) на 0.01-0.03 deg2 — реальные
    границы суши там ближе к берегу, чем оцифровка этих источников. Найдено
    2026-07-19 по жалобе пользователя на "границы заходят на Мёртвое море".
    ТОЛЬКО Мёртвое море - Аральское специально не трогаем здесь (пользователь
    отложил его на будущее, у него отдельная история с восстановлением
    границ 1946 года, см. lakes_1946.geojson)."""
    lakes_path = out("lakes_1946.geojson")
    with open(lakes_path, encoding="utf-8") as f:
        lakes_fc = json.load(f)
    lake_geoms = [shape(ft["geometry"]) for ft in lakes_fc["features"]
                   if ft["properties"].get("name") == "Мёртвое море"]
    if not lake_geoms:
        print("  [DEAD SEA] ВНИМАНИЕ: полигон 'Мёртвое море' не найден в lakes_1946.geojson")
        return
    lake = unary_union(lake_geoms)
    n_clipped = 0
    for ft in features:
        g = shape(ft["geometry"])
        if g.intersects(lake):
            clipped = g.difference(lake)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)
                n_clipped += 1
    print(f"  [DEAD SEA] обрезано регионов: {n_clipped}")


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

    # Подмандатная Палестина — отдельно обработанный исторический набор
    # (см. build_palestine_1946.py). iso_a2="PS" на выходе (владелец в
    # любом случае резолвится в PSE через occupation_overlay.json, не
    # через iso_a2 напрямую) — единый тег вместо исходных IL/PS, т.к. это
    # была одна территория в 1946 году.
    with open(PALESTINE_HISTORICAL_FILE, encoding="utf-8") as f:
        palestine_fc = json.load(f)
    ps_count = 0
    for ft in palestine_fc["features"]:
        if ft["properties"]["iso_a2"] == "SY":
            # Голанские высоты (см. build_palestine_1946.py) — не подрайон
            # Палестины, реальная дыра в game_map.json для Сирии/Израиля
            # (не была покрыта ни одним набором до этой находки 2026-07-19).
            # Вливаем как доп. исходный юнит Сирии ДО GEOMETRIC-слияния —
            # алгоритм сам подхватит её к соседнему кластеру (Quneitra/Dar'a),
            # а не оставляем отдельной необработанной фичей.
            g = shape(ft["geometry"])
            # geoBoundaries ISR-полигон Golan слегка заходит на границу
            # Иордании (Natural Earth) — обрезаем по СЫРЫМ (ещё не слитым)
            # исходным юнитам Иордании, уже загруженным в by_country на
            # этом шаге; итоговая площадь union не зависит от того, как
            # именно они будут сгруппированы дальше (найдено 2026-07-19,
            # 0.00073 deg2 наложение Amman/Rif Dimashq до этого фикса).
            jordan_raw = by_country.get("JO", [])
            if jordan_raw:
                jordan_union = unary_union([it["geom"] for it in jordan_raw])
                if g.intersects(jordan_union):
                    g = g.difference(jordan_union)
                    if not g.is_valid:
                        g = g.buffer(0)
            by_country.setdefault("SY", []).append({
                "adm1_code": "GEOB-ISR-GOLAN",
                "name": ft["properties"]["name"],
                "region_field": "",
                "geom": g,
                "area": area_km2(g),
            })
            continue
        ft["properties"]["source_adm1"] = [ft["properties"]["name"]]
        ft["properties"]["source_count"] = 1
        out_features.append(ft)
        ps_count += 1
    report.append({"iso2": "PS", "method": "historical_adm2_group",
                    "source_units": 31, "output_regions": ps_count})

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
            method = "geometric"

        else:
            continue

        if iso2 == "LB":
            # Слитая зона "South Lebanon"+"An Nabatiyah" называется по имени
            # наибольшей по площади исходной части — ей оказалась An Nabatiyah
            # (мухафаза только с 1975 года), а не исторически верный South
            # Lebanon. Переименовываем итоговый кластер явно.
            for c in clusters:
                if c["names"] and c["names"][0] == "An Nabatiyah":
                    c["names"] = ["South Lebanon"] + c["names"][1:]

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
