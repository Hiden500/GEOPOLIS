"""
build_china_1946.py (v2 — упрощённая версия)

Принцип по запросу: современные провинции Китая уже корректно стыкуются
друг с другом и с соседями (Россия, Монголия, Корея, Индия и т.д.) —
поэтому берём их КАК ОСНОВУ без изменений, и заменяем только 3 места,
где административное деление 1946 года РЕАЛЬНО отличается:

  1. Маньчжурия: совр. Liaoning+Jilin+Heilongjiang (3) -> истор. 9 провинций
     (Liaoning, Andong, Liaobei, Jilin, Songjiang, Hejiang, Nenjiang,
     Heilongjiang, Xing'an) + отдельно Порт-Артур (Квантунская обл.)
  2. Сикан: совр. Sichuan+Xizang (2) -> истор. Sichuan+Xikang+Xizang (3)
  3. Внутренняя Монголия: совр. Inner Mongol (1) -> истор. Chahaer+Jehol+
     Suiyuan (3)

Остальные ~26 провинций/городов (включая уже отдельные в современных данных
Beijing/Shanghai/Tianjin/Chongqing/Hainan/Paracel Islands) берутся из
game_map.json БЕЗ изменений — поэтому никакой борьбы с соседями (Россия/
Монголия/Корея/Индия/Вьетнам/Афганистан) не нужна: их границы и так
взаимно согласованы, т.к. из одного современного датасета.

Метод замены: каждая историческая провинция группы обрезается по маске
(объединение заменяемых современных провинций), затем то, что осталось
непокрытым после обрезки всех кусков группы (т.к. историческая граница
претензий шире/уже современной), раздаётся ближайшему куску той же группы.
Так исторические внутренние границы сохраняются, а внешняя граница группы
остаётся ТОЧНО современной — швов с соседями просто не возникает.
"""
from paths import game_map, out, source
import json
import shapefile
from shapely.geometry import shape as shp_shape, mapping, box
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
GAME_MAP = game_map()
SHP = source("china_hist/1947-49/1947_1949")
OUT = out("china_1946_historical.json")

MANCHURIA_IDX = set(range(27, 36))  # только в p_47_49 заполнено имя в шейпфайле

REPLACE_GROUPS = [
    {
        # Маньчжурия + Внутр.Монголия объединены: историч. Xing'an (94% его
        # территории) и Liaobei частично лежат в совр. Внутр.Монголии, не
        # только в Liaoning/Jilin/Heilongjiang - раздельные маски обрезали
        # бы их до игрушечных кусков (Xing'an: 262,634 -> 5,425 km2 при
        # раздельной маске!).
        "modern_names": ["Liaoning", "Jilin", "Heilongjiang", "Inner Mongol"],
        "historical_names": ["Liaoning", "Andong", "Liaobei", "Jilin", "Songjiang",
                              "Hejiang", "Nenjiang", "Heilongjiang", "Xing'an",
                              "Chahaer", "Jehol", "Suiyuan"],
        "label": "Маньчжурия + Внутренняя Монголия",
    },
    {
        "modern_names": ["Sichuan", "Xizang"],
        "historical_names": ["Sichuan", "Xikang", "Xizang"],
        "label": "Сикан/Сычуань/Тибет",
    },
]

PORT_ARTHUR_LAT_CUT = 39.46
PORT_ARTHUR_LON_BOX = (120.5, 123.0)

