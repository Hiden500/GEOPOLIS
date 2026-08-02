"""
build_islands_index.py — индекс островных регионов для выработки правила слияния.

Зачем. Мелкий остров сейчас занимает отдельный слот региона наравне с провинцией
континента: Кабо-Верде — девять регионов, Наветренные острова — четыре, Гавайи —
четыре. Пользователь хочет сливать острова по паре (архипелаг, владелец), но
правило ещё не выведено. Этот скрипт не сливает ничего — он раскладывает
островные регионы по предполагаемым кластерам, чтобы правило можно было увидеть
на данных и поправить пороги.

Островной регион = регион БЕЗ сухопутных соседей. Источник этого факта —
`neighboringRegionIds` в `server/data/scenarios/1946/regions.core.json`: там
уже учтено, что морские зоны соседями не считаются (`import_to_game.py`
отбрасывает неземных соседей намеренно). Геометрию для этого пересчитывать не
надо — сверка обоих способов дала одинаковые 174 региона.

Кластер = связная компонента островных регионов ОДНОГО владельца, чьи центроиды
отстоят не более чем на `--cluster-deg` градусов. Владелец в ключе нужен, чтобы
слияние не перешагнуло политическую границу: Гуам и японский мандат лежат в
одной Микронезии, но склеиваться не должны. Порог задан флагом намеренно —
он подбирается глазами по результату, а не выводится теоретически.

Запуск:
    python scripts/map/build/build_islands_index.py
    python scripts/map/build/build_islands_index.py --cluster-deg 3.5
    python scripts/map/build/build_islands_index.py --ignore-owner   # что склеилось бы без владельца
    python scripts/map/build/build_islands_index.py --no-seas        # без морских соседей, быстрее

Выход: `out/islands_index.json` плюс сводка в stdout.
"""
import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from paths import OUT_DIR, REPO_ROOT, out

try:
    from shapely.geometry import shape
    from shapely.strtree import STRtree
except ImportError:  # pragma: no cover - зависимость пайплайна, см. scripts/map/AGENTS.md
    print("Нужен shapely: pip install shapely", file=sys.stderr)
    raise

SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
OUT_NAME = "islands_index.json"

# Тот же буфер, что в build_neighbor_graph.py: ловит цифровой микрозазор между
# полигонами из разных источников, но не перепрыгивает открытую воду.
BUFFER_DEG = 0.01
# Касание в одной точке — геометрический угол, а не общая граница.
MIN_TOUCH_LEN = 1e-6
MIN_TOUCH_AREA = 1e-9


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_world():
    """Геометрия мира: приоритет у выхода пайплайна, запасной путь — копия клиента.

    `out/` целиком в .gitignore, поэтому в свежем дереве его может не быть, а
    `client/public/world_1946.geojson` под git и приезжает с веткой.
    """
    primary = Path(out("world_1946.geojson"))
    fallback = REPO_ROOT / "client" / "public" / "world_1946.geojson"
    path = primary if primary.is_file() else fallback
    if not path.is_file():
        raise SystemExit(f"не найдена геометрия мира: ни {primary}, ни {fallback}")
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


def sea_neighbours(island_geoms, ids):
    """Имена морских зон, которых касается каждый островной регион.

    Берём новый слой `out/seas_iho_coastline.geojson` (101 именованная зона).
    Его нет в git и он может отсутствовать — тогда возвращаем пустую разметку и
    честно сообщаем об этом в `_meta`, а не молча выдаём «соседей нет».
    """
    path = Path(out("seas_iho_coastline.geojson"))
    if not path.is_file():
        return {}, None
    seas = load_json(path)["features"]
    names = [f["properties"]["name"] for f in seas]
    buf = [shape(f["geometry"]).buffer(BUFFER_DEG) for f in seas]
    tree = STRtree(buf)
    result = defaultdict(list)
    for rid, g in zip(ids, island_geoms):
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


