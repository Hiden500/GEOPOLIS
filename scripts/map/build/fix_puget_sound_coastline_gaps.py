"""
fix_puget_sound_coastline_gaps.py — one-off gap fix (2026-07-29).

diagnose_coastline_gaps.py's N.America COASTLINE backlog had a residual
~363 cells/~1081 km2 outside Alaska that were deliberately deferred
(fix_alaska_coastline_gaps.py's docstring: "San Diego/Mexicali border,
Puget Sound WA, Chesapeake Bay VA/NC, Florida, coast of Maine — same
class, not diagnosed in detail, separate task"). User (2026-07-29,
rendered screenshot with circled defects) rejected leaving these as an
open backlog item for the Washington — San Juan area specifically: real
coastline gaps around Puget Sound (Seattle/Tacoma/Bellingham/San Juan
Islands, ~30 cells/~112 km2) are visible on the map as thin gaps, not
acceptable to defer further.

Same gap-first pattern as fix_alaska_coastline_gaps.py/fix_lake_
coastline_gaps.py: built LAND (Washington — San Juan/Adams, British
Columbia, any other NAM feature in the box) grows to meet authoritative
water (already-correct seas/lakes, confirmed 0 world intersections by
this session's earlier work).

Reads/writes out/namerica_1946.geojson.

Idempotent: absorb_slivers_until_stable already converges to 0 on an
already-closed gap.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import game_map, out  # noqa: E402
from geometry_cleanup import absorb_slivers_until_stable, resolve_same_iso_overlaps, area_km2  # noqa: E402
from shapely.geometry import shape, mapping, box as shp_box
from shapely.ops import unary_union
from shapely.strtree import STRtree

NAM_PATH = out("namerica_1946.geojson")
# Puget Sound / San Juan Islands / Bellingham area where the residual
# COASTLINE gaps were found (diagnose_coastline_gaps.py scan, 2026-07-29).
PUGET_BOX = shp_box(-125.5, 47.5, -121.5, 49.9)
BUFFER_DEG = 0.3


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def reclip_mutable_against_all_neighbors(mutable_feats, other_geoms, label=""):
    """See fix_alaska_coastline_gaps.py's identical helper: unary_union of
    a merged region can shift float coordinates ANYWHERE in that region's
    geometry, creating a new overlap with an unrelated third party far
    outside this script's own bbox — check against every other feature
    unconditionally, not just neighbors near the touched area."""
    n_fixed = 0
    for ft in mutable_feats:
        g = shape(ft["geometry"])
        touched = False
        for other in other_geoms:
            if not g.intersects(other):
                continue
            overlap = g.intersection(other)
            if overlap.geom_type == "GeometryCollection":
                polys = [p for p in overlap.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
                overlap = unary_union(polys) if polys else None
            if overlap is None or overlap.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            if overlap.is_empty or overlap.area < 1e-12:
                continue
            g = g.difference(overlap)
            if not g.is_valid:
                g = g.buffer(0)
            touched = True
            n_fixed += 1
        if touched:
            ft["geometry"] = mapping(g)
            if "area_km2" in ft["properties"]:
                ft["properties"]["area_km2"] = round(area_km2(g), 1)
            print(f"  [OVERLAP-FIX/{label}] {ft['properties'].get('name')} переклипан по соседям "
                  f"({n_fixed} наложени(й) снято)")
    return n_fixed


def main():
    clip_box = shp_box(*[c + d for c, d in zip(
        PUGET_BOX.bounds, (-BUFFER_DEG, -BUFFER_DEG, BUFFER_DEG, BUFFER_DEG))])

    nam_feats = load_features(NAM_PATH)
    nam_tree = STRtree([shape(ft["geometry"]) for ft in nam_feats])
    relevant_idx = [int(i) for i in nam_tree.query(clip_box)
                    if shape(nam_feats[int(i)]["geometry"]).intersects(clip_box)]
    if not relevant_idx:
        print("  ВНИМАНИЕ: нет фич North America в bbox Puget Sound — прерываю")
        return

    mutable_feats = [nam_feats[i] for i in relevant_idx]
    before_geoms = {i: shape(nam_feats[i]["geometry"]) for i in relevant_idx}
    print(f"  суша North America в области: {len(mutable_feats)} фич")

    seas_feats = load_features(out("seas_1946.geojson"))
    sea_geoms = [shape(ft["geometry"]) for ft in seas_feats if shape(ft["geometry"]).intersects(clip_box)]
    lakes_feats = load_features(out("lakes_1946.geojson"))
    lake_geoms = [shape(ft["geometry"]) for ft in lakes_feats if shape(ft["geometry"]).intersects(clip_box)]
    water_geoms = sea_geoms + lake_geoms
    print(f"  вода (моря+озёра) в области: {len(water_geoms)} фич")

    absorb_slivers_until_stable(mutable_feats, context_geoms=(), water_geoms=water_geoms,
                                 clip_box=clip_box, label="Puget Sound")
    n_overlap_fixed = resolve_same_iso_overlaps(mutable_feats, label="Puget Sound")

    relevant_set = set(relevant_idx)
    other_land_geoms = [shape(nam_feats[i]["geometry"]) for i in range(len(nam_feats)) if i not in relevant_set]
    all_seas_geoms = [shape(ft["geometry"]) for ft in seas_feats]
    all_lake_geoms = [shape(ft["geometry"]) for ft in lakes_feats]
    n_overlap_fixed += reclip_mutable_against_all_neighbors(
        mutable_feats, other_land_geoms + all_seas_geoms + all_lake_geoms, label="Puget Sound")

    total_added = 0.0
    added_pieces_by_idx = {}
    for i, ft in zip(relevant_idx, mutable_feats):
        nam_feats[i] = ft
        after_g = shape(ft["geometry"])
        added = area_km2(after_g) - area_km2(before_geoms[i])
        if abs(added) > 0.05:
            total_added += added
            added_pieces_by_idx[i] = after_g.difference(before_geoms[i])
            print(f"    {ft['properties'].get('name')}: +{added:.1f} km2")

    print(f"  Всего добавлено суше: {total_added:.1f} km2"
          + (f", исправлено наложений: {n_overlap_fixed}" if n_overlap_fixed else ""))

    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": nam_feats}, f, ensure_ascii=False)
    print(f"  Записано: {NAM_PATH}")

    raw_feats = load_features(game_map())
    raw_geoms = []
    for ft in raw_feats:
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            if not g.is_valid:
                g = g.buffer(0)
            raw_geoms.append(g)
    raw_union = unary_union(raw_geoms)
    unexplained = 0.0
    for i, piece in added_pieces_by_idx.items():
        outside_raw = piece.difference(raw_union)
        outside_area = area_km2(outside_raw)
        if outside_area > 1.0:
            unexplained += outside_area
    print(f"  Валидация: {unexplained:.1f} km2 НОВОЙ суши (только добавленное этим прогоном)"
          f" ВНЕ сырого game_map.json (0 или мало = рост совпал с истинным берегом)")


if __name__ == "__main__":
    main()
