#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка ОДНОГО файла для просмотра: нетронутые зоны нашего слоя + нарезанные
океаны вместо их монолитов.

Ничего не решает и никуда не внедряет — это картинка для глаза. Настоящий слой
`scripts/map/out/seas_iho_coastline.geojson` не трогается.

Запуск:  python merge_preview.py
"""
import json, re, sys
from pathlib import Path

# Корень выводится от самого файла (.agent/runs/<прогон>/x.py -> три уровня
# вверх), а не зашивается: дерево прогона удаляется после влития ветки, и
# зашитый путь пережил бы скрипт. Идиома та же, что в scripts/map/build/paths.py.
REPO = Path(__file__).resolve().parents[3]
SCR = Path(__file__).parent
sys.path.insert(0, str(REPO / "scripts/map/build"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CUTS = sorted(SCR.glob("zones_*.geojson"))
if not CUTS:
    raise SystemExit("нет ни одного zones_*.geojson — сначала прогнать build_ocean.py")

base = json.load(open(REPO / "scripts/map/out/seas_iho_coastline.geojson", encoding="utf-8"))

cut_feats, replaced = [], set()
for path in CUTS:
    fc = json.load(open(path, encoding="utf-8"))
    parents = {f["properties"].get("parent") for f in fc["features"]}
    replaced |= {p for p in parents if p}
    for f in fc["features"]:
        p = f["properties"]
        cut_feats.append({"type": "Feature", "properties": {
            "name": p["name"],
            "area_km2": p["area_km2"],
            "source": "World Ablaze (перенос)",
            "parent": p.get("parent"),
            "naval_terrain": p.get("naval_terrain"),
            "coastal_regions": p.get("coastal_regions"),
        }, "geometry": f["geometry"]})
    print(f"{path.name}: {len(fc['features'])} зон, заменяет {sorted(parents)}")

kept = [f for f in base["features"] if f["properties"]["name"] not in replaced]
for f in kept:
    f["properties"].setdefault("parent", None)
    f["properties"].setdefault("naval_terrain", None)
    f["properties"].setdefault("coastal_regions", None)

out = {"type": "FeatureCollection", "features": kept + cut_feats}
dst = SCR / "preview_seas_with_cuts.geojson"
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)

a_kept = sum(f["properties"]["area_km2"] for f in kept)
a_cut = sum(f["properties"]["area_km2"] for f in cut_feats)
a_base = sum(f["properties"]["area_km2"] for f in base["features"])
print(f"\nнетронутых зон {len(kept)} + нарезанных {len(cut_feats)} = {len(out['features'])}")
print(f"было зон {len(base['features'])}, разрезано монолитов {len(replaced)}")
print(f"площадь: было {a_base:,.0f} | стало {a_kept + a_cut:,.0f} | "
      f"разница {a_kept + a_cut - a_base:,.0f} км²".replace(",", " "))
print("файл:", dst)