def cluster(regions, cluster_deg, ignore_owner):
    """Связные компоненты по расстоянию центроидов внутри одного владельца."""
    buckets = defaultdict(list)
    for r in regions:
        buckets["*" if ignore_owner else (r["owner"] or "?")].append(r)

    clusters = []
    for key, group in buckets.items():
        parent = list(range(len(group)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a in range(len(group)):
            for b in range(a + 1, len(group)):
                (ax, ay), (bx, by) = group[a]["centroid"], group[b]["centroid"]
                # долготу сравниваем по кратчайшей дуге: Фиджи по разные стороны
                # даты иначе разъедутся на 359 градусов
                dx = abs(ax - bx)
                dx = min(dx, 360.0 - dx)
                if math.hypot(dx, ay - by) <= cluster_deg:
                    ra, rb = find(a), find(b)
                    if ra != rb:
                        parent[ra] = rb

        members = defaultdict(list)
        for i, r in enumerate(group):
            members[find(i)].append(r)
        for i, (_, rs) in enumerate(sorted(members.items()), start=1):
            rs.sort(key=lambda r: -r["area_km2"])
            clusters.append({
                "cluster_id": f"{key}-{i:02d}",
                "owner": None if ignore_owner else (rs[0]["owner"]),
                # предложение, а не решение: имя самого крупного региона кластера
                "suggested_name": rs[0]["name_en"],
                "region_count": len(rs),
                "area_km2": round(sum(r["area_km2"] for r in rs), 1),
                "population": sum(r["population"] for r in rs),
                "regions": rs,
            })
    clusters.sort(key=lambda c: (-c["region_count"], -c["area_km2"]))
    return clusters


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cluster-deg", type=float, default=2.0,
                    help="порог расстояния центроидов в градусах (по умолчанию 2.0, ~200 км по экватору)")
    ap.add_argument("--ignore-owner", action="store_true",
                    help="кластеризовать без учёта владельца — показать, что склеилось бы через границу")
    ap.add_argument("--no-seas", action="store_true", help="не размечать морских соседей")
    args = ap.parse_args()

    world_path, feats = load_world()
    core = load_json(SCENARIO / "regions.core.json")
    state = {r["id"]: r for r in load_json(SCENARIO / "regions.state.json")}
    names_en = load_json(SCENARIO / "names.en.json")
    names_ru = load_json(SCENARIO / "names.ru.json")

    geom_by_id = {f["properties"]["region_id"]: f for f in feats if is_land(f["properties"])}
    land_total = len(geom_by_id)

    # островной регион = нет НИ ОДНОГО сухопутного соседа
    island_core = [r for r in core if not r.get("neighboringRegionIds")]
    missing_geom = [r["geoJsonId"] for r in island_core if r["geoJsonId"] not in geom_by_id]

    regions, geoms, ids = [], [], []
    for r in island_core:
        gid = r["geoJsonId"]
        ft = geom_by_id.get(gid)
        if ft is None:
            continue
        st = state.get(r["id"], {})
        g = shape(ft["geometry"])
        cent, on_dateline = centroid_of(g, ft["geometry"])
        regions.append({
            "index": r["id"],
            "region_id": gid,
            "name_en": names_en.get(gid, ft["properties"].get("name", gid)),
            "name_ru": names_ru.get(gid, ""),
            "owner": st.get("ownerCountryId"),
            "area_km2": round(r.get("area", 0), 1),
            "population": st.get("population", 0),
            "polygons": polygon_count(ft["geometry"]),
            "centroid": cent,
            "crosses_dateline": on_dateline,
            "sea_neighbors": [],
        })
        geoms.append(g)
        ids.append(gid)

    seas_map, seas_src = ({}, None) if args.no_seas else sea_neighbours(geoms, ids)
    for r in regions:
        r["sea_neighbors"] = seas_map.get(r["region_id"], [])
    without_sea = [r["region_id"] for r in regions if seas_src and not r["sea_neighbors"]]

    clusters = cluster(regions, args.cluster_deg, args.ignore_owner)
    multi = [c for c in clusters if c["region_count"] > 1]

    doc = {
        "_meta": {
            "generated_by": "scripts/map/build/build_islands_index.py",
            "purpose": "выработать правило слияния островных регионов; НИЧЕГО не сливает",
            "island_definition": "регион с пустым neighboringRegionIds в regions.core.json",
            "cluster_rule": ("связная компонента по расстоянию центроидов <= "
                             f"{args.cluster_deg}° " + ("БЕЗ учёта владельца" if args.ignore_owner
                                                        else "внутри одного владельца")),
            "sources": {
                "geometry": str(world_path.relative_to(REPO_ROOT)),
                "scenario": str(SCENARIO.relative_to(REPO_ROOT)),
                "seas": seas_src and str(Path(seas_src).relative_to(REPO_ROOT)),
            },
            "counts": {
                "land_regions_in_geometry": land_total,
                "scenario_regions": len(core),
                "island_regions": len(regions),
                "clusters": len(clusters),
                "clusters_with_more_than_one_region": len(multi),
                "regions_saved_by_merge": len(regions) - len(clusters),
            },
            "warnings": {
                # «слоя нет» и «соседей нет» обязаны различаться, иначе
                # непроверенное читается как чистое
                "sea_layer_missing": seas_src is None,
                "island_regions_without_sea_neighbor": without_sea,
                "island_regions_without_geometry": missing_geom,
            },
        },
        "clusters": clusters,
    }

    path = out(OUT_NAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    print(f"геометрия: {world_path.relative_to(REPO_ROOT)}  (суша {land_total})")
    print(f"морской слой: {seas_src or 'НЕ НАЙДЕН — морские соседи не размечены'}")
    print(f"островных регионов: {len(regions)}")
    print(f"кластеров при пороге {args.cluster_deg}°"
          f"{' без владельца' if args.ignore_owner else ' внутри владельца'}: {len(clusters)}"
          f"  (слияние убрало бы {len(regions) - len(clusters)} регионов)")
    if without_sea:
        print(f"ВНИМАНИЕ: островных регионов без морского соседа: {len(without_sea)} -> {without_sea[:10]}")
    if missing_geom:
        print(f"ВНИМАНИЕ: без геометрии: {missing_geom}")
    print(f"\nкластеры больше одного региона ({len(multi)}):")
    for c in multi:
        nm = ", ".join(r["name_en"] for r in c["regions"][:6])
        tail = " …" if c["region_count"] > 6 else ""
        print(f"  {c['cluster_id']:>10}  {c['region_count']:2} рег  {c['area_km2']:>10,.0f} км²"
              f"  {c['population']:>10,} чел  {nm}{tail}")
    print(f"\nзаписано: {Path(path).relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