# 5 особых муниципалитетов 1946 года (院辖市), которых нет в современных
# ADM1 (Пекин/Шанхай/Тяньцзинь/Чунцин уже есть как совр. провинции).
# Шэньян стал муниципалитетом только в 1947, Сиань - в 1948, поэтому НЕ
# включены (на момент игры 1946 года их ещё не было).
# Источник границ - geoBoundaries CHN ADM2 (уездный уровень), берём только
# городское ядро ("-shi" 市), не сельские уезды-спутники, присоединённые
# гораздо позже.
SPECIAL_MUNICIPALITIES_1946 = [
    {"city_label": "Nanjing", "adm2_names": ["Nanjingshi"], "host_province": "Jiangsu",
     "note": "Столица Китайской Республики в 1946. Особый муниципалитет (院辖市) с 1927."},
    {"city_label": "Qingdao", "adm2_names": ["Qingdaoshi"], "host_province": "Shandong",
     "note": "Особый муниципалитет (院辖市) с 1929."},
    {"city_label": "Guangzhou", "adm2_names": ["Guangzhoushi"], "host_province": "Guangdong",
     "note": "Особый муниципалитет (院辖市) с 1927."},
    {"city_label": "Hankou (Wuhan)", "adm2_names": ["Wuhanshi"], "host_province": "Hubei",
     "note": "Особый муниципалитет (院辖市) с 1927 (включает Ухань/Ханькоу/Учан)."},
    {"city_label": "Harbin", "adm2_names": ["Haerbinshi"], "host_province": "Songjiang",
     "note": "Особый муниципалитет (院辖市) с 1946 (вырезан из историч. Сунцзян, не совр. Хэйлунцзян)."},
]


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_historical_provinces():
    sf = shapefile.Reader(SHP)
    out = {}
    for i in range(len(sf)):
        raw_rec = sf.record(i)
        if raw_rec is None:
            # pyshp отдаёт None для записи, помеченной в .dbf флагом удаления
            # (Reader.record: "Returns None if record's deletion flag is
            # marked"). Такой провинции в источнике уже нет — пропускаем, как
            # и запись без имени ниже.
            continue
        rec = raw_rec.as_dict()
        name = rec["p_47_49_na"] if i in MANCHURIA_IDX else rec["p_45_46_na"]
        if not name:
            continue
        raw_shape = sf.shape(i)
        if raw_shape is None:
            # None из shape() бывает только при bbox-фильтре, а мы bbox не
            # задаём — сюда попасть нельзя. Если всё же попали, у именованной
            # провинции нет геометрии: тихо потерять её с карты хуже, чем упасть.
            raise ValueError(f"{SHP}: запись {i} ('{name}') без геометрии")
        geom = shp_shape(raw_shape.__geo_interface__)
        if not geom.is_valid:
            geom = geom.buffer(0)
        out[name] = geom
    return out


CHN_ADM2_SRC = source("geoBoundaries-CHN-ADM2.geojson")


