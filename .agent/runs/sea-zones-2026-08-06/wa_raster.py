#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пересборка растров карты World Ablaze: wa_reg.npy (номер стратегического
региона в каждом пикселе) и wa_sea.npy (пиксель — море).

Кэши не хранятся в git (46 МБ), поэтому нужны каждой свежей сессии.
`warp_wa.py` и `build_ocean.py` без них не стартуют.

Отличие от растрового блока `hoi4_naval.py`: там перевод цвета в id идёт через
`np.vectorize` по всей картинке — на карте WA (~11 тыс. px в ширину) это часы.
Здесь тот же перевод сделан таблицей на 2^24 элемента: один индексный проход.

Запуск:  python wa_raster.py
"""
import csv, re, sys
from pathlib import Path

import numpy as np

WA = Path("D:/SteamLibrary/steamapps/workshop/content/394360/2149567872")
SCR = Path(__file__).parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

INT = re.compile(r"^\d+$")

# --- провинции: цвет -> id, id -> тип --------------------------------------
ptype = {}
color_key, color_pid = [], []
for row in csv.reader(open(WA / "map/definition.csv", encoding="latin-1"), delimiter=";"):
    if len(row) >= 5 and INT.match(row[0]):
        pid = int(row[0])
        ptype[pid] = row[4]
        color_key.append((int(row[1]) << 16) | (int(row[2]) << 8) | int(row[3]))
        color_pid.append(pid)
print(f"провинций: {len(ptype)} | морских: {sum(1 for v in ptype.values() if v == 'sea')}")

# --- стратегические регионы -------------------------------------------------
reg_of_prov = {}
nreg = 0
for p in (WA / "map/strategicregions").glob("*.txt"):
    t = p.read_text(encoding="latin-1", errors="replace")
    m_id = re.search(r"\bid\s*=\s*(\d+)", t)
    if not m_id:
        continue
    rid = int(m_id.group(1))
    nreg += 1
    m = re.search(r"provinces\s*=\s*\{([^}]*)\}", t, re.S)
    for x in (m.group(1).split() if m else []):
        if INT.match(x):
            reg_of_prov[int(x)] = rid
print(f"стратегических регионов: {nreg} | провинций в них: {len(reg_of_prov)}")

# --- растр ------------------------------------------------------------------
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(WA / "map/provinces.bmp").convert("RGB")
W, H = im.size
print(f"provinces.bmp: {W}x{H}")
a = np.asarray(im, dtype=np.uint8)
key = ((a[:, :, 0].astype(np.int32) << 16)
       | (a[:, :, 1].astype(np.int32) << 8)
       | a[:, :, 2].astype(np.int32))

# таблица на все 2^24 цвета: 0 = цвета нет в definition.csv
pid_lut = np.zeros(1 << 24, dtype=np.int32)
pid_lut[np.array(color_key, dtype=np.int64)] = np.array(color_pid, dtype=np.int32)
prov_of = pid_lut[key]

max_pid = max(ptype) + 1
reg_lut = np.zeros(max_pid, dtype=np.int32)
sea_lut = np.zeros(max_pid, dtype=bool)
for pid, t in ptype.items():
    reg_lut[pid] = reg_of_prov.get(pid, 0)
    sea_lut[pid] = (t == "sea")
clipped = np.clip(prov_of, 0, max_pid - 1)
reg = np.where(prov_of > 0, reg_lut[clipped], 0).astype(np.int32)
sea = np.where(prov_of > 0, sea_lut[clipped], False)

unknown = int((prov_of == 0).sum())
print(f"пикселей без провинции: {unknown} ({unknown / key.size * 100:.3f}%)")
print(f"пикселей моря: {int(sea.sum())} ({sea.sum() / key.size * 100:.1f}%)")
print(f"регионов, реально встретившихся на растре: {len(set(np.unique(reg).tolist())) - 1}")

np.save(SCR / "wa_reg.npy", reg)
np.save(SCR / "wa_sea.npy", sea)
print("сохранено: wa_reg.npy, wa_sea.npy")
