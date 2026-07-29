"""
fix_disconnected_region_field_pieces.py — one-off gap fix (2026-07-29).

build_asia_1946.py's group_by_region() (used for AZ/JP/PH's REGION_FIELD
countries) used to unary_union ALL raw adm1 features sharing the same
modern "region" field value into one cluster, regardless of whether they
physically touch. Found 2026-07-29 (user, Philippines): "Northern Mindanao
(Region X)" included Misamis Occidental - a real, administratively
correct Region X province - but it physically TOUCHES Zamboanga
Peninsula (Region IX)'s mainland and sits ~3 km from Region X's own main
body. Not a data error (Misamis Occidental genuinely is Region X per
real-world admin geography) - just a modern (anachronistic for 1946
anyway) administrative quirk that reads as "island glued to the wrong
mainland" + "region visibly split" on a game map. Same class as Japan's
Kanto (Region field) already showing 17.3 deg spread in diagnose_
scattered_regions.py - Ogasawara/Izu Islands are administratively Tokyo/
Kanto but 1000+ km away.

group_by_region() itself has ALREADY been fixed for future full rebuilds
(DISCONNECTED_SPLIT_AREA_KM2 threshold - real-sized disconnected pieces
split into their own region, small islands stay merged as before). This
script applies the SAME logic directly to the already-built out/
asia_1946.geojson, since build_asia_1946.py cannot be re-run in this
worktree (missing external source scripts/map/sources/palestine_hist/
geoBoundaries-ISR-ADM2.geojson, gitignored/not present - same class of
environment limitation as build_china_1946_v2.py needing the Virtual
Shanghai shapefile, see docs/DECISIONS.md).

Method: for each REGION_FIELD-clustered feature (PH/JP/AZ) with a
MultiPolygon geometry, find the largest part (anchor). Walk the other
parts: if a part is within 0.01 deg of the anchor (or an already-accepted
part - so a chain of touching pieces stays together), keep it merged;
otherwise, if its area is >= DISCONNECTED_SPLIT_AREA_KM2, split it off as
its own new feature. We don't have the original per-province name/code at
this point (out/asia_1946.geojson only stores the merged cluster's
source_adm1 codes list, not per-part names) - the split-off feature is
named via WIKIPEDIA-free heuristic: looked up from raw game_map.json by
matching adm1_code (recoverable: source_adm1 lists ALL codes in the
cluster, and each part's centroid can be matched back to whichever raw
feature contains it).

Reads/writes out/asia_1946.geojson.

Idempotent: an already-split feature has no disconnected part left above
threshold, so a second run finds nothing to split.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import game_map, out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape, mapping

ASIA_PATH = out("asia_1946.geojson")
REGION_FIELD_ISO = {"PH", "JP", "AZ"}
DISCONNECTED_SPLIT_AREA_KM2 = 300.0
NEAR_DEG = 0.01


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    with open(ASIA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    feats = data["features"]

    raw_feats = load_features(game_map())
    raw_by_iso = {}
    for ft in raw_feats:
        iso = ft["properties"].get("iso_a2")
        if iso in REGION_FIELD_ISO:
            raw_by_iso.setdefault(iso, []).append(ft)

    new_feats = []
    n_split = 0
    for ft in feats:
        props = ft["properties"]
        iso = props.get("iso_a2")
        # Уже финализированные предыдущим прогоном - не трогаем повторно.
        # Без этой проверки: "Palawan" сам по себе МногоОстровной (реальная
        # провинция, острова группы Калимантан/Балабак) - каждый повторный
        # прогон видел бы его снова как "MultiPolygon с несвязанными
        # частями >= порога" и дробил бы САМ СЕБЯ дальше на всё более
        # мелкие "Palawan"-фичи вместо no-op (найдено 2026-07-29 при
        # проверке идемпотентности - 3 прогона подряд дали 3 РАЗНЫХ
        # площади Palawan вместо стабильного числа).
        if props.get("merge_method") == "region_split_disconnected":
            new_feats.append(ft)
            continue
        if iso not in REGION_FIELD_ISO:
            new_feats.append(ft)
            continue
        g = shape(ft["geometry"])
        if g.geom_type != "MultiPolygon":
            new_feats.append(ft)
            continue
        parts = sorted(g.geoms, key=lambda p: -p.area)
        anchor_parts = [parts[0]]
        split_off = []
        for p in parts[1:]:
            near_anchor = any(p.distance(a) < NEAR_DEG for a in anchor_parts)
            if near_anchor or area_km2(p) < DISCONNECTED_SPLIT_AREA_KM2:
                anchor_parts.append(p)
            else:
                split_off.append(p)
        if not split_off:
            new_feats.append(ft)
            continue

        from shapely.ops import unary_union
        anchor_geom = unary_union(anchor_parts) if len(anchor_parts) > 1 else anchor_parts[0]
        ft["geometry"] = mapping(anchor_geom)
        ft["properties"]["area_km2"] = round(area_km2(anchor_geom), 1)
        new_feats.append(ft)

        # Раздельные компоненты (по связности) могут принадлежать ОДНОЙ и
        # той же сырой провинции (сама провинция уже MultiPolygon в
        # источнике - напр. Palawan включает Калимантанскую группу/Балабак
        # как отдельные острова ОДНОЙ провинции) - группируем по
        # распознанному имени ПЕРЕД тем, как выделять в отдельные фичи,
        # иначе получаются дублирующиеся регионы с одинаковым названием
        # (найдено 2026-07-29: "Palawan" x4, "Masbate" x3 и т.п. до этой
        # группировки).
        by_name = {}
        for p in split_off:
            centroid = p.centroid
            match_name = None
            for raw_ft in raw_by_iso.get(iso, []):
                rg = shape(raw_ft["geometry"])
                if rg.contains(centroid) or rg.distance(centroid) < 1e-6:
                    match_name = raw_ft["properties"].get("name")
                    break
            name = match_name or f"{props.get('name')} (exclave)"
            by_name.setdefault(name, []).append(p)

        for name, parts_for_name in by_name.items():
            geom = unary_union(parts_for_name) if len(parts_for_name) > 1 else parts_for_name[0]
            print(f"  [SPLIT] {props.get('name')} ({iso}): +{name!r} "
                  f"({area_km2(geom):.1f} km2, {len(parts_for_name)} part(s)) split off as its own region")
            new_feats.append({
                "type": "Feature",
                "properties": {
                    "iso_a2": iso, "name": name,
                    "area_km2": round(area_km2(geom), 1),
                    "merge_method": "region_split_disconnected",
                    "source_adm1": [],
                },
                "geometry": mapping(geom),
            })
            n_split += 1

    data["features"] = new_feats
    with open(ASIA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Split off {n_split} disconnected piece(s). Wrote {ASIA_PATH}")


if __name__ == "__main__":
    main()
