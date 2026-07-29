"""
fix_aral_sea_raw_boundaries.py — replaces fix_aral_sea_coastline_gaps.py
(2026-07-29).

User (2026-07-29): "Возьми оригинальные казахстанские границы полигонов,
где Арал, и обрежь их. Потому что сейчас прилипание некрасивое" — the
sliver-absorption fix (fix_aral_sea_coastline_gaps.py, same day) closed the
coastline gap left by reconstruct_aral_sea_1946.py's more accurate lake
shape by GROWING Aqtöbe/Qyzylorda/Karakalpakstan cell-by-cell until they
met the new shoreline. That closes gaps correctly but produces an ugly
result: all three provinces' land borders end up hugging every wiggle of
the lake's outline (a coastline-offset, not a real administrative
boundary) — confirmed by direct render, see docs/DECISIONS.md.

This script takes the opposite approach: instead of growing the CURRENT
(already-deformed) province shapes to meet the lake, it goes back to the
ORIGINAL raw admin polygons (game_map.json, before ANY session fix touched
them) and clips each directly by the CURRENT lake shape
(raw_polygon.difference(lake)). The raw source polygons already share
clean mutual borders with each other and with their other neighbors
(verified: 0 overlap, 0 gap between all three pairs, combined footprint
matches the old absorb-grown result to within 0.03 km² of float noise) —
they just don't know about the lake at all, since ADM1 boundary sources
routinely draw straight through/across water bodies. Clipping them by the
lake gives each province its own natural, independent boundary shape that
happens to be cut by the coastline, rather than a boundary that mimics the
coastline's every detail.

Two of the three provinces are NOT single raw features — this game's
build_asia_1946.py geometric clustering merged smaller raw oblasts
together (see out/asia_1946.geojson merge_method="geometric",
source_adm1): "Qyzylorda (3)" = KAZ-3251 (South Kazakhstan) + KAZ-3197
(Qyzylorda); "Karakalpakstan (3)" = UZB-355 (Khorezm) + UZB-356
(Karakalpakstan). Both raw components must be unioned BEFORE subtracting
the lake, or the result silently drops one of the two source oblasts.
"Aqtöbe" is a single raw feature (KAZ-3195), no union needed.

Tyuratam/Baikonur (KAB+00?, a separate raw feature already excluded from
Qyzylorda's raw territory in game_map.json — 0 overlap, verified) survives
untouched: the enclave was never inside Qyzylorda's raw polygon to begin
with, so subtracting the lake doesn't touch it.

Reads/writes out/asia_1946.geojson. Same pairing rule as the script it
replaces: must be re-run any time reconstruct_aral_sea_1946.py changes the
lake shape (lakes_1946.geojson is hand-maintained, never auto-regenerated
— see reconstruct_aral_sea_1946.py's own docstring). Idempotent: re-running
against an unchanged lake shape recomputes the identical geometry.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import game_map, out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from shapely.geometry import shape, mapping  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

ASIA_PATH = out("asia_1946.geojson")

# name in out/asia_1946.geojson -> raw game_map.json adm1_code(s) to union
# before subtracting the lake.
CLUSTERS = {
    "Aqtöbe": ["KAZ-3195"],
    "Qyzylorda (3)": ["KAZ-3251", "KAZ-3197"],
    "Karakalpakstan (3)": ["UZB-355", "UZB-356"],
}


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


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

    raw_feats = load_features(game_map())
    raw_by_code = {ft["properties"].get("adm1_code"): shape(ft["geometry"]) for ft in raw_feats}

    asia_feats = load_features(ASIA_PATH)
    by_name = {ft["properties"].get("name"): i for i, ft in enumerate(asia_feats)}

    new_geoms = {}
    for name, codes in CLUSTERS.items():
        raw_u = unary_union([raw_by_code[c] for c in codes])
        new_geoms[name] = to_polygonal(raw_u.difference(aral))

    # Sanity: raw-clipped provinces must not overlap each other (they come
    # from an ADM1 source with clean mutual borders — a non-zero overlap
    # here would mean the raw source itself changed underneath us).
    names = list(new_geoms)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            ov = area_km2(new_geoms[names[i]].intersection(new_geoms[names[j]]))
            if ov > 0.01:
                print(f"  ВНИМАНИЕ: {names[i]} x {names[j]} наложение {ov:.2f} km2 — не применяю, требуется разбор")
                return

    for name, geom in new_geoms.items():
        i = by_name.get(name)
        if i is None:
            print(f"  ВНИМАНИЕ: {name!r} не найдено в {ASIA_PATH} — прерываю")
            return
        before = area_km2(shape(asia_feats[i]["geometry"]))
        after = area_km2(geom)
        asia_feats[i]["geometry"] = mapping(geom)
        asia_feats[i]["properties"]["area_km2"] = round(after, 1)
        asia_feats[i]["properties"]["merge_method"] = "raw_clip_by_lake"
        print(f"  {name}: {before:.1f} -> {after:.1f} km2 ({after - before:+.1f})")

    with open(ASIA_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": asia_feats}, f, ensure_ascii=False)
    print(f"  Записано: {ASIA_PATH}")


if __name__ == "__main__":
    main()
