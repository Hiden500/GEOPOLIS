"""
build_islands_index.py — индекс островов для выработки правила слияния регионов.

Зачем. Мелкий остров сейчас занимает отдельный слот региона наравне с провинцией
континента: Кабо-Верде — девять регионов, Наветренные острова — четыре, Гавайи —
четыре. Пользователь хочет сливать по паре (архипелаг, владелец), но правило ещё
не выведено. Скрипт НИЧЕГО НЕ СЛИВАЕТ — он раскладывает острова по
предполагаемым группам, чтобы правило можно было увидеть на данных, покрутить
пороги флагами и отрендерить.

ОПРЕДЕЛЕНИЕ. Остров = связная компонента графа суши, а не «регион без соседей».
Первая версия скрипта считала островом одинокий регион и из-за этого теряла
острова, разбитые внутри: Гуадалканал не попадал в список, потому что делит
сушу с Хониарой. Компоненты отделяют материки от островов самими данными:
размеры идут 851 (Афроевразия), 266 (Америки), затем сразу 24 (Гаити с
Доминиканой) — порог ставится в разрыв, а не на глаз.

ЕДИНИЦА СЛИЯНИЯ — пара (остров, владелец), а не остров целиком. Гаити и
Доминикана делят одну сушу, но склеиваться не должны; Новая Гвинея так же
разделена между голландской и австралийской частями.

АРХИПЕЛАГ приближается кластером: единицы слияния одного владельца, чьи
центроиды отстоят не более чем на `--cluster-deg`. Порог вынесен во флаг
намеренно — он подбирается по результату, а не выводится теоретически.

Запуск:
    python scripts/map/build/build_islands_index.py
    python scripts/map/build/build_islands_index.py --cluster-deg 3.5
    python scripts/map/build/build_islands_index.py --ignore-owner   # цена ключа «владелец»
    python scripts/map/build/build_islands_index.py --no-seas        # быстрее, без морских соседей

Выход:
    out/islands_index.json     — группы, кластеры, счётчики, предупреждения
    out/islands_index.geojson  — те же регионы с геометрией, для рендера
"""
import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from paths import REPO_ROOT, out, world_geojson

try:
    from shapely.geometry import shape
    from shapely.strtree import STRtree
except ImportError:  # pragma: no cover - зависимость пайплайна, см. scripts/map/AGENTS.md
    print("Нужен shapely: pip install shapely", file=sys.stderr)
    raise

SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
OUT_JSON = "islands_index.json"
OUT_GEOJSON = "islands_index.geojson"

# Компонента крупнее этого — материк, а не остров. Значение стоит в разрыве
# распределения (266 -> 24), поэтому любое число из (24, 266] даёт тот же ответ.
CONTINENT_MIN_REGIONS = 50

# Тот же буфер, что в build_neighbor_graph.py: ловит цифровой микрозазор, но не
# перепрыгивает открытую воду.
BUFFER_DEG = 0.01
MIN_TOUCH_LEN = 1e-6
MIN_TOUCH_AREA = 1e-9


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_world():
    """Геометрия мира: мастер первым, копия клиента — последним (см. paths.py).

    Раньше первым читался `out/world_1946.geojson`, которого в дереве нет и
    взяться неоткуда, а фактически работала запасная ветка на
    `client/public/world_1946.geojson`. Совпадение копии клиента с мастером —
    свойство последнего прогона `import_to_game.py`, а не устройство: стоит
    прогнать импорт на другой геометрии, и индекс молча считался бы по чужой
    карте. Запасной путь на копию клиента сохранён для дерева, где мастера нет.
    """
    path = world_geojson()
    return path, load_json(path)["features"]


def is_land(props):
    """Суша, а не море и не озеро. У выхода пайплайна и у копии клиента поля разные."""
    if "region_type" in props:
        return props["region_type"] == "land"
    return props.get("type") == "region" and not str(props.get("region_id", "")).startswith(("SEA-", "LAK-"))


def polygon_count(geom):
    return len(geom["coordinates"]) if geom["type"] == "MultiPolygon" else 1


def lon_span(geom):
    lons = []

    def walk(c):
        if isinstance(c[0], (int, float)):
            lons.append(c[0])
        else:
            for x in c:
                walk(x)

    walk(geom["coordinates"])
    return min(lons), max(lons)


