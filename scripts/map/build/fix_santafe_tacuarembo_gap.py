"""
fix_santafe_tacuarembo_gap.py — one-off gap fix (2026-07-27).

diagnose_coastline_gaps.py found a 2.8 km2 LAND_HOLE at (-57.622,-30.187),
a tri-country junction gap touching Santa Fe (Argentina), Tacuarembó
(Uruguay) and Rio Grande do Sul (Brazil) - independently digitized
national borders leaving a small "zipper" gap where all three meet, same
class as the Ponta Porã/Mato Grosso/Presidente Hayes/Iguaçu junction, but
much smaller: well under MAX_COMPACT_AREA (2.8 km2 vs ~70-90 km2), so the
general gate-1 compactness check never rejects it - a standard gap-first
absorb_slivers_until_stable with the 3 touching regions as mutable should
close it without any point-fix workaround.

Reads/writes out/southamerica_1946.geojson.

Idempotent: absorb_slivers_until_stable already converges to 0 on an
already-closed gap, so a second run is always safe.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import absorb_slivers_until_stable, area_km2  # noqa: E402
from shapely.geometry import shape, box as shp_box
from shapely.ops import unary_union

SAM_PATH = out("southamerica_1946.geojson")
NAMES = ["Santa Fe", "Tacuarembó", "Rio Grande do Sul"]


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

    geoms_before = {n: shape(feats[idxs[n]]["geometry"]) for n in NAMES}
    minx, miny, maxx, maxy = unary_union(list(geoms_before.values())).bounds
    clip_box = shp_box(minx - 0.5, miny - 0.5, maxx + 0.5, maxy + 0.5)

    mutable = [feats[idxs[n]] for n in NAMES]
    context = []
    for i, ft in enumerate(feats):
        if i in idxs.values():
            continue
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))

    before_areas = {n: area_km2(geoms_before[n]) for n in NAMES}
    absorb_slivers_until_stable(mutable, context, [], clip_box, label="SantaFe-Tacuarembo-RGS")

    for n in NAMES:
        new_g = shape(feats[idxs[n]]["geometry"])
        print(f"{n}: {before_areas[n]:.2f} -> {area_km2(new_g):.2f} km2")

    with open(SAM_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Wrote {SAM_PATH}")


if __name__ == "__main__":
    main()
