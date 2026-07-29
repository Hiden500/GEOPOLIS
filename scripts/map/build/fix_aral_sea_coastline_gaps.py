"""
fix_aral_sea_coastline_gaps.py — one-off gap fix (2026-07-29).

reconstruct_aral_sea_1946.py (2026-07-23) replaces the Aral Sea's geometry
in out/lakes_1946.geojson with a shape synthesized from real anchors
(Muynak/Aralsk ports) instead of the old calibrated-ellipse placeholder.
It is intentionally NOT in FULL_REBUILD_STEPS and lakes_1946.geojson is a
hand-maintained input no build script regenerates wholesale - so this
worktree's copy had reverted to the plain oval (same "stale hand-
maintained input" class already found this session for South America/
Great Lakes/Panama). Re-running reconstruct_aral_sea_1946.py restores the
real shape, but the surrounding Kazakhstan/Uzbekistan land (Aqtöbe,
Qyzylorda, Karakalpakstan) was fitted to the OLD oval - the new,
differently-shaped lake both overlaps land in some places (already fixed
by re-running clip_land_by_water.py) and leaves a genuine coastline GAP
in others (18092.6 km2, since the new shape's southern extent doesn't
reach as far as the old oval did there) - clip_land_by_water.py only
handles overlaps, not gaps.

Fix: same gap-first absorb_slivers_until_stable pattern as fix_lake_
coastline_gaps.py's Great Lakes fix - land (Aqtöbe/Qyzylorda/
Karakalpakstan, whichever NAM^H^H ASIA features intersect the lake's
bbox) grows to meet the lake (authoritative water).

Reads/writes out/asia_1946.geojson.

Idempotent: absorb_slivers_until_stable already converges to 0 on an
already-closed gap, so a second run is always safe. Must be re-run any
time reconstruct_aral_sea_1946.py changes the lake shape again.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import absorb_slivers_until_stable, resolve_same_iso_overlaps, area_km2, to_polygonal  # noqa: E402
from diagnose_coastline_gaps import load_all_geoms, _gap_cells  # noqa: E402
from shapely.geometry import shape, mapping, box as shp_box, Polygon
from shapely.strtree import STRtree
from shapely.ops import unary_union

ASIA_PATH = out("asia_1946.geojson")
BUFFER_DEG = 0.5


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def drop_spurious_holes(geom, other_geoms, label=""):
    """unary_union of a big polygonize cell into an already-complex polygon
    can leave a false interior ring (donut hole) instead of cleanly filling
    it - found 2026-07-29: merging the ~15393 km2 southern gap cell into
    Karakalpakstan left a 2567 km2 hole punched into it, matching nothing
    (not a real lake, not another feature's territory - _gap_cells() found
    it as a fresh LAND_HOLE right after this script ran).

    An interior ring is real (kept) if SOME other known feature - water
    (a real lake) OR land (a real enclave, e.g. Туратам/Tyuratam-Baikonur
    inside Qyzylorda) - actually sits there; otherwise it's the union
    artifact and gets filled. Checking water alone is NOT enough - first
    version of this function did that and silently swallowed Tyuratam
    into Qyzylorda (0.7548 deg2) on a second run, since it only re-checked
    features THIS run's point-fix had actually touched. Caller must
    restrict `geom` to features it just modified - do not blanket-scan
    every mutable feature every run, most of their holes (if any) are
    unrelated legitimate enclaves this script has no business judging."""
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    fixed = []
    for p in polys:
        keep_interiors = []
        for interior in p.interiors:
            hole = Polygon(interior)
            if any(hole.intersects(g) for g in other_geoms):
                keep_interiors.append(interior)
            else:
                print(f"  [HOLE-FIX/{label}] dropped spurious interior ring, "
                      f"{hole.area:.4f} deg2 at {hole.centroid}")
        fixed.append(Polygon(p.exterior, keep_interiors))
    return unary_union(fixed) if len(fixed) > 1 else fixed[0]


def main():
    lakes_feats = load_features(out("lakes_1946.geojson"))
    aral = None
    for ft in lakes_feats:
        if "Аральск" in (ft["properties"].get("name") or ""):
            aral = shape(ft["geometry"])
            break
    if aral is None:
        print("  ВНИМАНИЕ: Аральское море не найдено в lakes_1946.geojson — прерываю")
        return

    minx, miny, maxx, maxy = aral.bounds
    clip_box = shp_box(minx - BUFFER_DEG, miny - BUFFER_DEG, maxx + BUFFER_DEG, maxy + BUFFER_DEG)

    lake_geoms = [shape(ft["geometry"]) for ft in lakes_feats if shape(ft["geometry"]).intersects(clip_box)]
    seas_feats = load_features(out("seas_1946.geojson"))
    sea_geoms = [shape(ft["geometry"]) for ft in seas_feats if shape(ft["geometry"]).intersects(clip_box)]
    water_geoms = lake_geoms + sea_geoms

    asia_feats = load_features(ASIA_PATH)
    asia_tree = STRtree([shape(ft["geometry"]) for ft in asia_feats])
    relevant_idx = [int(i) for i in asia_tree.query(clip_box)
                    if shape(asia_feats[int(i)]["geometry"]).intersects(clip_box)]
    if not relevant_idx:
        print("  ВНИМАНИЕ: нет фич Asia в bbox Аральского моря — прерываю")
        return

    mutable_feats = [asia_feats[i] for i in relevant_idx]
    before_geoms = {i: shape(asia_feats[i]["geometry"]) for i in relevant_idx}
    print(f"  суша Asia в области: {len(mutable_feats)} фич")

    absorb_slivers_until_stable(mutable_feats, context_geoms=(), water_geoms=water_geoms,
                                 clip_box=clip_box, label="Aral Sea")
    n_overlap_fixed = resolve_same_iso_overlaps(mutable_feats, label="Aral Sea")

    # A full lake reshape (not a small sliver) leaves gaps far bigger than
    # MAX_RIBBON_AREA - absorb_slivers's general safety gate correctly
    # rejects them (they're not thin ribbons, they're literally "the new
    # coastline doesn't match the old one anymore"). Reuse the same proven
    # _gap_cells() (diagnose_coastline_gaps.py) point-fix pattern already
    # used for Ponta Porã junction/Alaska: every COASTLINE cell found
    # inside this script's OWN tight clip_box is, by construction, part of
    # this same lake-reshape mismatch - assign each to whichever mutable
    # feature shares the longest boundary, bypassing the general gate only
    # here, not the shared thresholds in geometry_cleanup.py.
    land_geoms, water_geoms_full = load_all_geoms(clip_box)
    gaps = _gap_cells(clip_box, land_geoms, water_geoms_full)
    mutable_geoms = {i: shape(mutable_feats[pos]["geometry"]) for pos, i in enumerate(relevant_idx)}
    touched = set()
    for cell, a, pt, cat in gaps:
        if cat != "COASTLINE":
            continue
        best_i, best_len = None, -1.0
        for i in relevant_idx:
            shared = cell.boundary.intersection(mutable_geoms[i].boundary).length
            if shared > best_len:
                best_i, best_len = i, shared
        if best_i is None or best_len <= 0:
            continue
        print(f"  [POINTFIX/Aral Sea] cell {a:.1f} km2 at ({pt[0]:.3f},{pt[1]:.3f}) -> "
              f"{next(ft for i, ft in zip(relevant_idx, mutable_feats) if i == best_i)['properties'].get('name')}")
        mutable_geoms[best_i] = to_polygonal(unary_union([mutable_geoms[best_i], cell]))
        touched.add(best_i)

    # Only re-check features this run's point-fix actually merged a cell
    # into - NOT every mutable feature every run (see drop_spurious_holes
    # docstring: a blanket scan filled in Tyuratam's legitimate enclave
    # inside Qyzylorda on a run where Qyzylorda received no point-fix at
    # all). other_geoms = context (everything NOT in this script's mutable
    # set) + water, so a real enclave (land) or real lake (water) both
    # correctly survive the check.
    context_geoms = [shape(ft["geometry"]) for i, ft in enumerate(asia_feats) if i not in set(relevant_idx)]
    for i in touched:
        mutable_geoms[i] = drop_spurious_holes(mutable_geoms[i], context_geoms + water_geoms, label="Aral Sea")
    for pos, i in enumerate(relevant_idx):
        mutable_feats[pos]["geometry"] = mapping(mutable_geoms[i])

    total_added = 0.0
    for i, ft in zip(relevant_idx, mutable_feats):
        asia_feats[i] = ft
        after_g = shape(ft["geometry"])
        added = area_km2(after_g) - area_km2(before_geoms[i])
        if abs(added) > 0.05:
            total_added += added
            print(f"    {ft['properties'].get('name')}: +{added:.1f} km2")

    print(f"  Всего добавлено суше: {total_added:.1f} km2"
          + (f", исправлено наложений: {n_overlap_fixed}" if n_overlap_fixed else ""))

    with open(ASIA_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": asia_feats}, f, ensure_ascii=False)
    print(f"  Записано: {ASIA_PATH}")


if __name__ == "__main__":
    main()
