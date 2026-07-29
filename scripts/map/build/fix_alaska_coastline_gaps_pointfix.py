"""
fix_alaska_coastline_gaps_pointfix.py — one-off gap fix (2026-07-27).

After fix_alaska_coastline_gaps.py's general gap-first pass (recovered
1349.2 km2 of build-process-lost Alaska land, 331 -> 3 remaining
COASTLINE cells), 3 residual cells survive:
  - 75.2 km2 at (-147.065,61.076) and 66.8 km2 at (-150.010,60.915),
    Prince William Sound / Kenai area - genuinely rejected by
    absorb_slivers's gate-1 compactness check (0.375, 0.169; already
    documented in docs/DECISIONS.md as also not helped by an MRR aspect
    ratio redesign - aspect 1.17/4.21, same "diagonal winding" blind
    spot as the Ponta Porã junction case).
  - 1.2 km2 at (-168.679,52.970), Unimak Island area - small enough to
    pass gate-1 by area, but absorb_slivers's own internal polygonize
    (different context/water set than diagnose_coastline_gaps.py's
    load_all_geoms) doesn't isolate it as a distinct cell - same class
    of discrepancy already hit once this session with the Ponta Porã
    junction fix (a hand-rolled cell search disagreed with the proven
    _gap_cells() implementation there too).

All 3 confirmed real by zoomed render (thick, clearly bounded land<->sea
notches, not lake-like ambiguity - unlike the Greenland candidates, these
sit directly against open sea, no risk of swallowing an unlisted lake).

Fix: reuse diagnose_coastline_gaps.py's own proven _gap_cells() directly
(same pattern as fix_ponta_pora_junction_gap.py) to find the exact cell
geometries, then assign each to whichever nearby North America land
feature shares the longest boundary - bypasses the general gate ONLY for
these 3 pre-vetted, already-visually-verified cells, same as the Ponta
Porã precedent.

Reads/writes out/namerica_1946.geojson.

Idempotent: if no gap cell is found near the known points, does nothing.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from diagnose_coastline_gaps import load_all_geoms, _gap_cells  # noqa: E402
from shapely.geometry import shape, box as shp_box, Point, mapping
from shapely.strtree import STRtree
from shapely.ops import unary_union

NAM_PATH = out("namerica_1946.geojson")
SCAN_BOX = shp_box(-172.0, 51.0, -129.0, 72.0)
KNOWN_GAP_POINTS = [(-147.065, 61.076), (-150.010, 60.915), (-168.679, 52.970)]
MATCH_TOLERANCE_DEG = 0.05


def main():
    with open(NAM_PATH, encoding="utf-8") as f:
        data = json.load(f)
    feats = data["features"]

    land_geoms, water_geoms = load_all_geoms(SCAN_BOX)
    gaps = _gap_cells(SCAN_BOX, land_geoms, water_geoms)
    target_cells = []
    for cell, a, pt, cat in gaps:
        if cat != "COASTLINE":
            continue
        if any(Point(p).distance(Point(pt)) < MATCH_TOLERANCE_DEG for p in KNOWN_GAP_POINTS):
            target_cells.append((cell, a, pt))

    if not target_cells:
        print("No matching gap cells found near the known points - already fixed (idempotent).")
        return

    nam_tree = STRtree([shape(ft["geometry"]) for ft in feats])
    for cell, a, pt in target_cells:
        nearby_idx = [int(i) for i in nam_tree.query(cell.buffer(0.2))]
        best_i, best_len = None, -1.0
        for i in nearby_idx:
            g = shape(feats[i]["geometry"])
            shared = cell.boundary.intersection(g.boundary).length
            if shared > best_len:
                best_i, best_len = i, shared
        if best_i is None:
            print(f"  WARNING: no nearby feature found for cell at {pt}, skipping")
            continue
        name = feats[best_i]["properties"].get("name")
        print(f"Cell at ({pt[0]:.3f},{pt[1]:.3f}) ({a:.1f} km2) -> {name} "
              f"(shared boundary length {best_len:.4f})")
        g = shape(feats[best_i]["geometry"])
        new_g = to_polygonal(unary_union([g, cell]))
        feats[best_i]["geometry"] = mapping(new_g)
        if "area_km2" in feats[best_i]["properties"]:
            feats[best_i]["properties"]["area_km2"] = round(area_km2(new_g), 1)

    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Absorbed {len(target_cells)} cell(s). Wrote {NAM_PATH}")


if __name__ == "__main__":
    main()
