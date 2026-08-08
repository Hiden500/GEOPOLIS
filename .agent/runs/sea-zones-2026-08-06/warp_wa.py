#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Наложение морской карты World Ablaze на нашу — через деформацию по контрольным
точкам, а не через формулу проекции (её у HOI4 нет: карта нарисована под
геймплей, простая подгонка давала до 1456 км ошибки).

Контрольная точка = сухопутный регион WA с реальным именем. Слева его центр в
ИХ пикселях, справа центр того же места на НАШЕЙ карте. По набору таких пар
натягивается тонкопластинчатый сплайн, и качество меряется на отложенной
выборке, а не заявляется.
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

from shapely.geometry import shape
from shapely.ops import unary_union

# имя региона World Ablaze -> (наш ISO, диапазон широт, диапазон долгот)
CTRL = {
    "Iceland": ("IS", None, None), "Ireland": ("IE", None, None),
    "Portugal": ("PT", (36, 42), None), "Greece": ("GR", None, None),
    "Egypt": ("EG", None, None), "Libya": ("LY", None, None),
    "Tunisia": ("TN", None, None), "Morocco": ("MA", None, None),
    "Algeria": ("DZ", None, None), "Poland": ("PL", None, None),
    "Austria": ("AT", None, None), "Switzerland": ("CH", None, None),
    "Greenland": ("GL", None, None), "Madagascar": ("MG", None, None),
    "New Zealand": ("NZ", None, None), "Korea": ("KR", None, None),
    "Thailand": ("TH", None, None), "Burma": ("MM", None, None),
    "Afghanistan": ("AF", None, None), "Pakistan": ("PK", None, None),
    "Iraq": ("IQ", None, None), "Philippines": ("PH", None, None),
    "Tasmania": ("AU", (-44, -39), None), "Chile": ("CL", (-40, -18), None),
    "South Africa": ("ZA", None, None), "Scotland": ("GB", (55, 61), None),
    "Southern England": ("GB", (50, 53), None), "Northern England": ("GB", (53, 55.5), None),
    "Northern France": ("FR", (48.5, 51.5), None), "Southern France": ("FR", (42.5, 45.5), None),
    "Western France": ("FR", (45.5, 48.5), (-5, 1)),
    "Northern Spain": ("ES", (41, 44), None), "Southern Spain": ("ES", (36, 39), None),
    "Northern Italy": ("IT", (44, 47), None), "Southern Italy": ("IT", (37, 41), None),
    "Northern Norway": ("NO", (66, 71), None), "Southern Norway": ("NO", (58, 63), None),
    "Northern Sweden": ("SE", (64, 69), None), "Southern Sweden": ("SE", (55, 60), None),
    "Northern Finland": ("FI", (66, 70), None), "Southern Finland": ("FI", (60, 63), None),
    "New England": ("US", (42, 47), (-74, -68)), "Southeast Coast": ("US", (30, 34), (-82, -78)),
    "Southern US": ("US", (29, 34), (-95, -88)), "Central US": ("US", (37, 42), (-100, -92)),
    "California": ("US", (34, 41), None), "Alaska": ("US", (58, 68), (-160, -145)),
    "Manitoba": ("CA", (50, 58), (-100, -95)), "Alberta": ("CA", (50, 58), (-116, -111)),
    "Nunavut": ("CA", (63, 73), (-95, -80)), "South Québec": ("CA", (45, 49), (-74, -68)),
    "Canadian Maritimes": ("CA", (44, 47), (-66, -62)),
    "Yucatan Peninsula": ("MX", (18, 21), (-90, -87)),
    "Northern Brazil": ("BR", (-6, 0), (-50, -40)), "Southern Brazil": ("BR", (-30, -22), None),
    "Southern Tip": ("AR", (-55, -50), None), "Southern Cone": ("AR", (-38, -32), None),
    "Kamchatka": ("RU", (52, 60), (155, 162)), "Sakhalin": ("RU", (47, 54), (141, 144)),
    "Moscow Area": ("RU", (54, 58), (35, 40)), "Kola Peninsula": ("RU", (66, 69), (32, 40)),
    "Western India": ("IN", (18, 24), (70, 75)), "Southern India": ("IN", (8, 14), None),
    "Java": ("ID", (-9, -6), (105, 115)), "Sumatra": ("ID", (-4, 2), (97, 103)),
    "Northern Australia": ("AU", (-20, -12), (130, 140)),
    "South Eastern Australia": ("AU", (-38, -33), (144, 151)),
    "South Western Australia": ("AU", (-35, -30), (115, 120)),
    "Eastern China": ("CN", (30, 35), (117, 122)), "Southern China": ("CN", (22, 26), (110, 116)),
    "Northern Manchuria": ("CN", (46, 51), (123, 130)),
    "East Africa": ("KE", None, None), "Nigeria area": ("NG", None, None), "West Africa": ("GN", None, None),
    "Central Africa": ("CM", None, None), "South East Africa": ("MZ", None, None),
    "Western Sahara": ("EH", None, None), "Northern Levant": ("SY", None, None),
    "Asia minor": ("TR", (38, 41), (30, 36)), "Cyrenaica": ("LY", (30, 33), (20, 24)),
}

