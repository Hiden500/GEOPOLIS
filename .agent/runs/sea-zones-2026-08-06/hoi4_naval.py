#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Разбор морской карты HOI4 из установленной игры — ДЛЯ ИЗУЧЕНИЯ ПРИНЦИПА.
Ничего не копирует в проект: считает состав и рисует референс-картинку.
"""
import csv, re, sys
from collections import defaultdict
from pathlib import Path

H = Path(r"/d/SteamLibrary/steamapps/common/Hearts of Iron IV")
if not H.exists():
    H = Path(r"D:/SteamLibrary/steamapps/common/Hearts of Iron IV")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# --- провинции -------------------------------------------------------------
ptype, pcolor = {}, {}
with open(H / "map/definition.csv", encoding="latin-1") as f:
    for row in csv.reader(f, delimiter=";"):
        if len(row) < 8 or not row[0].isdigit():
            continue
        pid = int(row[0])
        pcolor[(int(row[1]), int(row[2]), int(row[3]))] = pid
        ptype[pid] = row[4]
print("провинций:", len(ptype), "| по типу:",
      {t: sum(1 for v in ptype.values() if v == t) for t in set(ptype.values())})

# --- стратегические регионы ------------------------------------------------
regs = {}
for p in sorted((H / "map/strategicregions").glob("*.txt")):
    txt = p.read_text(encoding="latin-1", errors="replace")
    rid = int(re.search(r"\bid\s*=\s*(\d+)", txt).group(1))
    prov = [int(x) for x in re.search(r"provinces\s*=\s*\{([^}]*)\}", txt, re.S).group(1).split()]
    nt = re.search(r"naval_terrain\s*=\s*(\w+)", txt)
    regs[rid] = dict(name=p.stem.split("-", 1)[-1], prov=prov,
                     naval_terrain=nt.group(1) if nt else None)
print("стратегических регионов:", len(regs))

naval, land_r, empty = [], [], []
for rid, r in regs.items():
    if not r["prov"]:
        empty.append(rid); continue
    sea = sum(1 for q in r["prov"] if ptype.get(q) == "sea")
    r["sea_share"] = sea / len(r["prov"])
    (naval if r["naval_terrain"] or r["sea_share"] > 0.5 else land_r).append(rid)
print(f"  морских: {len(naval)} | сухопутных: {len(land_r)} | пустых: {len(empty)}")
tt = defaultdict(int)
for rid in naval:
    tt[regs[rid]["naval_terrain"] or "(нет тега)"] += 1
print("  naval_terrain:", dict(tt))
sz = sorted((len(regs[r]["prov"]), regs[r]["name"]) for r in naval)
print(f"  провинций в морском регионе: мин {sz[0][0]} ({sz[0][1]}), "
      f"медиана {sz[len(sz)//2][0]}, макс {sz[-1][0]} ({sz[-1][1]})")

# --- растр провинций -> растр регионов -------------------------------------
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(H / "map/provinces.bmp").convert("RGB")
W, Hh = im.size
print(f"provinces.bmp: {W}x{Hh}")
import numpy as np
a = np.asarray(im, dtype=np.uint8)
key = (a[:, :, 0].astype(np.int32) << 16) | (a[:, :, 1].astype(np.int32) << 8) | a[:, :, 2]
lut = {}
for (r, g, b), pid in pcolor.items():
    lut[(r << 16) | (g << 8) | b] = pid
prov_of = np.zeros(key.shape, dtype=np.int32)
uniq = np.unique(key)
m = {k: lut.get(int(k), -1) for k in uniq}
prov_of = np.vectorize(m.get)(key).astype(np.int32)

reg_of_prov = {}
for rid, r in regs.items():
    for q in r["prov"]:
        reg_of_prov[q] = rid
reg = np.zeros(key.shape, dtype=np.int32)
mp = {q: reg_of_prov.get(q, 0) for q in np.unique(prov_of)}
reg = np.vectorize(mp.get)(prov_of).astype(np.int32)
is_sea = np.vectorize(lambda q: 1 if ptype.get(int(q)) == "sea" else 0)(prov_of).astype(np.uint8)
np.save("hoi4_reg.npy", reg); np.save("hoi4_sea.npy", is_sea)
print("растры сохранены")

# --- рендер ----------------------------------------------------------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

navalset = set(naval)
vis = np.zeros(reg.shape + (3,), dtype=np.uint8)
vis[...] = (216, 210, 196)                     # суша
rng = np.random.default_rng(7)
cols = {rid: rng.integers(60, 235, 3) for rid in navalset}
for rid in navalset:
    mask = (reg == rid) & (is_sea == 1)
    vis[mask] = cols[rid]
vis[(is_sea == 1) & ~np.isin(reg, list(navalset))] = (238, 243, 247)

fig, ax = plt.subplots(figsize=(26, 10))
ax.imshow(vis, interpolation="nearest")
for rid in navalset:
    ys, xs = np.where((reg == rid) & (is_sea == 1))
    if len(xs) < 400:
        continue
    ax.annotate(regs[rid]["name"], (xs.mean(), ys.mean()), ha="center", va="center",
                fontsize=5.4, color="#111",
                bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.65))
ax.set_xticks([]); ax.set_yticks([])
ax.set_title(f"Hearts of Iron IV — морские стратегические регионы ({len(naval)} шт.), "
             f"референс для изучения принципа границ", fontsize=15)
fig.tight_layout(); fig.savefig("hoi4_naval_reference.png", dpi=120, bbox_inches="tight")
print("картинка: hoi4_naval_reference.png")
