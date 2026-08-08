"""
fix_washington_sanjuan_orphans.py — one-off ownership fix (2026-07-29).

User (2026-07-29, annotated screenshot): "У полигона раскиданы 'сироты' по
разным берегам. Уже было такое (Ionian Sea - как пример)" — Washington —
San Juan's MultiPolygon carried 4 small disconnected parts beyond its main
body, found by direct inspection: 3 (115.7 + 5.5 + 0.4 km2, all north of
49N or on Vancouver Island's west coast) touch ONLY British Columbia and
have NO raw `game_map.json` source under Washington at all — genuine
Canadian territory (Gulf Islands/Vancouver Island coast) misattributed to
Washington, not noise. The 4th (0.2 km2) touches Washington — Adams and
DOES have a raw Washington source — legitimately Washington, just
disconnected from San Juan specifically and better merged into the Adams
cluster it actually borders.

Root cause: float-coordinate drift from an earlier `unary_union` growing
British Columbia (fix_alaska_coastline_gaps.py's own docstring already
names this exact failure mode — "unary_union can shift float coordinates
ANYWHERE in that region's geometry, not just near the edited spot") most
likely produced these fragments as a side effect, well before this
session's Puget Sound gap-closing pass (fix_puget_sound_coastline_
gaps.py, same day) — this script runs BEFORE that one in FULL_REBUILD_
STEPS so any newly-introduced gap from the reassignment gets closed by
the later pass, not left open.

Method: any Washington — San Juan MultiPolygon part disconnected from the
largest part is reassigned to whichever DIFFERENT-country land feature it
touches (distance < 0.001 deg) — this is decisive rather than a judgment
call, since a real Washington fragment would still be covered by raw
Washington source at that location (checked as a sanity assertion, not a
routing decision) and a foreign fragment touches only the foreign
neighbor. Falls back to leaving a part in place (with a loud warning) if
it doesn't unambiguously touch exactly one other NAM feature — never
guesses.

Reads/writes out/namerica_1946.geojson.

Idempotent: once every disconnected part has been reassigned, San Juan's
geometry is a single Polygon and there is nothing left to move on a
second run.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

NAM_PATH = out("namerica_1946.geojson")
SOURCE_NAME = "Washington — San Juan"
TOUCH_DEG = 0.001


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    nam_feats = load_features(NAM_PATH)
    src_idx = next((i for i, ft in enumerate(nam_feats)
                     if ft["properties"].get("name") == SOURCE_NAME), None)
    if src_idx is None:
        print(f"  ВНИМАНИЕ: {SOURCE_NAME!r} не найдено в {NAM_PATH} — прерываю")
        return

    src_geom = shape(nam_feats[src_idx]["geometry"])
    if src_geom.geom_type != "MultiPolygon" or len(src_geom.geoms) < 2:
        print(f"  {SOURCE_NAME}: один сплошной полигон, орфанов нет")
        return

    parts = sorted(src_geom.geoms, key=lambda p: -p.area)
    main_part, orphans = parts[0], parts[1:]
    if not orphans:
        print(f"  {SOURCE_NAME}: орфанов нет")
        return

    # region_id -> накопленные части, которые нужно в него влить
    to_merge = {}
    unresolved = []
    for orphan in orphans:
        touching = [i for i, ft in enumerate(nam_feats)
                    if i != src_idx and shape(ft["geometry"]).distance(orphan) < TOUCH_DEG]
        if len(touching) != 1:
            unresolved.append(orphan)
            print(f"  ВНИМАНИЕ: часть {area_km2(orphan):.2f} km2 у {orphan.centroid} "
                  f"касается {len(touching)} фич (нужно ровно 1) — оставлена как есть")
            continue
        to_merge.setdefault(touching[0], []).append(orphan)

    for target_idx, pieces in to_merge.items():
        target_ft = nam_feats[target_idx]
        merged = to_polygonal(unary_union([shape(target_ft["geometry"])] + pieces))
        target_ft["geometry"] = mapping(merged)
        target_ft["properties"]["area_km2"] = round(area_km2(merged), 1)
        total = sum(area_km2(p) for p in pieces)
        print(f"  {target_ft['properties'].get('name')}: +{total:.2f} km2 "
              f"({len(pieces)} орфанных част(и/ей) от {SOURCE_NAME})")

    new_src_geom = to_polygonal(unary_union([main_part] + unresolved))
    nam_feats[src_idx]["geometry"] = mapping(new_src_geom)
    nam_feats[src_idx]["properties"]["area_km2"] = round(area_km2(new_src_geom), 1)
    print(f"  {SOURCE_NAME}: {area_km2(src_geom):.1f} -> {area_km2(new_src_geom):.1f} km2")

    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": nam_feats}, f, ensure_ascii=False)
    print(f"  Записано: {NAM_PATH}")


if __name__ == "__main__":
    main()
