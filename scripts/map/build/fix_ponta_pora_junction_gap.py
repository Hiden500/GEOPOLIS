"""
fix_ponta_pora_junction_gap.py — one-off gap fix (2026-07-27).

After resolve_brazil_paraguay_overlap.py (Ponta Pora/Presidente Hayes
overlap) and fix_ponta_pora_matogrosso_gap.py (Ponta Pora/Mato Grosso
direct gap) both ran, diagnose_coastline_gaps.py still found 2 LAND_HOLE
cells (1096.5 km2 + 241.7 km2) near the wider junction where Ponta Pora,
Mato Grosso, Presidente Hayes (Paraguay) and Iguacu all meet.

Confirmed real by zoomed render (not sub-visible noise): both are long,
thick, border-following ribbons - clearly visible gaps, not lake-shaped
blobs. But absorb_slivers's own general size gate (MAX_COMPACT_AREA)
rejects them anyway: each cell's minimum_rotated_rectangle aspect ratio
is LOW (1.72, 3.86) because the ribbon runs DIAGONALLY and zigzags within
a roughly-square bounding box - the same "a shape metric can be fooled"
lesson already documented for perimeter-based compactness turns out to
apply to MRR aspect ratio too, just via a different distortion (diagonal
winding vs. jagged edges). A direct render at proper zoom is still the
only fully reliable check - shape metrics are a filter, not a substitute
for looking.

Fix: reuse diagnose_coastline_gaps.py's own proven _gap_cells() to find
the exact cell geometries (a first hand-rolled reimplementation here
disagreed with it and found 0 cells - don't re-derive cell-mosaic logic
by hand when the working version is one import away), then bypass the
general safety gate for these 2 SPECIFIC, already-visually-verified
cells only, assigning each directly to whichever of the 4 junction
features shares the longest boundary with it. Does NOT touch
absorb_slivers's shared thresholds/constants - narrow, point fix, same
class of decision as PROTECTED_HOLE_POINTS (just inverted: "safe to
absorb here" instead of "never absorb here").

Reads/writes out/southamerica_1946.geojson. Run after resolve_brazil_
paraguay_overlap.py and fix_ponta_pora_matogrosso_gap.py.

Idempotent: if no gap cell is found near either known point, does nothing.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from diagnose_coastline_gaps import load_all_geoms, _gap_cells  # noqa: E402
from shapely.geometry import shape, box as shp_box, Point, mapping
from shapely.ops import unary_union

SAM_PATH = out("southamerica_1946.geojson")
NAMES = ["Ponta Porã", "Mato Grosso", "Presidente Hayes", "Iguaçu"]
# Known-good, already render-verified gap locations (representative points
# from diagnose_coastline_gaps.py's 2026-07-27 scan) - only cells found at
# these exact spots are force-absorbed, nothing else.
KNOWN_GAP_POINTS = [(-55.163, -21.479), (-55.343, -22.536)]
MATCH_TOLERANCE_DEG = 0.05
SCAN_BOX = shp_box(-58.5, -23.5, -54.5, -20)


def main():
    with open(SAM_PATH, encoding="utf-8") as f:
        data = json.load(f)
    feats = data["features"]

    idxs = {}
    for name in NAMES:
        idx = next((i for i, ft in enumerate(feats) if ft["properties"].get("name") == name), None)
        if idx is None:
            raise SystemExit(f"{name!r} not found in {SAM_PATH}")
        idxs[name] = idx

    land_geoms, water_geoms = load_all_geoms(SCAN_BOX)
    gaps = _gap_cells(SCAN_BOX, land_geoms, water_geoms)
    target_cells = []
    for cell, a, pt, cat in gaps:
        if cat != "LAND_HOLE":
            continue
        if any(Point(p).distance(Point(pt)) < MATCH_TOLERANCE_DEG for p in KNOWN_GAP_POINTS):
            target_cells.append((cell, a, pt))

    if not target_cells:
        print("No matching gap cells found near the known points - already fixed (idempotent).")
        return

    mutable_geoms = {n: shape(feats[idxs[n]]["geometry"]) for n in NAMES}
    for cell, a, pt in target_cells:
        best_name, best_len = None, -1.0
        for n in NAMES:
            shared = cell.boundary.intersection(mutable_geoms[n].boundary).length
            if shared > best_len:
                best_name, best_len = n, shared
        print(f"Cell at ({pt[0]:.3f},{pt[1]:.3f}) ({a:.1f} km2) -> {best_name} "
              f"(shared boundary length {best_len:.4f})")
        mutable_geoms[best_name] = to_polygonal(unary_union([mutable_geoms[best_name], cell]))

    for n in NAMES:
        feats[idxs[n]]["geometry"] = mapping(mutable_geoms[n])
        if "area_km2" in feats[idxs[n]]["properties"]:
            feats[idxs[n]]["properties"]["area_km2"] = round(area_km2(mutable_geoms[n]), 1)

    with open(SAM_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Absorbed {len(target_cells)} cell(s). Wrote {SAM_PATH}")


if __name__ == "__main__":
    main()