# Контрольные точки В ОТКРЫТОМ ОКЕАНЕ.
#
# Зачем: все точки выше стоят на материках и прибрежных островах, а сплайн вне
# их окружения ничем не удерживается. Замер 2026-08-07: зона `Hawaii` вышла в
# 1548 км от настоящих Гавайев, `West Polynesia` — вообще в Индийском океане.
# Медиана 141 км характеризовала контрольные точки, а не карту.
#
# Откуда брать: у 64 МОРСКИХ регионов WA внутри есть сухопутные провинции —
# это и есть острова. Точка слева = центр их СУШИ внутри морского региона.
#
# Что сюда не попало: `West Polynesia`, `Caroline Sea`, `Micronesian Islands`,
# `Wakean Atoll`, `Johnston Gap` — их имена не определяют острова однозначно, а
# неверная привязка имени уже стоила 1430 км ошибки. Лучше меньше точек, чем
# точка, тянущая карту не туда.
ISLAND_CTRL = {
    "Hawaii":             (("US",), (18, 23), (-161, -154)),
    "Azores Region":      (("PT",), (36, 40), (-32, -24)),
    "Cap Verde Plain":    (("CV",), None, None),
    "Sargasso Sea":       (("BM",), None, None),      # Бермуды — единственная суша
    "Marshall Islands":   (("MH",), None, None),
    "Mariana Islands":    (("GU", "MP"), None, None),
    "Solomon Islands":    (("SB",), None, None),
    "New Caledonia Basin": (("NC",), None, None),
}

# --- наши точки ------------------------------------------------------------
land = [(p.get("iso_a2"), p.get("name"), shape(f["geometry"]))
        for f in json.load(open(REPO / "scripts/map/master/world_1946.master.geojson",
                                encoding="utf-8"))["features"]
        for p in [f["properties"]] if p.get("region_type") == "land"]
ours = {}
_spec = {nm: ((iso,), latr, lonr) for nm, (iso, latr, lonr) in CTRL.items()}
_spec.update(ISLAND_CTRL)
for nm, (isos, latr, lonr) in _spec.items():
    sel = []
    for i2, n2, g in land:
        if i2 not in isos:
            continue
        c = g.representative_point()
        if latr and not (latr[0] <= c.y <= latr[1]):
            continue
        if lonr and not (lonr[0] <= c.x <= lonr[1]):
            continue
        sel.append(g)
    if sel:
        c = unary_union(sel).centroid
        ours[nm] = (c.x, c.y)
    elif nm in ISLAND_CTRL:
        print(f"  ВНИМАНИЕ: островной якорь {nm} не найден в нашем слое — пропущен")
print(f"контрольных точек с нашей стороны: {len(ours)} из {len(_spec)} "
      f"(в т.ч. океанских островов: {sum(1 for n in ISLAND_CTRL if n in ours)})")

# --- их точки --------------------------------------------------------------
INT = re.compile(r"^\d+$")
ptype = {}; pcol = {}
for row in csv.reader(open(WA / "map/definition.csv", encoding="latin-1"), delimiter=";"):
    if len(row) >= 5 and INT.match(row[0]):
        ptype[int(row[0])] = row[4]
        pcol[(int(row[1]) << 16) | (int(row[2]) << 8) | int(row[3])] = int(row[0])
names = {}; regof = {}; nav = set(); terr = {}
for p in (WA / "map/strategicregions").glob("*.txt"):
    t = p.read_text(encoding="latin-1", errors="replace")
    rid = int(re.search(r"\bid\s*=\s*(\d+)", t).group(1))
    names[rid] = p.stem.split("-", 1)[-1]
    m = re.search(r"provinces\s*=\s*\{([^}]*)\}", t, re.S)
    prov = [int(x) for x in (m.group(1).split() if m else []) if INT.match(x)]
    for q in prov:
        regof[q] = rid
    nt = re.search(r"naval_terrain\s*=\s*(\w+)", t)
    sea = sum(1 for q in prov if ptype.get(q) == "sea")
    if nt or (prov and sea / max(1, len(prov)) > 0.5):
        nav.add(rid); terr[rid] = nt.group(1).replace("water_", "") if nt else "ocean"

