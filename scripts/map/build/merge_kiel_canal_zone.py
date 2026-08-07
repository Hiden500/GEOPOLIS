"""
merge_kiel_canal_zone.py — recurring pipeline fix (2026-07-27).

"Kiel Canal Zone" (iso_a2 "DE_KC") is built from a real game_map.json
source, but its raw geometry is a 2-part MultiPolygon: the actual canal
corridor (Kiel to Brunsbuttel) plus a small stray fragment (~0.8 km2)
~3km away that touches Niedersachsen (distance 0) and NOT Schleswig-
Holstein - the same "cross-source difference/union leaves a disconnected
sliver stuck to the wrong neighbor" pattern already seen on HaZafon/Golan
and PSE-Jerusalem. Since this comes from build_europe_1946.py's own raw
source (not a manual one-off patch like Panama Canal Zone), a future full
rebuild WILL reproduce the same 2-part shape - this step belongs in
FULL_REBUILD_STEPS, not a run-once recovery script.

Fix: keep Kiel Canal Zone as its own region (largest part only), merge
every other part into Niedersachsen. Re-clips the result against Baltic/
North Sea afterward - unary_union of two touching-but-not-bit-identical
polygons can introduce a small overlap with a neighboring sea that
existed in neither source polygon beforehand (confirmed here: ~22 km2).

Idempotent: if Kiel Canal Zone is already a single Polygon (previously
fixed), does nothing.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

EUROPE_PATH = out("europe_1946.geojson")
SEAS_PATH = out("seas_1946.geojson")
SEAS_TO_CLIP = ("Baltic Sea", "North Sea")


def main():
    with open(EUROPE_PATH, encoding="utf-8") as f:
        data = json.load(f)

    kiel_idx = next((i for i, ft in enumerate(data["features"])
                      if ft["properties"].get("name") == "Kiel Canal Zone"), None)
    nieder_idx = next((i for i, ft in enumerate(data["features"])
                        if ft["properties"].get("name") == "Niedersachsen"), None)
    if kiel_idx is None:
        print("Kiel Canal Zone not found - nothing to do.")
        return
    if nieder_idx is None:
        raise SystemExit("Niedersachsen not found - cannot merge stray fragment into it.")

    kiel_ft = data["features"][kiel_idx]
    kiel_g = shape(kiel_ft["geometry"])
    if kiel_g.geom_type != "MultiPolygon" or len(list(kiel_g.geoms)) < 2:
        print("Kiel Canal Zone is already a single part - already fixed, nothing to do (idempotent).")
        return

    parts = sorted(kiel_g.geoms, key=lambda p: -p.area)
    main_part, stray_parts = parts[0], parts[1:]
    print(f"Kiel Canal Zone: {len(parts)} parts, main={area_km2(main_part):.1f} km2, "
          f"stray={sum(area_km2(p) for p in stray_parts):.2f} km2 across {len(stray_parts)} part(s)")

    nieder_ft = data["features"][nieder_idx]
    nieder_g = shape(nieder_ft["geometry"])
    merged_nieder = unary_union([nieder_g] + list(stray_parts))

    with open(SEAS_PATH, encoding="utf-8") as f:
        seas_data = json.load(f)
    for sea_name in SEAS_TO_CLIP:
        sea_g = next((shape(ft["geometry"]) for ft in seas_data["features"]
                      if ft["properties"].get("name") == sea_name), None)
        if sea_g is not None:
            merged_nieder = merged_nieder.difference(sea_g)

    before = area_km2(nieder_g)
    after = area_km2(merged_nieder)
    print(f"Niedersachsen: {before:.1f} -> {after:.1f} km2 "
          f"(net of a re-clip against {', '.join(SEAS_TO_CLIP)})")

    nieder_ft["geometry"] = mapping(merged_nieder)
    kiel_ft["geometry"] = mapping(main_part)
    if "area_km2" in kiel_ft["properties"]:
        kiel_ft["properties"]["area_km2"] = round(area_km2(main_part), 1)

    with open(EUROPE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"Kiel Canal Zone kept as its own region (main part only), "
          f"stray fragment(s) merged into Niedersachsen. Wrote {EUROPE_PATH}")


if __name__ == "__main__":
    main()
