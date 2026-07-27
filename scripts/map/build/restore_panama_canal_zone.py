"""
restore_panama_canal_zone.py — one-off recovery script (2026-07-27).

Panama Canal Zone (iso_a2 "PA_CZ", historically a distinct US-administered
zone 1903-1979, NOT Panama sovereign territory) has now been silently lost
from scripts/map/out/namerica_1946.geojson TWICE by the same root cause:
the file is gitignored/regenerated, the Canal Zone has no raw game_map.json
source (EXTRA/manual feature), and no build_*.py step reproduces it — so
any "regenerate namerica from scratch" run (needed here in commit ba6db55
to fix a real encoding bug in build_us_states_split_1946.py) silently drops
it. First loss/recovery: commit a6f74ea (2026-07-19). Second loss: ba6db55
(2026-07-19, same session, later same day) — never re-recovered until now.

This script restores it from the last commit where it existed
(client/public/world_1946.geojson @ d13f029), clipping the CURRENT (since
re-merged/re-clustered) Panama provinces that now overlap its historical
footprint — confirmed empirically: "Panama (3)" and "Los Santos (7)" both
now overlap the old Canal Zone shape by a non-trivial area, because their
raw-ADM1 clustering changed between d13f029 and today. The historical,
precisely-anchored Canal Zone shape is authoritative here (same "already-
vetted, don't reshape it back" principle as the sea-gluing finalize step in
geometry_cleanup.py); the modern-source Panama provinces are the imprecise
side and get clipped, not the other way around.

Added to FULL_REBUILD_STEPS (after build_namerica_1946.py, since it must
run before any step that assumes Panama's final shape) so a future full
rebuild can't silently drop the Zone a third time - it now reads its
geometry from a tracked repo file, not a session scratchpad, specifically
so this script survives across sessions/machines.

Idempotent: if Panama Canal Zone already exists in namerica_1946.geojson
(e.g. because this step already ran earlier in the same build), it skips
without duplicating the feature.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape, mapping

BACKUP_PATH = str(Path(__file__).resolve().parents[1] / "config" / "manual_patches" / "panama_canal_zone_1946.json")
NAMERICA_PATH = out("namerica_1946.geojson")


def main():
    with open(NAMERICA_PATH, encoding="utf-8") as f:
        data = json.load(f)

    if any(ft["properties"].get("iso_a2") == "PA_CZ" for ft in data["features"]):
        print("Panama Canal Zone already present - nothing to do (idempotent).")
        return

    with open(BACKUP_PATH, encoding="utf-8") as f:
        old_feature = json.load(f)

    cz_geom = shape(old_feature["geometry"])
    print(f"Canal Zone area: {area_km2(cz_geom):.1f} km2")

    clipped_count = 0
    for ft in data["features"]:
        if ft["properties"].get("iso_a2") != "PA":
            continue
        g = shape(ft["geometry"])
        if not g.intersects(cz_geom):
            continue
        overlap = g.intersection(cz_geom)
        if overlap.area < 1e-9:
            continue
        before = area_km2(g)
        new_g = g.difference(cz_geom)
        after = area_km2(new_g)
        print(f"Clipping {ft['properties']['name']!r}: {before:.1f} -> {after:.1f} km2 "
              f"(-{before - after:.1f} km2 to Canal Zone)")
        ft["geometry"] = mapping(new_g)
        clipped_count += 1

    if clipped_count == 0:
        print("WARNING: no current Panama province overlapped the Canal Zone shape - "
              "unexpected, verify manually before proceeding.")

    new_feature = {
        "type": "Feature",
        "properties": {
            "iso_a2": "PA_CZ",
            "name": "Panama Canal Zone",
            "source_adm1": [],
            "source_count": 0,
            "area_km2": round(area_km2(cz_geom), 1),
            "merge_method": "manual_historical_restore",
        },
        "geometry": mapping(cz_geom),
    }
    data["features"].append(new_feature)

    with open(NAMERICA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"Restored Panama Canal Zone, clipped {clipped_count} overlapping Panama province(s), "
          f"wrote {NAMERICA_PATH}")
    print("REMINDER: after merge_world_1946.py assigns this feature its final region_id, "
          "manually add {region_id: {'owner': 'USA'}} to ownership_1946.json and a "
          "{region_id, name_en: 'Panama Canal Zone', name_ru: 'Зона Панамского канала', ...} "
          "entry to names_ru.json - remap_region_ids.py only tracks already-existing "
          "entities, it will not create these for a brand-new feature.")


if __name__ == "__main__":
    main()