reg = np.load(SCR / "wa_reg.npy"); seam = np.load(SCR / "wa_sea.npy")
H, W = reg.shape
by = {}
for rid, nm in names.items():
    if nm not in ours:
        continue
    # У островного якоря берём центр СУШИ внутри морского региона, а не всего
    # региона: центр региона стоит в открытой воде и островом не является.
    m = (reg == rid) & (~seam if nm in ISLAND_CTRL else True)
    ys, xs = np.where(m)
    if len(xs):
        by[nm] = (xs.mean(), ys.mean())
pairs = [(by[n], ours[n]) for n in by]
print(f"пар для подгонки: {len(pairs)} "
      f"(океанских островов среди них: {sum(1 for n in by if n in ISLAND_CTRL)})")

from scipy.interpolate import RBFInterpolator
P = np.array([p[0] for p in pairs]); Q = np.array([p[1] for p in pairs])

def fit(idx):
    return RBFInterpolator(P[idx], Q[idx], kernel="thin_plate_spline", smoothing=1.0)

# честная проверка: каждая точка предсказывается моделью, обученной БЕЗ неё
err = []
for i in range(len(P)):
    idx = [j for j in range(len(P)) if j != i]
    pred = fit(idx)(P[i:i+1])[0]
    dx = (pred[0] - Q[i][0]) * 111 * math.cos(math.radians((pred[1] + Q[i][1]) / 2))
    dy = (pred[1] - Q[i][1]) * 111
    err.append(math.hypot(dx, dy))
err = np.array(err)
print(f"до чистки: медиана {np.median(err):.0f} км | худшая {err.max():.0f} км")

# Точка, которую модель по остальным 74 предсказывает с ошибкой в тысячи км, —
# это почти наверняка МОЯ неверная привязка имени, а не провал деформации.
# Отбрасываем такие и говорим, сколько отброшено, а не прячем.
names_ctrl = list(by)
DROP_KM = 800.0

# Островной якорь нельзя судить по leave-one-out: он ОДИН в своей части океана,
# и модель без него там ничем не удерживается — большая ошибка неизбежна по
# построению, а не по вине привязки. Первый прогон с островами это и показал:
# фильтр выбросил Гавайи, ровно ту точку, ради которой они добавлялись.
#
# Настоящую ошибку привязки (Полинезия, уехавшая в Индийский океан) ловит
# другое: она видна даже грубому линейному приближению карты. Порог щедрый —
# `hoi4_fit.py` показал, что линейная модель сама врёт до 1456 км, поэтому
# наказываем только за промах в разы больший, чем её собственная ошибка.
LINEAR_DROP_KM = 2500.0
_A = np.column_stack([P, np.ones(len(P))])
_cx, _, _, _ = np.linalg.lstsq(_A, Q[:, 0], rcond=None)
_cy, _, _, _ = np.linalg.lstsq(_A, Q[:, 1], rcond=None)
lin_err = []
for i in range(len(P)):
    px, py = _A[i] @ _cx, _A[i] @ _cy
    dx = (px - Q[i][0]) * 111 * math.cos(math.radians((py + Q[i][1]) / 2))
    lin_err.append(math.hypot(dx, (py - Q[i][1]) * 111))
lin_err = np.array(lin_err)

keep, dropped = [], []
for i in range(len(P)):
    isle = names_ctrl[i] in ISLAND_CTRL
    limit = LINEAR_DROP_KM if isle else DROP_KM
    val = lin_err[i] if isle else err[i]
    (keep if val <= limit else dropped).append(i)
print(f"отброшено {len(dropped)} точек: "
      + ", ".join(f"{names_ctrl[i]} ({'линейно ' if names_ctrl[i] in ISLAND_CTRL else ''}"
                  f"{(lin_err[i] if names_ctrl[i] in ISLAND_CTRL else err[i]):.0f} км)"
                  for i in dropped))
_isles = [i for i in keep if names_ctrl[i] in ISLAND_CTRL]
if _isles:
    print("островные якоря (их leave-one-out велик по построению, это не брак):")
    for i in _isles:
        print(f"   {names_ctrl[i]:22s} leave-one-out {err[i]:6.0f} км | "
              f"линейная согласованность {lin_err[i]:6.0f} км")
