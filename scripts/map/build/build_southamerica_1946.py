"""
build_southamerica_1946.py
Южная Америка 1946: Бразилия (build_brazil_1946.py) с историческими
правками + остальные 11 стран геометрически укрупнены (компактность,
не просто площадь) + потеряшки (Французская Гвиана из FR, Фолкленды/
Южная Георгия - свои iso_a2).
"""
from paths import game_map, out
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
GAME_MAP = game_map()
BRAZIL_SRC = out("brazil_1946.geojson")
OUT = out("southamerica_1946.geojson")

# целевое число регионов (площадь + значимость, мягкая детализация)
TARGETS = {
    "AR": 7, "CO": 7, "PE": 7, "VE": 6, "CL": 6,
    "BO": 4, "EC": 4,
    "GY": 2, "SR": 2,
    "PY": 1, "UY": 1,
}
SINGLE_AS_IS = ["FK", "GS"]


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
                   "names": [main_name] + names, "geom": merged_geom,
                   "area": clusters[i]["area"] + clusters[j]["area"]}
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]
    return clusters


def main():
    with open(GAME_MAP, encoding="utf-8") as f:
        gm = json.load(f)

    out_features = []

    # Бразилия - готовый результат
    with open(BRAZIL_SRC, encoding="utf-8") as f:
        br_fc = json.load(f)
    out_features.extend(br_fc["features"])

    # Французская Гвиана - потеряшка из FR
    for f in gm["features"]:
        p = f["properties"]
        if p.get("iso_a2") == "FR" and p.get("region") == "Guyane française":
            g = shape(f["geometry"])
            out_features.append({
                "type": "Feature",
                "properties": {"iso_a2": "GF", "name": "Guyane française",
                                "area_km2": round(area_km2(g), 1), "merge_method": "extracted_from_europe"},
                "geometry": mapping(g),
            })

    # Фолкленды / Южная Георгия - без изменений
    for f in gm["features"]:
        p = f["properties"]
        if p.get("iso_a2") in SINGLE_AS_IS:
            g = shape(f["geometry"])
            out_features.append({
                "type": "Feature",
                "properties": {"iso_a2": p["iso_a2"], "name": p.get("name"),
                                "area_km2": round(area_km2(g), 1), "merge_method": "keep"},
                "geometry": mapping(g),
            })

    # остальные 11 стран - геометрическое укрупнение с компактностью
    by_country = {}
    for f in gm["features"]:
        p = f["properties"]
        iso2 = p.get("iso_a2")
        if iso2 in TARGETS:
            g = shape(f["geometry"])
            by_country.setdefault(iso2, []).append({
                "codes": [p.get("adm1_code")], "names": [p.get("name")],
                "geom": g, "area": area_km2(g),
            })

    for iso2, target in TARGETS.items():
        clusters = reduce_clusters(by_country.get(iso2, []), target)
        for cl in clusters:
            label = cl["names"][0]
            out_features.append({
                "type": "Feature",
                "properties": {"iso_a2": iso2, "name": label,
                                "source_adm1": cl["codes"], "source_count": len(cl["codes"]),
                                "area_km2": round(cl["area"], 1), "merge_method": "geometric"},
                "geometry": mapping(cl["geom"]),
            })
        print(f"{iso2}: {len(by_country.get(iso2, []))} -> {len(clusters)}")

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    print(f"\nРегионов: {len(out_features)}")
    total = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"Суммарная площадь: {total:,.0f} km2")


if __name__ == "__main__":
    main()