def centroid_of(geom_obj, geom_raw):
    """Центроид с поправкой на антимеридиан.

    У фигуры, раскинутой от -180 до 180, обычный центроид уезжает к нулевой
    долготе — подпись оказывается в другом полушарии. Такие случаи считаем на
    копии, сдвинутой в непрерывные координаты, и возвращаем долготу обратно.
    """
    lo, hi = lon_span(geom_raw)
    if lo < -179.9 and hi > 179.9:
        from shapely.affinity import translate
        from shapely.ops import unary_union

        parts = list(getattr(geom_obj, "geoms", [geom_obj]))
        shifted = [translate(p, xoff=360.0) if p.centroid.x < 0 else p for p in parts]
        c = unary_union(shifted).centroid
        lon = c.x - 360.0 if c.x > 180.0 else c.x
        return [round(lon, 4), round(c.y, 4)], True
    c = geom_obj.centroid
    return [round(c.x, 4), round(c.y, 4)], False


def land_components(core):
    """Связные компоненты графа суши по landNeighboringRegionIds сценария.

    Морские зоны соседями там не считаются (`import_to_game.py` отбрасывает
    неземных соседей намеренно), поэтому компонента — это ровно массив суши.
    """
    adj = defaultdict(set)
    for r in core:
        for n in r["landNeighboringRegionIds"]:
            adj[r["id"]].add(n)
            adj[n].add(r["id"])
    seen, comps = set(), []
    for r in core:
        if r["id"] in seen:
            continue
        stack, comp = [r["id"]], []
        seen.add(r["id"])
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        comps.append(comp)
    comps.sort(key=len, reverse=True)
    return comps


def sea_neighbours(geoms, ids):
    """Имена морских зон, которых касается каждый регион.

    Берём новый слой `out/seas_iho_coastline.geojson` (101 именованная зона). Его
    нет в git и он может отсутствовать — тогда возвращаем пустую разметку и
    сообщаем об этом в `_meta`, а не молча выдаём «соседей нет»: «слоя нет» и
    «соседей нет» обязаны различаться.
    """
    path = Path(out("seas_iho_coastline.geojson"))
    if not path.is_file():
        return {}, None
    seas = load_json(path)["features"]
    names = [f["properties"]["name"] for f in seas]
    buf = [shape(f["geometry"]).buffer(BUFFER_DEG) for f in seas]
    tree = STRtree(buf)
    result = defaultdict(list)
    for rid, g in zip(ids, geoms):
        gb = g.buffer(BUFFER_DEG)
        for i in tree.query(gb):
            i = int(i)
            if not gb.intersects(buf[i]):
                continue
            inter = gb.intersection(buf[i])
            if inter.length < MIN_TOUCH_LEN and inter.area < MIN_TOUCH_AREA:
                continue
            result[rid].append(names[i])
    return {k: sorted(set(v)) for k, v in result.items()}, str(path)