dropped = [names_ctrl[i] for i in dropped]
P = P[keep]; Q = Q[keep]; names_ctrl = [names_ctrl[i] for i in keep]
err = []
for i in range(len(P)):
    idx = [j for j in range(len(P)) if j != i]
    pred = fit(idx)(P[i:i+1])[0]
    dx = (pred[0] - Q[i][0]) * 111 * math.cos(math.radians((pred[1] + Q[i][1]) / 2))
    dy = (pred[1] - Q[i][1]) * 111
    err.append(math.hypot(dx, dy))
err = np.array(err)
print(f"после чистки ({len(P)} точек): медиана {np.median(err):.0f} км | "
      f"75%% {np.percentile(err,75):.0f} | худшая {err.max():.0f} км")
worst = np.argsort(-err)[:4]
print("  худшие:", ", ".join(f"{names_ctrl[i]} {err[i]:.0f}км" for i in worst))
model = fit(list(range(len(P))))

# --- переносим их морскую карту на наши координаты -------------------------
SUB = 3
ys, xs = np.mgrid[0:H:SUB, 0:W:SUB]
flat = np.column_stack([xs.ravel(), ys.ravel()])
ll = model(flat)
rr = reg[::SUB, ::SUB].ravel(); ss = seam[::SUB, ::SUB].ravel()
keep = ss & np.isin(rr, list(nav))
LL = ll[keep]; RR = rr[keep]
print(f"морских точек перенесено: {len(RR)}")

json.dump({"median_km": float(np.median(err)), "max_km": float(err.max()),
           "n_ctrl": len(P)}, open(SCR / "warp_quality.json", "w"), indent=1)

# --- рендер: их зоны в наших координатах поверх нашей суши -----------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPoly
from shapely.geometry import box as shp_box

iho = [(f["properties"]["name"], shape(f["geometry"]))
       for f in json.load(open(REPO / "scripts/map/out/seas_iho_coastline.geojson",
                               encoding="utf-8"))["features"]]
na = next(g for n, g in iho if n == "North Atlantic Ocean")
bb = na.bounds

fig, axes = plt.subplots(1, 2, figsize=(24, 13))
for ax in axes:
    ax.set_xlim(bb[0] - 3, bb[2] + 3); ax.set_ylim(bb[1] - 3, bb[3] + 3)
    ax.set_aspect(1.0 / math.cos(math.radians((bb[1] + bb[3]) / 2)))
    ax.set_facecolor("#eef3f7"); ax.set_xticks([]); ax.set_yticks([])
    clip = shp_box(bb[0] - 6, bb[1] - 6, bb[2] + 6, bb[3] + 6)
    for iso, nm, g in land:
        if g.intersects(clip):
            for pp in (g.intersection(clip).geoms if hasattr(g.intersection(clip), "geoms")
                       else [g.intersection(clip)]):
                if pp.geom_type == "Polygon":
                    ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                         facecolor="#d8d2c4", edgecolor="#b9b09c", lw=0.3))

rng = np.random.default_rng(4)
cols = {rid: rng.uniform(0.25, 0.95, 3) for rid in nav}
m = ((LL[:, 0] > bb[0] - 3) & (LL[:, 0] < bb[2] + 3) &
     (LL[:, 1] > bb[1] - 3) & (LL[:, 1] < bb[3] + 3))
axes[0].scatter(LL[m, 0], LL[m, 1], c=[cols[r] for r in RR[m]], s=1.6, marker="s", linewidths=0)
for rid in set(RR[m]):
    sel = LL[m][RR[m] == rid]
    if len(sel) < 90:
        continue
    axes[0].annotate(names[rid], (sel[:, 0].mean(), sel[:, 1].mean()), ha="center", va="center",
                     fontsize=6.5, bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.72))
axes[0].set_title("World Ablaze, перенесённый на наши координаты\n"
                  f"({len(P)} контрольных точек, медианная ошибка {np.median(err):.0f} км)", fontsize=13)

for n, g in iho:
    if g.intersects(shp_box(bb[0]-3, bb[1]-3, bb[2]+3, bb[3]+3)):
        for pp in (g.geoms if hasattr(g, "geoms") else [g]):
            if pp.geom_type == "Polygon":
                axes[1].add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                          facecolor="#cfe3f2", edgecolor="#2c6ea8", lw=0.8, alpha=0.85))
axes[1].scatter(LL[m, 0], LL[m, 1], c="#c1121f", s=0.7, marker=".", linewidths=0, alpha=0.30)
axes[1].set_title("Их зоны (красная крошка) поверх наших 101 зоны IHO —\nвидно, где они режут, а мы нет",
                  fontsize=13)
fig.tight_layout(); fig.savefig(SCR / "wa_overlay.png", dpi=118, bbox_inches="tight")
print("картинка: wa_overlay.png")
