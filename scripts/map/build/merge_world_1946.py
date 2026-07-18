"""
merge_world_1946.py
Объединяет все 9 слоёв (6 континентов + Антарктида + моря + озёра) в один
world_1946.geojson, присваивая каждой фиче стабильный region_id и явные
continent/region_type. Это "статичный" слой геометрии - владелец, русские
названия, граф соседей будут отдельными файлами, ссылающимися на region_id.
"""
from paths import out
import json
import sys
from shapely.geometry import shape
from shapely.strtree import STRtree

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SOURCES = [
    ("EUR", "Europe", "land", out("europe_1946.geojson")),
    ("ASI", "Asia", "land", out("asia_1946.geojson")),
    ("NAM", "North America", "land", out("namerica_1946.geojson")),
    ("SAM", "South America", "land", out("southamerica_1946.geojson")),
    ("AFR", "Africa", "land", out("africa_1946.geojson")),
    ("OCE", "Oceania", "land", out("oceania_1946.geojson")),
    ("ANT", "Antarctica", "land", out("antarctica_1946.geojson")),
    ("SEA", None, "sea", out("seas_1946.geojson")),
    ("LAK", None, "lake", out("lakes_1946.geojson")),
]
OUT = out("world_1946.geojson")


def main():
    out_features = []
    report = []
    for prefix, continent, region_type, path in SOURCES:
        with open(path, encoding="utf-8") as f:
            fc = json.load(f)
        feats = fc["features"]
        for i, ft in enumerate(feats, start=1):
            region_id = f"{prefix}-{i:04d}"
            props = dict(ft["properties"])
            props["region_id"] = region_id
            props.setdefault("region_type", region_type)
            if continent is not None:
                props["continent"] = continent
            # порядок полей: id/continent/type вперёд, остальное как было
            ordered = {"region_id": region_id, "continent": props.pop("continent", None),
                       "region_type": props.pop("region_type", region_type)}
            ordered.update(props)
            out_features.append({"type": "Feature", "properties": ordered, "geometry": ft["geometry"]})
        report.append((prefix, continent or region_type, len(feats)))

    fc_out = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc_out, f, ensure_ascii=False)

    print(f"Всего фич: {len(out_features)}")
    for prefix, label, n in report:
        print(f"  {prefix:5} {label:20} {n:5}")

    # финальная валидация: типы геометрии, валидность, пересечения (через STRtree)
    geoms = [shape(ft["geometry"]) for ft in out_features]
    invalid = sum(1 for g in geoms if not g.is_valid)
    print(f"\nНевалидных геометрий: {invalid}")

    tree = STRtree(geoms)
    seen = set()
    overlaps = []
    for i, g in enumerate(geoms):
        idxs = tree.query(g)
        for j in idxs:
            j = int(j)
            if j <= i:
                continue
            key = (i, j)
            if key in seen:
                continue
            seen.add(key)
            inter = g.intersection(geoms[j])
            if inter.area > 0.0003:
                overlaps.append((out_features[i]["properties"]["region_id"],
                                  out_features[i]["properties"]["name"],
                                  out_features[j]["properties"]["region_id"],
                                  out_features[j]["properties"]["name"],
                                  round(inter.area, 5)))
    print(f"Пересечений (>0.0003 deg2): {len(overlaps)}")
    for o in overlaps[:20]:
        print("  ", o)

    all_codes = []
    for ft in out_features:
        all_codes.extend(ft["properties"].get("source_adm1") or [])
    print(f"\nsource_adm1 всего: {len(all_codes)}  уникальных: {len(set(all_codes))}")

    total_area = sum(ft["properties"].get("area_km2", 0) for ft in out_features)
    print(f"Суммарная площадь: {total_area:,.0f} km2")


if __name__ == "__main__":
    main()