def cluster_groups(groups, cluster_deg, ignore_owner):
    """Связные компоненты единиц слияния по расстоянию центроидов внутри владельца."""
    buckets = defaultdict(list)
    for g in groups:
        buckets["*" if ignore_owner else (g["owner"] or "?")].append(g)

    clusters = []
    for key, bucket in buckets.items():
        parent = list(range(len(bucket)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a in range(len(bucket)):
            for b in range(a + 1, len(bucket)):
                (ax, ay), (bx, by) = bucket[a]["centroid"], bucket[b]["centroid"]
                # долготу сравниваем по кратчайшей дуге: единицы по разные
                # стороны даты иначе разъедутся на 359 градусов
                dx = abs(ax - bx)
                dx = min(dx, 360.0 - dx)
                if math.hypot(dx, ay - by) <= cluster_deg:
                    ra, rb = find(a), find(b)
                    if ra != rb:
                        parent[ra] = rb

        members = defaultdict(list)
        for i, g in enumerate(bucket):
            members[find(i)].append(g)
        for i, (_, gs) in enumerate(sorted(members.items()), start=1):
            gs.sort(key=lambda g: -g["area_km2"])
            clusters.append({
                "cluster_id": f"{key}-{i:02d}",
                "owner": None if ignore_owner else gs[0]["owner"],
                # предложение, а не решение: имя крупнейшей единицы кластера
                "suggested_name": gs[0]["name"],
                "group_count": len(gs),
                "region_count": sum(g["region_count"] for g in gs),
                "area_km2": round(sum(g["area_km2"] for g in gs), 1),
                "population": sum(g["population"] for g in gs),
                "groups": gs,
            })
    clusters.sort(key=lambda c: (-c["region_count"], -c["area_km2"]))
    return clusters


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cluster-deg", type=float, default=2.0,
                    help="порог расстояния центроидов в градусах (по умолчанию 2.0, ~200 км по экватору)")
    ap.add_argument("--ignore-owner", action="store_true",
                    help="кластеризовать без учёта владельца — показать, что склеилось бы через границу")
    ap.add_argument("--continent-min-regions", type=int, default=CONTINENT_MIN_REGIONS,
                    help=f"компонента крупнее — материк (по умолчанию {CONTINENT_MIN_REGIONS})")
    ap.add_argument("--no-seas", action="store_true", help="не размечать морских соседей")
    args = ap.parse_args()

    world_path, feats = load_world()
    core = load_json(SCENARIO / "regions.core.json")
    state = {r["id"]: r for r in load_json(SCENARIO / "regions.state.json")}
    names_en = load_json(SCENARIO / "names.en.json")
    names_ru = load_json(SCENARIO / "names.ru.json")

    geom_by_id = {f["properties"]["region_id"]: f for f in feats if is_land(f["properties"])}
    by_num = {r["id"]: r for r in core}

    comps = land_components(core)
    continents = [c for c in comps if len(c) > args.continent_min_regions]
    islands = [c for c in comps if len(c) <= args.continent_min_regions]

    # единица слияния = (остров, владелец): Гаити и Доминикана делят сушу,
    # но склеиваться не должны
    regions_out, geoms, ids = [], [], []
    groups = []
    missing_geom = []
    for isl_no, comp in enumerate(sorted(islands, key=lambda c: -sum(by_num[i]["area"] for i in c)), start=1):
        island_id = f"ISL-{isl_no:03d}"
        island_area = round(sum(by_num[i]["area"] for i in comp), 1)
        island_pop = sum(state.get(i, {}).get("population", 0) for i in comp)
        by_owner = defaultdict(list)
        for i in comp:
            by_owner[state.get(i, {}).get("ownerCountryId")].append(i)

        for owner, member_ids in by_owner.items():
            members = []
            for i in sorted(member_ids, key=lambda x: -by_num[x]["area"]):
                r = by_num[i]
                gid = r["geoJsonId"]
                ft = geom_by_id.get(gid)
                if ft is None:
                    missing_geom.append(gid)
                    continue
                g = shape(ft["geometry"])
                cent, on_dateline = centroid_of(g, ft["geometry"])
                rec = {
                    "index": i,
                    "region_id": gid,
                    "name_en": names_en.get(gid, ft["properties"].get("name", gid)),
                    "name_ru": names_ru.get(gid, ""),
                    "owner": owner,
                    "area_km2": round(r.get("area", 0), 1),
                    "population": state.get(i, {}).get("population", 0),
                    "polygons": polygon_count(ft["geometry"]),
                    "centroid": cent,
                    "crosses_dateline": on_dateline,
                    "island_id": island_id,
                    "island_regions": len(comp),
                    "island_area_km2": island_area,
                    "island_population": island_pop,
                    "island_owners": len(by_owner),
                    "sea_neighbors": [],
                }
                members.append(rec)
                regions_out.append(rec)
                geoms.append(g)
                ids.append(gid)
            if not members:
                continue
            cx = sum(m["centroid"][0] * m["area_km2"] for m in members)
            cy = sum(m["centroid"][1] * m["area_km2"] for m in members)
            tot = sum(m["area_km2"] for m in members) or 1.0
            groups.append({
                "group_id": f"{island_id}/{owner}",
                "island_id": island_id,
                "owner": owner,
                "name": members[0]["name_en"],
                "region_count": len(members),
                "area_km2": round(sum(m["area_km2"] for m in members), 1),
                "population": sum(m["population"] for m in members),
                "centroid": [round(cx / tot, 4), round(cy / tot, 4)],
                "region_indices": [m["index"] for m in members],
            })

    seas_map, seas_src = ({}, None) if args.no_seas else sea_neighbours(geoms, ids)
    for r in regions_out:
        r["sea_neighbors"] = seas_map.get(r["region_id"], [])
    # Настоящий инвариант: регион, ОДИНОКО сидящий на своём острове, обязан
    # касаться воды — иначе он выпадает из морского графа. Внутренний регион
    # разбитого острова (Большой Лондон, нагорья Новой Гвинеи, центр Доминиканы)
    # моря не касается штатно, и предупреждать о нём значит приучать
    # игнорировать предупреждения.
    solo_without_sea = [r["region_id"] for r in regions_out
                        if seas_src and not r["sea_neighbors"] and r["island_regions"] == 1]
    inland_of_split = sum(1 for r in regions_out
                          if seas_src and not r["sea_neighbors"] and r["island_regions"] > 1)

    clusters = cluster_groups(groups, args.cluster_deg, args.ignore_owner)
    group_of_region = {}
    cluster_of_region = {}
    for c in clusters:
        for g in c["groups"]:
            for i in g["region_indices"]:
                group_of_region[i] = g
                cluster_of_region[i] = c

    meta = {
        "generated_by": "scripts/map/build/build_islands_index.py",
        "purpose": "выработать правило слияния островных регионов; НИЧЕГО не сливает",
        "island_definition": ("связная компонента графа суши размером <= "
                              f"{args.continent_min_regions} регионов; крупнее — материк"),
        "merge_unit": "пара (остров, владелец) — Гаити и Доминикана не склеиваются",
        "cluster_rule": ("связная компонента единиц слияния по расстоянию центроидов <= "
                         f"{args.cluster_deg}° " + ("БЕЗ учёта владельца" if args.ignore_owner
                                                    else "внутри одного владельца")),
        "sources": {
            "geometry": str(world_path.relative_to(REPO_ROOT)),
            "scenario": str(SCENARIO.relative_to(REPO_ROOT)),
            "seas": seas_src and str(Path(seas_src).relative_to(REPO_ROOT)),
        },
        "counts": {
            "scenario_regions": len(core),
            "land_components": len(comps),
            "continents": len(continents),
            "continent_regions": sum(len(c) for c in continents),
            "islands": len(islands),
            "island_regions": len(regions_out),
            "merge_groups": len(groups),
            "clusters": len(clusters),
            "regions_saved_merging_within_group": len(regions_out) - len(groups),
            "regions_saved_merging_to_cluster": len(regions_out) - len(clusters),
        },
        "warnings": {
            "sea_layer_missing": seas_src is None,
            "solo_island_regions_without_sea_neighbor": solo_without_sea,
            "inland_regions_of_split_islands": inland_of_split,
            "island_regions_without_geometry": missing_geom,
        },
    }

    with open(out(OUT_JSON), "w", encoding="utf-8") as f:
        json.dump({"_meta": meta, "clusters": clusters}, f, ensure_ascii=False, indent=1)

    # geojson: те же регионы с геометрией; свойства плоские, чтобы красить
    # рендером по island_id / cluster_id / island_regions
    gj = {"type": "FeatureCollection", "_meta": meta, "features": []}
    for rec, ft in zip(regions_out, (geom_by_id[r["region_id"]] for r in regions_out)):
        g = group_of_region.get(rec["index"], {})
        c = cluster_of_region.get(rec["index"], {})
        props = {k: v for k, v in rec.items() if k != "sea_neighbors"}
        props["sea_neighbors"] = ", ".join(rec["sea_neighbors"])
        props["group_id"] = g.get("group_id")
        props["group_regions"] = g.get("region_count")
        props["cluster_id"] = c.get("cluster_id")
        props["cluster_regions"] = c.get("region_count")
        props["cluster_name"] = c.get("suggested_name")
        gj["features"].append({"type": "Feature", "properties": props, "geometry": ft["geometry"]})
    with open(out(OUT_GEOJSON), "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)

    c = meta["counts"]
    print(f"геометрия: {world_path.relative_to(REPO_ROOT)}")
    print(f"морской слой: {seas_src or 'НЕ НАЙДЕН — морские соседи не размечены'}")
    print(f"компонент суши {c['land_components']}: материков {c['continents']} "
          f"({c['continent_regions']} регионов), островов {c['islands']} ({c['island_regions']} регионов)")
    print(f"единиц слияния (остров+владелец): {c['merge_groups']}"
          f"  -> экономия {c['regions_saved_merging_within_group']} регионов")
    print(f"кластеров при пороге {args.cluster_deg}°"
          f"{' без владельца' if args.ignore_owner else ''}: {c['clusters']}"
          f"  -> экономия {c['regions_saved_merging_to_cluster']} регионов")
    if solo_without_sea:
        print(f"ВНИМАНИЕ: одиноких на острове регионов БЕЗ морского соседа: "
              f"{len(solo_without_sea)} -> {solo_without_sea[:10]}")
    print(f"внутренних регионов разбитых островов без выхода к морю: {inland_of_split} (штатно)")
    if missing_geom:
        print(f"ВНИМАНИЕ: без геометрии: {missing_geom}")

    print(f"\nострова, разбитые на несколько регионов (топ-15):")
    multi = sorted((g for g in groups if g["region_count"] > 1), key=lambda g: -g["region_count"])
    for g in multi[:15]:
        print(f"  {g['group_id']:>14}  {g['region_count']:2} рег  {g['area_km2']:>10,.0f} км²"
              f"  {g['population']:>11,} чел  {g['name']}")

    print(f"\nкластеры из нескольких островов (топ-15):")
    for cl in [x for x in clusters if x["group_count"] > 1][:15]:
        nm = ", ".join(g["name"] for g in cl["groups"][:5])
        tail = " …" if cl["group_count"] > 5 else ""
        print(f"  {cl['cluster_id']:>10}  {cl['group_count']:2} остр / {cl['region_count']:2} рег"
              f"  {cl['population']:>10,} чел  {nm}{tail}")

    print(f"\nзаписано: out/{OUT_JSON}, out/{OUT_GEOJSON}")


if __name__ == "__main__":
    main()
