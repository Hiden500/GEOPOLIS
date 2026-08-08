"""
fix_alaska_coastline_gaps.py — one-off gap fix (2026-07-27).

diagnose_coastline_gaps.py's N.America COASTLINE backlog (694 cells/
2493.6 km2 after clearing pipeline staleness, see docs/DECISIONS.md) is
roughly half Alaska (331 cells/1412.6 km2) and half scattered elsewhere
(San Diego/Puget Sound/Chesapeake Bay/Florida/Maine, not in scope here).

Root cause for Alaska, confirmed directly (not the gate-1 compactness
hypothesis from the earlier N.America investigation): 329 of the 331
Alaska gap points ARE covered by raw game_map.json land but NOT by the
built out/namerica_1946.geojson land — a build-process artifact, not a
gate-1 rejection (fix_sea_coastline_gaps.py can never see these: it uses
raw land as its authoritative "don't grow sea here" context, so a point
raw land already covers is invisible to it as a gap, even though the
BUILT land lost that coverage during clustering/simplification, almost
certainly in build_us_states_split_1946.py's Alaska pass, which collapses
nearly all of Alaska into just 2 mega-regions — "Alaska — Yukon-Koyukuk"
and "Alaska — Aleutians West" — unlike other US states' fine-grained
county/borough split).

Fix direction is the SAME as fix_lake_coastline_gaps.py (built LAND grows
to meet authoritative water), not fix_sea_coastline_gaps.py's (sea grows
to meet raw land) — reused pattern, not reused code, since the mutable/
water sets differ. Built SEA/lakes here are already correct (confirmed by
this session's earlier staleness-clearing pass, 0 world intersections) so
they're authoritative water for this pass; raw land is used only for
POST-HOC validation that growth matches truth, not as an absorb input.

Reads/writes out/namerica_1946.geojson.

Idempotent: absorb_slivers_until_stable already converges to 0 on an
already-closed gap, so a second run is always safe.
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
# Covers the Alaska mainland + Aleutians West extent where the 331 gap
# cells were found (diagnose_coastline_gaps.py scan, 2026-07-27) - does
# NOT reach into positive-longitude Attu-area coordinates, unrelated to
# the identified gaps.
ALASKA_BOX = shp_box(-172.0, 51.0, -129.0, 72.0)
BUFFER_DEG = 0.5


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def reclip_mutable_against_all_neighbors(mutable_feats, other_geoms, label=""):
    """unary_union of a merged region can shift float coordinates ANYWHERE
    in that region's geometry, not just near the edited spot - found
    2026-07-27: after absorb_slivers grew British Columbia near Alaska,
    it picked up a ~5.9 km2 overlap with Washington - San Juan, ~1500 km
    away near the BC/WA border, far outside this script's own bbox and
    outside resolve_same_iso_overlaps' scope (different iso_a2: CA vs US).
    Same class of "union creates a NEW overlap with an unrelated third
    party" bug already documented for the Kiel Canal Zone fragment merge
    (docs/DECISIONS.md, 2026-07-27) - the fix there was the same
    principle: re-clip the MUTATED side against ALL neighbors, don't
    touch the untouched/authoritative side, and don't assume "longest
    shared boundary" - the mutated side unconditionally loses, since it's
    the one that moved.

    other_geoms: every NAM feature NOT in mutable_feats, plus seas/lakes -
    i.e. everything authoritative that could have been clipped into."""
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
        ALASKA_BOX.bounds, (-BUFFER_DEG, -BUFFER_DEG, BUFFER_DEG, BUFFER_DEG))])

    nam_feats = load_features(NAM_PATH)
    nam_tree = STRtree([shape(ft["geometry"]) for ft in nam_feats])
    relevant_idx = [int(i) for i in nam_tree.query(clip_box)
                    if shape(nam_feats[int(i)]["geometry"]).intersects(clip_box)]
    if not relevant_idx:
        print("  ВНИМАНИЕ: нет фич North America в bbox Аляски — прерываю")
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
                                 clip_box=clip_box, label="Alaska")
    n_overlap_fixed = resolve_same_iso_overlaps(mutable_feats, label="Alaska")

    # unary_union can shift float coordinates ANYWHERE in a mutated
    # feature's geometry (see reclip_mutable_against_all_neighbors
    # docstring) - check against EVERY other NAM feature worldwide plus
    # all seas/lakes, not just ones near this script's own bbox.
    relevant_set = set(relevant_idx)
    other_land_geoms = [shape(nam_feats[i]["geometry"]) for i in range(len(nam_feats)) if i not in relevant_set]
    all_seas_geoms = [shape(ft["geometry"]) for ft in seas_feats]
    all_lake_geoms = [shape(ft["geometry"]) for ft in lakes_feats]
    n_overlap_fixed += reclip_mutable_against_all_neighbors(
        mutable_feats, other_land_geoms + all_seas_geoms + all_lake_geoms, label="Alaska")

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

    # Валидация: свежедобавленная суша должна лежать (почти) целиком внутри
    # сырой суши game_map.json — независимое подтверждение, что рост шёл к
    # истинному (= сырому) берегу, а не куда-то ещё (тот же метод, что
    # fix_lake_coastline_gaps.py).
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
