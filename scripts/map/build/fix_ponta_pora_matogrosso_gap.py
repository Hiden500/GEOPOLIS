"""
fix_ponta_pora_matogrosso_gap.py — one-off gap fix (2026-07-27).

Ponta Porã (Brazil, Mato Grosso do Sul municipality cluster) and Mato
Grosso (Brazil, separate state region) are declared neighbors in
neighbor_graph.json but don't actually touch: distance ~0.01deg (~1km),
a real "zipper" gap between two independently-clustered Brazilian region
groups, unrelated to the separate Ponta Porã/Presidente Hayes (Paraguay)
overlap fixed by resolve_brazil_paraguay_overlap.py. Same class of issue
gap-first absorb_slivers already handles everywhere else in this codebase
- both regions are mutable (whichever gets more of the gap is decided by
longest shared boundary, same principle as everywhere else), no water is
involved (confirmed inland, not near any Paraguay river/lake feature).

Reads/writes out/southamerica_1946.geojson directly (part of
FULL_REBUILD_STEPS, run after resolve_brazil_paraguay_overlap.py so both
Brazil/Paraguay fixes are already stable before this one runs).

Idempotent: absorb_slivers_until_stable already converges to 0 on an
already-closed gap, so a second run is always safe.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import absorb_slivers_until_stable, area_km2  # noqa: E402
from shapely.geometry import shape, box as shp_box

SAM_PATH = out("southamerica_1946.geojson")
NAME_A = "Ponta Porã"
NAME_B = "Mato Grosso"


def main():
    with open(SAM_PATH, encoding="utf-8") as f:
        data = json.load(f)
    feats = data["features"]

    idx_a = next((i for i, ft in enumerate(feats) if ft["properties"].get("name") == NAME_A), None)
    idx_b = next((i for i, ft in enumerate(feats) if ft["properties"].get("name") == NAME_B), None)
    if idx_a is None or idx_b is None:
        raise SystemExit(f"'{NAME_A}' or '{NAME_B}' not found")

    ga = shape(feats[idx_a]["geometry"])
    gb = shape(feats[idx_b]["geometry"])
    print(f"Before: {NAME_A} distance to {NAME_B} = {ga.distance(gb)}")

    minx, miny, maxx, maxy = ga.union(gb).bounds
    clip_box = shp_box(minx - 0.5, miny - 0.5, maxx + 0.5, maxy + 0.5)

    mutable = [feats[idx_a], feats[idx_b]]
    context = []
    for i, ft in enumerate(feats):
        if i in (idx_a, idx_b):
            continue
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))

    before_a, before_b = area_km2(ga), area_km2(gb)
    absorb_slivers_until_stable(mutable, context, [], clip_box, label="PontaPora-MatoGrosso")

    new_a = shape(feats[idx_a]["geometry"])
    new_b = shape(feats[idx_b]["geometry"])
    print(f"{NAME_A}: {before_a:.2f} -> {area_km2(new_a):.2f} km2")
    print(f"{NAME_B}: {before_b:.2f} -> {area_km2(new_b):.2f} km2")
    print(f"After: distance = {new_a.distance(new_b)}")

    with open(SAM_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"Wrote {SAM_PATH}")


if __name__ == "__main__":
    main()