def load_counties():
    with open(CHN_ADM2_SRC, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for f in data["features"]:
        g = shp_shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        out.append((f["properties"]["shapeName"], g))
    return out


# Известные факты, противоречащие автоматическому присвоению (вероятная
# неточность границы в исходном shapefile у конкретного уезда) -
# Харбин в shapefile геометрически лежит на территории, нарисованной как
# Nenjiang, но исторически документирован как столица именно Songjiang.
COUNTY_OVERRIDES = {
    "Haerbinshi": "Songjiang",
}


def assign_counties_to_historical(counties, historical_pieces, modern_mask):
    """Для каждого уезда из counties (целиком внутри modern_mask) находит
    историч. провинцию из historical_pieces с максимальным перекрытием,
    затем строит каждую провинцию как объединение её уездов - граница
    становится настоящей уездной линией, а не грубой обрезкой shapefile."""
    relevant = [(n, g) for n, g in counties if g.centroid.within(modern_mask.buffer(0.1))]
    buckets = {name: [] for name, _ in historical_pieces}
    unassigned = []
    for cname, cgeom in relevant:
        if cname in COUNTY_OVERRIDES and COUNTY_OVERRIDES[cname] in buckets:
            buckets[COUNTY_OVERRIDES[cname]].append((cname, cgeom))
            continue
        best_name, best_overlap = None, 0.0
        for hname, hgeom in historical_pieces:
            ov = cgeom.intersection(hgeom).area
            if ov > best_overlap:
                best_name, best_overlap = hname, ov
        if best_name is None:
            unassigned.append((cname, cgeom))
        else:
            buckets[best_name].append((cname, cgeom))

    result = []
    for hname, _ in historical_pieces:
        items = buckets[hname]
        if not items:
            result.append((hname, None))
            continue
        g = unary_union([cg for _, cg in items])
        g = g.intersection(modern_mask)
        if not g.is_valid:
            g = g.buffer(0)
        result.append((hname, g))

    # уезды без перекрытия (центр вне всех историч. полигонов, редкость на
    # стыках) - раздаём ближайшей провинции
    if unassigned:
        for cname, cgeom in unassigned:
            best_idx, best_dist = None, None
            for idx, (hname, g) in enumerate(result):
                if g is None or g.is_empty:
                    continue
                d = g.distance(cgeom)
                if best_dist is None or d < best_dist:
                    best_idx, best_dist = idx, d
            if best_idx is not None:
                hname, g = result[best_idx]
                result[best_idx] = (hname, unary_union([g, cgeom.intersection(modern_mask)]))

    # финальная проверка покрытия (clip_and_fill-стиль остаток на случай
    # уездов, накрывающих сразу обе зоны не полностью)
    covered = unary_union([g for _, g in result if g is not None and not g.is_empty])
    uncovered = modern_mask.difference(covered)
    if not uncovered.is_empty and uncovered.area > 1e-9:
        comps = list(uncovered.geoms) if uncovered.geom_type.startswith("Multi") else [uncovered]
        for comp in comps:
            if comp.area < 1e-10:
                continue
            best_idx, best_dist = None, None
            for idx, (hname, g) in enumerate(result):
                if g is None or g.is_empty:
                    continue
                d = g.distance(comp)
                if best_dist is None or d < best_dist:
                    best_idx, best_dist = idx, d
            if best_idx is not None:
                hname, g = result[best_idx]
                result[best_idx] = (hname, unary_union([g, comp]))

    return [(n, g) for n, g in result if g is not None and not g.is_empty]


def main():
    with open(GAME_MAP, encoding="utf-8") as f:
        gm = json.load(f)
    modern = {}
    for f in gm["features"]:
        p = f["properties"]
        if p.get("iso_a2") == "CN":
            modern[p["name"]] = shp_shape(f["geometry"])

    historical = load_historical_provinces()
    counties = load_counties()
    print(f"Загружено {len(counties)} уездов (geoBoundaries CHN ADM2)")

    county_by_name = {}
    for cname, cgeom in counties:
        if cname in county_by_name:
            county_by_name[cname] = unary_union([county_by_name[cname], cgeom])
        else:
            county_by_name[cname] = cgeom

    replaced_modern_names = set()
    for g in REPLACE_GROUPS:
        replaced_modern_names.update(g["modern_names"])

    out_features = []
    province_features = {}  # имя -> feature, для последующей вырезки муниципалитетов

    # 1) Все нетронутые современные провинции
    for name, geom in modern.items():
        if name in replaced_modern_names:
            continue
        ft = {
            "type": "Feature",
            "properties": {"iso_a2": "CN", "name": name, "merge_method": "modern_unchanged",
                            "area_km2": round(area_km2(geom), 1)},
            "geometry": mapping(geom),
        }
        out_features.append(ft)
        province_features[name] = ft

    # 2) Группы замены - теперь через county-based spatial join (точные
    # уездные границы вместо грубой обрезки historical shapefile)
    for g in REPLACE_GROUPS:
        modern_mask = unary_union([modern[n] for n in g["modern_names"]])
        pieces = [(n, historical[n]) for n in g["historical_names"] if n in historical]
        missing = [n for n in g["historical_names"] if n not in historical]
        if missing:
            print(f"  ВНИМАНИЕ: не найдены в shapefile {missing} (группа {g['label']})")

        clipped = assign_counties_to_historical(counties, pieces, modern_mask)
        print(f"  {g['label']}: {[(n, round(area_km2(gg))) for n, gg in clipped]}")

        # Порт-Артур/Далянь вырезаем ПОСЛЕ assign (отдельно, по реальной
        # границе уезда Dalianshi - см. ниже после общего цикла)
        for name, geom in clipped:
            ft = {
                "type": "Feature",
                "properties": {"iso_a2": "CN", "name": name, "merge_method": "historical_1946_county_join",
                                "note": "Внутренняя граница построена по совр. уездам (geoBoundaries "
                                         "CHN ADM2), отнесённым к историч. провинции по макс. перекрытию "
                                         "с архивным контуром (Virtual Shanghai 1947-49)",
                                "area_km2": round(area_km2(geom), 1)},
                "geometry": mapping(geom),
            }
            out_features.append(ft)
            province_features[name] = ft

    # 3) Дальний/Порт-Артур - реальная граница уезда Dalianshi, вырезается
    # из Liaoning (которая уже построена через county-join выше)
    dalian_geom = county_by_name.get("Dalianshi")
    if dalian_geom is not None and "Liaoning" in province_features:
        liao_ft = province_features["Liaoning"]
        liao_geom = shp_shape(liao_ft["geometry"])
        dalian_clipped = dalian_geom.intersection(liao_geom)
        if not dalian_clipped.is_valid:
            dalian_clipped = dalian_clipped.buffer(0)
        liao_remainder = liao_geom.difference(dalian_geom.buffer(0.001))
        if not liao_remainder.is_valid:
            liao_remainder = liao_remainder.buffer(0)
        liao_ft["geometry"] = mapping(liao_remainder)
        liao_ft["properties"]["area_km2"] = round(area_km2(liao_remainder), 1)
        out_features.append({
            "type": "Feature",
            "properties": {"iso_a2": "CN", "name": "Dalian (Port Arthur / Kwantung Leased Territory)",
                            "merge_method": "county_boundary",
                            "note": "Реальная граница совр. уезда Dalianshi (geoBoundaries CHN ADM2), "
                                     "area_km2=2399 - меньше историч. арендной территории "
                                     "(~3462 km2 на 1946 год), точных архивных контуров аренды не найдено.",
                            "area_km2": round(area_km2(dalian_clipped), 1)},
            "geometry": mapping(dalian_clipped),
        })
        print(f"  Dalian/Port Arthur: area_km2={round(area_km2(dalian_clipped))}, "
              f"Liaoning остаток={round(area_km2(liao_remainder))}")

    # 4) 5 особых муниципалитетов 1946 года - вырезаем городское ядро из
    # province_features (Nanjing/Shandong/Guangdong/Hubei уже modern_unchanged,
    # Songjiang уже построена через county-join выше)
    for spec in SPECIAL_MUNICIPALITIES_1946:
        host_name = spec["host_province"]
        if host_name not in province_features:
            print(f"  ВНИМАНИЕ: хост-провинция {host_name} не найдена для {spec['city_label']}")
            continue
        city_pieces = [county_by_name[n] for n in spec["adm2_names"] if n in county_by_name]
        if not city_pieces:
            print(f"  ВНИМАНИЕ: уезды {spec['adm2_names']} не найдены для {spec['city_label']}")
            continue
        city_geom = unary_union(city_pieces)

        host_ft = province_features[host_name]
        host_geom = shp_shape(host_ft["geometry"])
        city_clipped = city_geom.intersection(host_geom)
        if not city_clipped.is_valid:
            city_clipped = city_clipped.buffer(0)
        if city_clipped.is_empty or area_km2(city_clipped) < 1:
            print(f"  ВНИМАНИЕ: {spec['city_label']} не пересекается с {host_name}")
            continue
        host_remainder = host_geom.difference(city_geom.buffer(0.001))
        if not host_remainder.is_valid:
            host_remainder = host_remainder.buffer(0)
        host_ft["geometry"] = mapping(host_remainder)
        host_ft["properties"]["area_km2"] = round(area_km2(host_remainder), 1)

        out_features.append({
            "type": "Feature",
            "properties": {"iso_a2": "CN", "name": spec["city_label"], "merge_method": "county_boundary",
                            "note": spec["note"], "area_km2": round(area_km2(city_clipped), 1)},
            "geometry": mapping(city_clipped),
        })
        print(f"  {spec['city_label']}: area_km2={round(area_km2(city_clipped))}, "
              f"{host_name} остаток={round(area_km2(host_remainder))}")

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    total = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"\nРегионов: {len(out_features)}")
    print(f"Суммарная площадь: {total:,.0f} km2")


if __name__ == "__main__":
    main()
