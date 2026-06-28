"""
build_us_states_split_1946.py
Разбивает 51 "штат" (US, namerica_1946.geojson) на county-кластеры
(geoBoundaries ADM2) по смешанному принципу: площадь + ручная поправка
под известные промышленные/политические центры 1946 года (NY/PA/OH/IL/
CA/TX/MI). Мягкая детализация: 1-2 для малых штатов, 3-4 для крупных.
"""
from paths import out, source
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
COUNTIES_SRC = source("geoBoundaries-USA-ADM2.geojson")
NA_SRC = out("namerica_1946.geojson")
OUT = out("namerica_1946.geojson")

# Целевое число суб-регионов на штат (площадь + ручная поправка под
# промышленных/политических гигантов 1946 года)
TARGETS = {
    "New York": 4, "Pennsylvania": 4, "Ohio": 4, "Illinois": 4,
    "California": 4, "Texas": 4, "Michigan": 4,
    "Florida": 3, "New Jersey": 3, "Massachusetts": 3, "Georgia": 3,
    "North Carolina": 3, "Virginia": 3, "Washington": 3, "Minnesota": 3,
    "Wisconsin": 3, "Missouri": 3,
    "Indiana": 2, "Tennessee": 2, "Alabama": 2, "Louisiana": 2,
    "Kentucky": 2, "South Carolina": 2, "Oklahoma": 2, "Iowa": 2,
    "Kansas": 2, "Colorado": 2, "Arizona": 2, "Oregon": 2,
    "Arkansas": 2, "Mississippi": 2, "Connecticut": 2,
    # всё остальное (включая Alaska/Hawaii/DC) -> 1, не указано явно
}


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def adjacency(clusters, buffer_deg=0.0005):
    n = len(clusters)
    adj = {i: set() for i in range(n)}
    buffered = [c["geom"].buffer(buffer_deg) for c in clusters]
    for i in range(n):
        for j in range(i + 1, n):
            if buffered[i].intersects(buffered[j]):
                adj[i].add(j)
                adj[j].add(i)
    return adj


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
        best_j, best_score = None, -1.0
        for j in adj[i]:
            trial = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
            score = compactness(trial)
            if score > best_score:
                best_j, best_score = j, score
        j = best_j
        merged_geom = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
        names = clusters[i]["names"] + clusters[j]["names"]
        areas = [clusters[i]["area"]] * len(clusters[i]["names"]) + [clusters[j]["area"]] * len(clusters[j]["names"])
        main_name = max(zip(names, areas), key=lambda x: x[1])[0]
        merged = {"codes": clusters[i]["codes"] + clusters[j]["codes"],
                   "names": [main_name] + names,
                   "geom": merged_geom,
                   "area": clusters[i]["area"] + clusters[j]["area"]}
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]
    return clusters


def main():
    with open(COUNTIES_SRC) as f:
        counties_fc = json.load(f)
    with open(NA_SRC) as f:
        na_fc = json.load(f)

    us_states = [ft for ft in na_fc["features"] if ft["properties"]["iso_a2"] == "US"]
    other_features = [ft for ft in na_fc["features"] if ft["properties"]["iso_a2"] != "US"]

    state_geoms = [shape(ft["geometry"]) for ft in us_states]
    state_names = [ft["properties"]["name"] for ft in us_states]
    tree = STRtree(state_geoms)

    assigned = {}
    for f in counties_fc["features"]:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        pt = g.representative_point()
        idxs = tree.query(pt)
        found = None
        for idx in idxs:
            if state_geoms[idx].contains(pt):
                found = idx
                break
        if found is None:
            idxs2 = tree.query(g)
            if len(idxs2):
                best = min(idxs2, key=lambda i: state_geoms[i].distance(g))
                if state_geoms[best].distance(g) < 0.5:
                    found = best
        if found is None:
            continue
        sname = state_names[found]
        assigned.setdefault(sname, []).append({
            "name": f["properties"]["shapeName"],
            "code": f["properties"]["shapeID"],
            "geom": g,
            "area": area_km2(g),
        })

    new_us_features = []
    report = []
    for ft in us_states:
        sname = ft["properties"]["name"]
        counties = assigned.get(sname)
        target = TARGETS.get(sname, 1)

        if not counties:
            # нет привязанных округов (не должно случиться для штатов) - keep as is
            new_us_features.append(ft)
            report.append((sname, 0, 1, "no_counties_fallback"))
            continue

        clusters = [{"codes": [c["code"]], "names": [c["name"]], "geom": c["geom"], "area": c["area"]}
                    for c in counties]
        clusters = reduce_clusters(clusters, target)

        for cl in clusters:
            label = cl["names"][0] if len(cl["names"]) == 1 else f"{sname}: {cl['names'][0]} area"
            new_us_features.append({
                "type": "Feature",
                "properties": {
                    "iso_a2": "US", "name": f"{sname} — {cl['names'][0]}" if len(clusters) > 1 else sname,
                    "state": sname,
                    "source_adm1": cl["codes"], "source_count": len(cl["codes"]),
                    "area_km2": round(cl["area"], 1), "merge_method": "county_cluster",
                },
                "geometry": mapping(cl["geom"]),
            })
        report.append((sname, len(counties), len(clusters), "split"))

    fc = {"type": "FeatureCollection", "features": other_features + new_us_features}

    # geoBoundaries (округа) - другой источник, чем Natural Earth (Канада/
    # Мексика в текущем файле) - граница не идеально совпадает. Обрезаем
    # США по уже выставленным соседям (та же логика, что для Китая в Азии).
    neighbor_geoms = [shape(ft["geometry"]) for ft in other_features
                       if ft["properties"]["iso_a2"] in ("CA", "MX")]
    neighbors_union = unary_union(neighbor_geoms)
    for ft in fc["features"]:
        if ft["properties"]["iso_a2"] != "US":
            continue
        g = shape(ft["geometry"])
        if g.intersects(neighbors_union):
            clipped = g.difference(neighbors_union)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    total_us = len(new_us_features)
    print(f"Итого US регионов: {total_us} (было 51)")
    print(f"Всего регионов в файле: {len(fc['features'])}")
    print()
    for sname, n_counties, n_out, method in sorted(report, key=lambda r: -r[1]):
        print(f"{sname:20} counties={n_counties:4} -> {n_out}")


if __name__ == "__main__":
    main()
