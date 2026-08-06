#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Нарезка ОДНОГО океана за раз, плавными линиями.

Против растровой версии: границы зон берутся не из сетки, а из СУБПИКСЕЛЬНЫХ
КОНТУРОВ их карты, вершины которых прогоняются через деформацию. Кривая
остаётся кривой — лесенки нет по построению, а не по сглаживанию.

Не режется никогда (решение пользователя): Южный океан, Северный Ледовитый,
Средиземное море (оба бассейна), Чёрное и Азовское.

Запуск:  python build_ocean.py "North Atlantic Ocean"
"""
import csv, json, math, re, sys
from pathlib import Path
import numpy as np

WA = Path("D:/SteamLibrary/steamapps/workshop/content/394360/2149567872")
REPO = Path("D:/Pax Historia LOCAL/.claude/worktrees/sea-shelf-zones")
SCR = Path(__file__).parent
sys.path.insert(0, str(REPO / "scripts/map/build"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from shapely.geometry import shape, Polygon, MultiPolygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from geometry_cleanup import area_km2

NEVER_CUT = {"Southern Ocean", "Arctic Ocean", "Black Sea", "Sea of Azov",
             "Mediterranean Sea - Western Basin", "Mediterranean Sea - Eastern Basin"}

OCEAN = sys.argv[1] if len(sys.argv) > 1 else "North Atlantic Ocean"
SIMPLIFY_PX = 2.5          # упрощение контура в их пикселях (~28 км)
MIN_PIECE_KM2 = 25000

# получаем model, names, nav, terr, reg, seam из подгонки
exec(open(SCR / "warp_wa.py", encoding="utf-8").read().split("# --- переносим")[0])

if OCEAN in NEVER_CUT:
    raise SystemExit(f"{OCEAN} не режется по решению пользователя")

iho = [(f["properties"]["name"], f["properties"], shape(f["geometry"]))
       for f in json.load(open(REPO / "scripts/map/out/seas_iho_coastline.geojson",
                               encoding="utf-8"))["features"]]
iho = [(n, p, g if g.is_valid else g.buffer(0)) for n, p, g in iho]
target = next(g for n, p, g in iho if n == OCEAN)
tprops = next(p for n, p, g in iho if n == OCEAN)
print(f"режем: {OCEAN}, {tprops['area_km2']:,.0f} км²".replace(",", " "))

# --- какие их зоны вообще попадают в этот океан ---------------------------
H, W = reg.shape
SUB = 4
ys, xs = np.mgrid[0:H:SUB, 0:W:SUB]
flat = np.column_stack([xs.ravel(), ys.ravel()])
ll = model(flat)
rr = reg[::SUB, ::SUB].ravel(); ss = seam[::SUB, ::SUB].ravel()
keep = ss & np.isin(rr, list(nav))
LL, RR = ll[keep], rr[keep]
from shapely.prepared import prep
tp = prep(target.buffer(0.5))
inside = np.array([tp.contains(__import__("shapely").geometry.Point(x, y)) for x, y in LL])
cnt = {}
for rid in RR[inside]:
    cnt[int(rid)] = cnt.get(int(rid), 0) + 1
cands = [rid for rid, c in cnt.items() if c >= 6]
print(f"их зон, попадающих сюда: {len(cands)}")

# --- контуры их зон -> плавные полигоны у нас ------------------------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def zone_polygon(rid):
    m = (reg == rid) & seam
    ys_, xs_ = np.where(m)
    if len(xs_) < 30:
        return None
    x0, x1 = max(0, xs_.min() - 3), min(W, xs_.max() + 4)
    y0, y1 = max(0, ys_.min() - 3), min(H, ys_.max() + 4)
    sub = np.zeros((y1 - y0 + 6, x1 - x0 + 6), dtype=float)
    sub[3:-3, 3:-3] = m[y0:y1, x0:x1]
    fig = plt.figure(); ax = fig.add_subplot(111)
    cs = ax.contour(sub, levels=[0.5])
    segs = [s for s in cs.allsegs[0] if len(s) >= 4]
    plt.close(fig)
    rings = []
    for s in segs:
        pts = np.column_stack([s[:, 0] + x0 - 3, s[:, 1] + y0 - 3])
        ls = Polygon(pts).exterior if len(pts) > 3 else None
        if ls is None:
            continue
        simple = np.array(ls.simplify(SIMPLIFY_PX).coords)
        if len(simple) < 4:
            continue
        warped = model(simple)                      # <- деформация вершин
        try:
            poly = Polygon(warped)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty or poly.area <= 0:
                continue
            rings.append(poly)
        except Exception:
            continue
    if not rings:
        return None
    rings.sort(key=lambda g: -g.area)
    outer, holes = [], []
    for i, r in enumerate(rings):
        depth = sum(1 for j, o in enumerate(rings) if j != i and o.contains(r.representative_point()))
        (holes if depth % 2 else outer).append(r)
    g = unary_union(outer)
    if holes:
        g = g.difference(unary_union(holes))
    return g if not g.is_empty else None


pieces = []
for rid in cands:
    g = zone_polygon(rid)
    if g is None:
        continue
    g = g.intersection(target)
    if g.is_empty:
        continue
    a = area_km2(g)
    if a < MIN_PIECE_KM2:
        continue
    pieces.append([g, names[rid], terr[rid], a])
print(f"зон после обрезки океаном: {len(pieces)}")

# --- снять наложения: спорное достаётся зоне с большей долей ---------------
pieces.sort(key=lambda t: -t[3])
acc = None
for it in pieces:
    if acc is None:
        acc = it[0]
    else:
        it[0] = it[0].difference(acc)
        acc = unary_union([acc, it[0]])
pieces = [p for p in pieces if not p[0].is_empty and area_km2(p[0]) >= MIN_PIECE_KM2]

# --- остаток раздать ближайшему -------------------------------------------
covered = unary_union([p[0] for p in pieces])
left = target.difference(covered)
if not left.is_empty and area_km2(left) > 1:
    parts = list(left.geoms) if hasattr(left, "geoms") else [left]
    pt = STRtree([p[0] for p in pieces])
    add = {}
    for q in parts:
        c = [int(k) for k in pt.query(q.buffer(1.0))] or list(range(len(pieces)))
        j = min(c, key=lambda i: pieces[i][0].distance(q))
        add.setdefault(j, []).append(q)
    for j, qs in add.items():
        pieces[j][0] = unary_union([pieces[j][0]] + qs)
    print(f"остаток {area_km2(left):,.0f} км² ({len(parts)} кусков) роздан соседям".replace(",", " "))
for p in pieces:
    p[3] = area_km2(p[0])
pieces.sort(key=lambda t: -t[3])

land = [(p.get("iso_a2"), p.get("name"), shape(f["geometry"]))
        for f in json.load(open(REPO / "scripts/map/master/world_1946.master.geojson",
                                encoding="utf-8"))["features"]
        for p in [f["properties"]] if p.get("region_type") == "land"]
ltree = STRtree([g for _, _, g in land])
print("\n%-28s %-12s %12s %6s" % ("зона", "местность", "площадь км²", "приб."))
tot = 0
for g, nm, t, a in pieces:
    gb2 = g.buffer(0.02)
    c = sum(1 for k in ltree.query(gb2) if land[int(k)][2].intersects(gb2))
    tot += a
    print("%-28s %-12s %12.0f %6d" % (nm[:28], t, a, c))
print(f"\nзон {len(pieces)} | сумма {tot:,.0f} | океан {tprops['area_km2']:,.0f} | "
      f"разница {tot - tprops['area_km2']:,.0f} км²".replace(",", " "))

# --- рендер ---------------------------------------------------------------
from matplotlib.patches import Polygon as MplPoly
import matplotlib.patches as mp
PAL = {"shallow_sea": (126, 186, 222), "deep_ocean": (28, 68, 122),
       "fjords": (96, 150, 140), "ocean": (58, 116, 178), "southern_sea": (150, 170, 200)}
bb = target.bounds
fig, ax = plt.subplots(figsize=(17, 15))
ax.set_xlim(bb[0] - 2, bb[2] + 2); ax.set_ylim(bb[1] - 2, bb[3] + 2)
ax.set_aspect(1.0 / math.cos(math.radians((bb[1] + bb[3]) / 2)))
ax.set_facecolor("#eef3f7")
clip = box(bb[0] - 5, bb[1] - 5, bb[2] + 5, bb[3] + 5)
for iso, nm, g in land:
    if g.intersects(clip):
        gg = g.intersection(clip)
        for pp in (gg.geoms if hasattr(gg, "geoms") else [gg]):
            if pp.geom_type == "Polygon":
                ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                     facecolor="#d8d2c4", edgecolor="#b9b09c", lw=0.3))
rng = np.random.default_rng(12)
for g, nm, t, a in pieces:
    base = np.array(PAL.get(t, (58, 116, 178))) / 255.0
    col = np.clip(base * rng.uniform(0.82, 1.18), 0, 1)
    for pp in (g.geoms if hasattr(g, "geoms") else [g]):
        if pp.geom_type == "Polygon":
            ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                 facecolor=col, edgecolor="white", lw=1.1, alpha=0.93))
    c = g.representative_point()
    ax.annotate(nm, (c.x, c.y), ha="center", va="center", fontsize=7.5,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
ax.set_xticks([]); ax.set_yticks([])
ax.legend(handles=[mp.Patch(color=np.array(v) / 255, label=k) for k, v in PAL.items()],
          loc="lower left", fontsize=10)
ax.set_title(f"{OCEAN} -> {len(pieces)} зон по World Ablaze.\n"
             f"Границы — контуры их карты, прогнанные через деформацию: линии плавные.",
             fontsize=14)
out = SCR / ("ocean_" + re.sub(r"\W+", "_", OCEAN).lower() + ".png")
fig.tight_layout(); fig.savefig(out, dpi=120, bbox_inches="tight")
print("картинка:", out.name)
