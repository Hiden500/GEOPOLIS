#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Можно ли перевести карту HOI4 в градусы. Подгоняем простейшую модель
(равнопромежуточная по долготе, линейная по широте с обрезкой сверху и снизу)
и МЕРЯЕМ качество совпадения суши. Если совпадение плохое — значит проекция
нелинейная и «перенести границы» точнее какого-то предела нельзя.
"""
import csv, json, re, sys
from pathlib import Path
import numpy as np

VAN = Path("D:/SteamLibrary/steamapps/common/Hearts of Iron IV")
# Корень выводится от самого файла (.agent/runs/<прогон>/x.py -> три уровня
# вверх), а не зашивается: дерево прогона удаляется после влития ветки, и
# зашитый путь пережил бы скрипт. Идиома та же, что в scripts/map/build/paths.py.
REPO = Path(__file__).resolve().parents[3]
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(REPO / "scripts/map/build"))

# --- 1. наша суша в растр 0.2 градуса --------------------------------------
from shapely.geometry import shape
from shapely.strtree import STRtree
from shapely.prepared import prep

STEP = 0.2
NX, NY = int(360 / STEP), int(180 / STEP)
cache = Path("our_land.npy")
if cache.exists():
    ours = np.load(cache)
else:
    land = []
    for f in json.load(open(REPO / "scripts/map/master/world_1946.master.geojson",
                            encoding="utf-8"))["features"]:
        if f["properties"].get("region_type") != "land":
            continue
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        land.append(g)
    tree = STRtree(land); prepd = [prep(g) for g in land]
    from shapely.geometry import Point
    ours = np.zeros((NY, NX), dtype=bool)
    for iy in range(NY):
        lat = 90 - (iy + 0.5) * STEP
        for ix in range(NX):
            lon = -180 + (ix + 0.5) * STEP
            p = Point(lon, lat)
            for k in tree.query(p):
                if prepd[int(k)].contains(p):
                    ours[iy, ix] = True
                    break
        if iy % 150 == 0:
            print(f"  растеризация нашей суши {iy}/{NY}")
    np.save(cache, ours)
print("наша суша:", ours.shape, "доля суши %.3f" % ours.mean())

# --- 2. маска суши HOI4 ----------------------------------------------------
INT = re.compile(r"^\d+$")
ptype = {}; pcol = {}
for row in csv.reader(open(VAN / "map/definition.csv", encoding="latin-1"), delimiter=";"):
    if len(row) >= 5 and INT.match(row[0]):
        ptype[int(row[0])] = row[4]
        pcol[(int(row[1]) << 16) | (int(row[2]) << 8) | int(row[3])] = int(row[0])

from PIL import Image
Image.MAX_IMAGE_PIXELS = None
a = np.asarray(Image.open(VAN / "map/provinces.bmp").convert("RGB"), dtype=np.int32)
H, W = a.shape[:2]
key = (a[:, :, 0] << 16) | (a[:, :, 1] << 8) | a[:, :, 2]
print(f"provinces.bmp {W}x{H}")
uniq = np.unique(key)
issea = np.zeros(uniq.max() + 1, dtype=np.uint8)
for k in uniq:
    issea[k] = 1 if ptype.get(pcol.get(int(k), -1)) == "sea" else 0
hoi_sea = issea[key].astype(bool)
hoi_land = ~hoi_sea
print("HOI4: доля не-моря %.3f" % hoi_land.mean())

# --- 3. подгонка --------------------------------------------------------
SUB = 4
hs = hoi_land[::SUB, ::SUB]
hh, hw = hs.shape
yy, xx = np.mgrid[0:hh, 0:hw]
px = (xx + 0.5) * SUB / W
py = (yy + 0.5) * SUB / H


def score(lon0, lat_top, lat_bot):
    lon = lon0 + px * 360.0
    lon = ((lon + 180.0) % 360.0) - 180.0
    lat = lat_top - py * (lat_top - lat_bot)
    ix = ((lon + 180.0) / STEP).astype(np.int32).clip(0, NX - 1)
    iy = ((90.0 - lat) / STEP).astype(np.int32).clip(0, NY - 1)
    return (ours[iy, ix] == hs).mean()


best = None
for lon0 in np.arange(-190, -170, 2.0):
    for lt in np.arange(78, 92, 2.0):
        for lb in np.arange(-80, -50, 2.0):
            s = score(lon0, lt, lb)
            if best is None or s > best[0]:
                best = (s, lon0, lt, lb)
print("грубо: совпадение %.4f при lon0=%.1f, верх %.1f, низ %.1f" % best)
s0, lon0, lt0, lb0 = best
for _ in range(3):
    step = 1.0
    for lon0c in np.arange(lon0 - 2, lon0 + 2.01, step / 2):
        for ltc in np.arange(lt0 - 2, lt0 + 2.01, step / 2):
            for lbc in np.arange(lb0 - 2, lb0 + 2.01, step / 2):
                s = score(lon0c, ltc, lbc)
                if s > s0:
                    s0, lon0, lt0, lb0 = s, lon0c, ltc, lbc
print("точно: совпадение %.4f при lon0=%.2f, верх %.2f, низ %.2f" % (s0, lon0, lt0, lb0))

base = max((ours[((90 - (lt0 - py * (lt0 - lb0))) / STEP).astype(np.int32).clip(0, NY - 1),
                 ((((lon0 + px * 360 + 180) % 360)) / STEP).astype(np.int32).clip(0, NX - 1)]).mean(),
           1 - hs.mean())
print("для сравнения: доля не-моря у HOI4 %.3f, у нас суши %.3f" % (hs.mean(), ours.mean()))
print("«всё вода» дало бы %.4f, «всё суша» — %.4f" % (1 - hs.mean(), hs.mean()))
np.save("hoi4_landmask.npy", hoi_land)
json.dump({"lon0": float(lon0), "lat_top": float(lt0), "lat_bot": float(lb0),
           "score": float(s0), "W": int(W), "H": int(H)},
          open("hoi4_fit.json", "w"), indent=1)
print("сохранено: hoi4_fit.json")
