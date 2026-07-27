"""
merge_kiel_canal_zone.py — one-off fragment fix (2026-07-27).

"Kiel Canal Zone" (EUR-0371, iso_a2 "DE_KC") is a MultiPolygon with 2 parts:
- part 0 (0.067 deg2, ~54.1 km2): the real canal corridor, Kiel to
  Brunsbuttel - stays as Kiel Canal Zone, untouched.
- part 1 (0.000114 deg2, 0.83 km2): a stray fragment ~3km away from part 0,
  touching Niedersachsen directly (distance=0) and NOT touching Schleswig-
  Holstein (distance ~3.4km) - the same "cross-source difference/union
  leaves a disconnected sliver stuck to the WRONG neighbor" pattern already
  documented for HaZafon/Golan and PSE-Jerusalem in this codebase. This is
  the actual "orphan" - not the whole zone (an earlier pass wrongly merged
  the entire 489.7 km2 zone into Niedersachsen; reverted).

Fix: keep Kiel Canal Zone as its own region (part 0 only), merge just
part 1 into Niedersachsen.

First reverts europe_1946.geojson's Kiel Canal Zone / Niedersachsen back to
their original (pre-this-session) geometry using the committed
client/public/world_1946.geojson snapshot as ground truth, since an earlier,
overly-broad version of this script already ran once and merged the whole
zone in.
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
OLD_SNAPSHOT_PATH = (r"C:\Users\yurew\AppData\Local\Temp\claude\D--Pax-Historia-LOCAL"
                      r"\1c565c22-6966-40c4-b9ce-70b22efe94d2\scratchpad\world_1946_OLD.geojson")


def main():
    with open(EUROPE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    with open(OLD_SNAPSHOT_PATH, encoding="utf-8") as f:
        old = json.load(f)
    old_by_name = {ft["properties"]["name"]: ft for ft in old["features"]}

    kiel_idx = None
    nieder_idx = None
    for i, ft in enumerate(data["features"]):
        name = ft["properties"].get("name", "")
        if name == "Kiel Canal Zone":
            kiel_idx = i
        elif name == "Niedersachsen":
            nieder_idx = i

    # --- revert: restore original Kiel Canal Zone (both parts) + original Niedersachsen ---
    orig_kiel = old_by_name["Kiel Canal Zone"]
    orig_nieder_g = shape(old_by_name["Niedersachsen"]["geometry"])

    if kiel_idx is None:
        data["features"].append(json.loads(json.dumps(orig_kiel)))
        kiel_idx = len(data["features"]) - 1
        print("Kiel Canal Zone was missing (fully merged by the earlier overly-broad pass) - restored both parts.")
    else:
        data["features"][kiel_idx]["geometry"] = json.loads(json.dumps(orig_kiel["geometry"]))
        print("Kiel Canal Zone already present - reset its geometry to the original 2-part shape.")

    if nieder_idx is not None:
        data["features"][nieder_idx]["geometry"] = mapping(orig_nieder_g)
        print(f"Niedersachsen reset to original {area_km2(orig_nieder_g):.1f} km2.")

    # --- now apply the correct, narrow fix: split off just the stray fragment ---
    kiel_ft = data["features"][kiel_idx]
    kiel_g = shape(kiel_ft["geometry"])
    assert kiel_g.geom_type == "MultiPolygon" and len(kiel_g.geoms) == 2, \
        f"expected 2-part MultiPolygon, got {kiel_g.geom_type} with {len(list(kiel_g.geoms))} parts"

    parts = sorted(kiel_g.geoms, key=lambda p: -p.area)
    main_part, stray_part = parts[0], parts[1]
    print(f"Kiel Canal Zone main part: {area_km2(main_part):.1f} km2, "
          f"stray fragment: {area_km2(stray_part):.2f} km2")

    nieder_ft = data["features"][nieder_idx]
    nieder_g = shape(nieder_ft["geometry"])
    merged_nieder = unary_union([nieder_g, stray_part])

    with open(SEAS_PATH, encoding="utf-8") as f:
        seas_data = json.load(f)
    for sea_name in ("Baltic Sea", "North Sea"):
        sea_g = next((shape(ft["geometry"]) for ft in seas_data["features"]
                      if ft["properties"].get("name") == sea_name), None)
        if sea_g is not None:
            merged_nieder = merged_nieder.difference(sea_g)

    before = area_km2(nieder_g)
    after = area_km2(merged_nieder)
    print(f"Niedersachsen: {before:.1f} -> {after:.1f} km2 "
          f"(+{after - before:.2f} km2, the stray fragment, net of a re-clip against Baltic/North Sea)")

    nieder_ft["geometry"] = mapping(merged_nieder)
    kiel_ft["geometry"] = mapping(main_part)
    kiel_ft["properties"]["area_km2"] = round(area_km2(main_part), 1)

    with open(EUROPE_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"Kiel Canal Zone kept as its own region (main part only), "
          f"stray fragment merged into Niedersachsen. Wrote {EUROPE_PATH}")


if __name__ == "__main__":
    main()
