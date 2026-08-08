#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Шаги 2-3: механическое присвоение зон World Ablaze нашей воде.

Ручных таблиц соответствия берегов больше нет. Каждая точка НАШЕЙ воды
спрашивает у наложенной карты «какая тут зона», получает имя и тип местности,
и наши зоны собираются как связные области с одинаковым ответом. Берег при
этом остаётся нашим: исходный слой уже обрезан по нашей суше.
"""
import csv, json, math, re, sys
from pathlib import Path
import numpy as np

WA = Path("D:/SteamLibrary/steamapps/workshop/content/394360/2149567872")
# Корень выводится от самого файла (.agent/runs/<прогон>/x.py -> три уровня
# вверх), а не зашивается: дерево прогона удаляется после влития ветки, и
# зашитый путь пережил бы скрипт. Идиома та же, что в scripts/map/build/paths.py.
REPO = Path(__file__).resolve().parents[3]
SCR = Path(__file__).parent
sys.path.insert(0, str(REPO / "scripts/map/build"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from shapely.geometry import shape, box, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep
from scipy.spatial import cKDTree
from geometry_cleanup import area_km2

GRID = 0.4          # шаг сетки, градусы (~44 км)
MIN_ZONE_KM2 = 20000

exec(open(SCR / "warp_wa.py", encoding="utf-8").read().split("# --- переносим")[0])
# из warp_wa.py получены: model, names, nav, terr, reg, seam, err, P

# --- их морская карта в наших координатах ---------------------------------
SUB = 3
H, W = reg.shape
ys, xs = np.mgrid[0:H:SUB, 0:W:SUB]
flat = np.column_stack([xs.ravel(), ys.ravel()])
ll = model(flat)
rr = reg[::SUB, ::SUB].ravel(); ss = seam[::SUB, ::SUB].ravel()
keep = ss & np.isin(rr, list(nav))
LL = ll[keep]; RR = rr[keep]
# дубли через ±180, чтобы у шва сосед искался правильно
edge = (LL[:, 0] < -150) | (LL[:, 0] > 150)
LL = np.vstack([LL, LL[edge] + [360, 0], LL[edge] - [360, 0]])
RR = np.concatenate([RR, RR[edge], RR[edge]])
tree = cKDTree(LL)
print(f"опорных точек их карты: {len(LL)}")

# --- наша вода ------------------------------------------------------------
iho = [(f["properties"]["name"], f["properties"], shape(f["geometry"]))
       for f in json.load(open(REPO / "scripts/map/out/seas_iho_coastline.geojson",
                               encoding="utf-8"))["features"]]
for i, (n, p, g) in enumerate(iho):
    if not g.is_valid:
        iho[i] = (n, p, g.buffer(0))
water = [g for _, _, g in iho]
wtree = STRtree(water); wprep = [prep(g) for g in water]
TOTAL_AREA = sum(p["area_km2"] for _, p, _ in iho)

gx = np.arange(-180 + GRID / 2, 180, GRID)
gy = np.arange(-90 + GRID / 2, 90, GRID)
GXX, GYY = np.meshgrid(gx, gy)
cand = np.column_stack([GXX.ravel(), GYY.ravel()])
inside = np.zeros(len(cand), dtype=bool)
for i, (x, y) in enumerate(cand):
    pt = Point(x, y)
    for k in wtree.query(pt):
        if wprep[int(k)].contains(pt):
            inside[i] = True
            break
    if i % 120000 == 0:
        print(f"  наша вода: {i}/{len(cand)}")
Wpts = cand[inside]
print(f"ячеек нашей воды: {len(Wpts)}")

# --- присвоение -----------------------------------------------------------
d, j = tree.query(Wpts, k=1)
zid = RR[j]
print(f"расстояние до ближайшей их точки: медиана {np.median(d)*111:.0f} км | "
      f"95%% {np.percentile(d,95)*111:.0f} км")

# --- сборка зон -----------------------------------------------------------
wunion = unary_union(water)
pieces = []
for rid in sorted(set(zid.tolist())):
    sel = Wpts[zid == rid]
    if len(sel) == 0:
        continue
    cells = [box(x - GRID / 2, y - GRID / 2, x + GRID / 2, y + GRID / 2) for x, y in sel]
    g = unary_union(cells)
    g = g.buffer(GRID * 0.6).buffer(-GRID * 0.6)          # сгладить лестницу
    g = g.intersection(wunion)                             # берег остаётся нашим
    if g.is_empty:
        continue
    a = area_km2(g)
    if a < MIN_ZONE_KM2:
        continue
    pieces.append((g, names[rid], terr[rid], a))
pieces.sort(key=lambda t: -t[3])
print(f"\nзон получилось: {len(pieces)} (у World Ablaze морских {len(nav)})")
print(f"сумма площадей {sum(p[3] for p in pieces):,.0f} | наша вода {TOTAL_AREA:,.0f}"
      .replace(",", " "))

# --- прибрежные регионы на зону -------------------------------------------
land = [(p.get("iso_a2"), p.get("name"), shape(f["geometry"]))
        for f in json.load(open(REPO / "scripts/map/master/world_1946.master.geojson",
                                encoding="utf-8"))["features"]
        for p in [f["properties"]] if p.get("region_type") == "land"]
ltree = STRtree([g for _, _, g in land])
rows = []
for g, nm, t, a in pieces:
    gb2 = g.buffer(0.02)
    c = sum(1 for k in ltree.query(gb2) if land[int(k)][2].intersects(gb2))
    rows.append((c, a, nm, t))
rows.sort(reverse=True)
print("\nмаксимум прибрежных регионов на зону: %d (%s)" % (rows[0][0], rows[0][2]))
print("зон свыше 25 прибрежных: %d" % sum(1 for c, *_ in rows if c > 25))
print("\n%-30s %-12s %12s %6s" % ("зона", "местность", "площадь км²", "приб."))
for c, a, nm, t in rows[:22]:
    print("%-30s %-12s %12.0f %6d" % (nm[:30], t, a, c))
from collections import Counter
print("\nтипы местности:", dict(Counter(t for _, _, _, t in rows)))

# --- рендер ---------------------------------------------------------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly
import matplotlib.patches as mp

PAL = {"shallow_sea": (126, 186, 222), "deep_ocean": (28, 68, 122),
       "fjords": (96, 150, 140), "ocean": (58, 116, 178), "southern_sea": (150, 170, 200)}
rng = np.random.default_rng(9)
fig, ax = plt.subplots(figsize=(30, 15))
for iso, nm, g in land:
    for pp in (g.geoms if hasattr(g, "geoms") else [g]):
        if pp.geom_type == "Polygon":
            ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                 facecolor="#d8d2c4", edgecolor="#b9b09c", lw=0.15))
for g, nm, t, a in pieces:
    base = np.array(PAL.get(t, (58, 116, 178))) / 255.0
    col = np.clip(base * rng.uniform(0.8, 1.2), 0, 1)
    for pp in (g.geoms if hasattr(g, "geoms") else [g]):
        if pp.geom_type == "Polygon":
            ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                 facecolor=col, edgecolor="white", lw=0.35, alpha=0.92))
for g, nm, t, a in pieces:
    if a < 400000:
        continue
    c = g.representative_point()
    ax.annotate(nm, (c.x, c.y), ha="center", va="center", fontsize=4.6,
                bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.62))
ax.set_xlim(-180, 180); ax.set_ylim(-90, 90); ax.set_aspect(1.25)
ax.set_xticks([]); ax.set_yticks([]); ax.set_facecolor("#eef3f7")
ax.legend(handles=[mp.Patch(color=np.array(v) / 255, label=k) for k, v in PAL.items()],
          loc="lower left", fontsize=10, ncol=5)
ax.set_title(f"Наша вода, размеченная по World Ablaze: {len(pieces)} зон "
             f"(в источнике 186). Имена и тип местности из мода, берег наш.", fontsize=17)
fig.tight_layout(); fig.savefig(SCR / "world_wa.png", dpi=110, bbox_inches="tight")
print("\nкартинка: world_wa.png")
json.dump([{"name": nm, "terrain": t, "area_km2": round(a, 1), "coastal": c}
           for c, a, nm, t in rows], open(SCR / "world_zones.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
