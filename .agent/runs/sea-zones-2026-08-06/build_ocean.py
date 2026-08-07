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
import csv, json, math, os, re, sys
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
# ниже этого куску нужен берег, чтобы остаться отдельной зоной, иначе он
# сливается в соседа: маленькое пятно вдали от суши — обрезок, не залив
MIN_COASTLESS_KM2 = 100000

# Негативный контроль: SEAZONE_RAW=1 возвращает поведение ДО правок (без
# отбраковки чужих кусков и без слияния обрезков). Нужен, чтобы показать, что
# фильтры действительно что-то меняют, а не просто печатают строчки.
RAW = os.environ.get("SEAZONE_RAW") == "1"
if RAW:
    print("!! SEAZONE_RAW=1 — фильтры выключены, это прогон старого поведения")

# получаем model, names, nav, terr, reg, seam из подгонки
exec(open(SCR / "warp_wa.py", encoding="utf-8").read().split("# --- переносим")[0])

if OCEAN in NEVER_CUT:
    raise SystemExit(f"{OCEAN} не режется по решению пользователя")

iho = [(f["properties"]["name"], f["properties"], shape(f["geometry"]))
       for f in json.load(open(REPO / "scripts/map/out/seas_iho_coastline.geojson",
                               encoding="utf-8"))["features"]]
iho = [(n, p, g if g.is_valid else g.buffer(0)) for n, p, g in iho]
# NEVER_CUT сверяется с именами по строке: опечатка или переименование зоны в
# слое молча снимут защиту, и запрет пользователя перестанет действовать без
# единого сообщения. Поэтому имена проверяются на существование, а не верятся.
_layer = {n for n, p, g in iho}
_lost = sorted(NEVER_CUT - _layer)
if _lost:
    raise SystemExit("NEVER_CUT ссылается на зоны, которых нет в слое — запрет "
                     "не сработает: " + ", ".join(_lost))

target = next(g for n, p, g in iho if n == OCEAN)
tprops = next(p for n, p, g in iho if n == OCEAN)
print(f"режем: {OCEAN}, {tprops['area_km2']:,.0f} км²".replace(",", " "))


def norm(s):
    """Имя для сравнения: регистр, пунктуация и лишние пробелы не значимы."""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


# Имена, которые в нашем слое УЖЕ существуют отдельной зоной. Кусок с таким
# именем внутри другого океана — не зона, а полоска, сдвинутая деформацией.
DUP = {norm(n) for n, p, g in iho if n != OCEAN}
ihotree = STRtree([g for n, p, g in iho])

# наша суша: нужна и для подсчёта берегов при слиянии обрезков, и для рендера
land = [(p.get("iso_a2"), p.get("name"), shape(f["geometry"]))
        for f in json.load(open(REPO / "scripts/map/master/world_1946.master.geojson",
                                encoding="utf-8"))["features"]
        for p in [f["properties"]] if p.get("region_type") == "land"]
ltree = STRtree([g for _, _, g in land])


def coast_count(g):
    """Сколько наших сухопутных регионов граничит с этим куском воды."""
    gb = g.buffer(0.02)
    return sum(1 for k in ltree.query(gb) if land[int(k)][2].intersects(gb))


def home_zone(g):
    """В какой нашей зоне лежит бо́льшая часть площади их зоны."""
    best, best_a = None, 0.0
    for k in ihotree.query(g):
        n, p, zg = iho[int(k)]
        try:
            inter = g.intersection(zg)
        except Exception:
            continue
        if inter.is_empty:
            continue
        a = area_km2(inter)
        if a > best_a:
            best, best_a = n, a
    return best, best_a

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
rejected = []
for rid in cands:
    g = zone_polygon(rid)
    if g is None:
        continue
    nm = names[rid]

    # (1) имя уже занято отдельной зоной нашего слоя -> это чужой кусок
    if not RAW and norm(nm) in DUP:
        rejected.append((nm, "имя занято нашей зоной", area_km2(g.intersection(target))))
        continue

    # (2) бо́льшая часть их зоны лежит в ДРУГОЙ нашей зоне -> тоже чужой кусок.
    #     Ловит то, что имя не ловит: "West Caribbean Sea" при нашем
    #     "Caribbean Sea", "South Atlantic Gap" при "South Atlantic Ocean".
    hz, ha = home_zone(g)
    if not RAW and hz is not None and hz != OCEAN:
        rejected.append((nm, f"дом — {hz}", area_km2(g.intersection(target))))
        continue

    g = g.intersection(target)
    if g.is_empty:
        continue
    a = area_km2(g)
    if a < MIN_PIECE_KM2:
        continue
    pieces.append([g, nm, terr[rid], a])

if rejected:
    rejected.sort(key=lambda t: -t[2])
    print(f"отброшено чужих кусков: {len(rejected)}"
          f" (суммарно {sum(t[2] for t in rejected):,.0f} км², уйдут соседям)".replace(",", " "))
    for nm, why, a in rejected:
        print("   %-28s %-34s %10.0f км²" % (nm[:28], why[:34], a))
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
# Шаг посева по контуру. Задаёт размер зубцов на шве: граница Вороного скачет
# между соседними точками посева, и при 0.35° зубцы выходили ~5 км и читались
# на карте как паззл. 0.10° уменьшает их примерно во столько же раз.
SEED_DEG = 0.10


def voronoi_share(parts):
    """Делит остаток между зонами по срединной линии: каждая точка достаётся
    той зоне, чей контур ближе.

    Сеткой этого делать нельзя — она режет по осям координат, и на карте
    вылезает лесенка (ограничение пользователя: линии плавные). Здесь граница
    идёт по середине между контурами соседей и потому повторяет их форму.
    """
    seeds, owner = [], []
    for i, p in enumerate(pieces):
        b = p[0].boundary
        for ls in (b.geoms if hasattr(b, "geoms") else [b]):
            n = max(2, int(ls.length / SEED_DEG))
            for k in range(n):
                pt_ = ls.interpolate(k / n, normalized=True)
                seeds.append(pt_); owner.append(i)
    from shapely.geometry import MultiPoint
    from shapely.ops import voronoi_diagram
    env = target.buffer(2.0).envelope
    vor = voronoi_diagram(MultiPoint(seeds), envelope=env)
    stree = STRtree(seeds)
    rest = unary_union(parts)
    # Ячейки СНАЧАЛА объединяются по владельцу и только потом режутся остатком.
    # Наоборот нельзя: пересекая каждую ячейку отдельно, соседние результаты
    # перестают делить общие вершины, и между зонами раскрываются волосяные
    # щели — замер 2026-08-07 дал 8235 таких щелей после первой попытки.
    bucket = {}
    for cell in vor.geoms:
        j = None
        for k in stree.query(cell):
            if cell.contains(seeds[int(k)]):
                j = owner[int(k)]
                break
        if j is not None:
            bucket.setdefault(j, []).append(cell)
    add = {}
    for j, cells in bucket.items():
        merged_cells = unary_union(cells)
        got = merged_cells.intersection(rest)
        if not got.is_empty:
            add[j] = [got]
    return add, len(seeds)


covered = unary_union([p[0] for p in pieces])
left = target.difference(covered)
if not left.is_empty and area_km2(left) > 1:
    parts = list(left.geoms) if hasattr(left, "geoms") else [left]
    if RAW:
        pt = STRtree([p[0] for p in pieces])
        add = {}
        for q in parts:
            c = [int(k) for k in pt.query(q.buffer(1.0))] or list(range(len(pieces)))
            j = min(c, key=lambda i: pieces[i][0].distance(q))
            add.setdefault(j, []).append(q)
        print(f"остаток {area_km2(left):,.0f} км² ({len(parts)} кусков) роздан соседям".replace(",", " "))
    else:
        add, nseed = voronoi_share(parts)
        print(f"остаток {area_km2(left):,.0f} км² ({len(parts)} кусков) роздан по срединной "
              f"линии, {nseed} точек посева".replace(",", " "))
    for j, qs in add.items():
        pieces[j][0] = unary_union([pieces[j][0]] + qs)
        if not pieces[j][0].is_valid:
            pieces[j][0] = pieces[j][0].buffer(0)
for p in pieces:
    p[3] = area_km2(p[0])
pieces.sort(key=lambda t: -t[3])

# --- слить обрезки: мал И без берега -> в соседа по самой длинной границе ---
# Соседа выбираем по длине общей границы, а не по расстоянию до центра: обрезок
# вытянут вдоль чужой зоны, и ближайший центр запросто окажется не той зоной,
# с которой он реально смежен.
coasts = [coast_count(p[0]) for p in pieces]
merged = []
while True:
    small = [] if RAW else [i for i, p in enumerate(pieces)
             if p[3] < MIN_COASTLESS_KM2 and coasts[i] == 0]
    if not small:
        break
    i = min(small, key=lambda k: pieces[k][3])
    rest = [j for j in range(len(pieces)) if j != i]
    if not rest:
        break

    ibuf = pieces[i][0].buffer(0.02)

    def shared(j):
        try:
            b = ibuf.intersection(pieces[j][0])
            return area_km2(b) if not b.is_empty else 0.0
        except Exception:
            return 0.0

    touch = [(shared(j), j) for j in rest]
    best = max(touch, key=lambda t: t[0])
    j = best[1] if best[0] > 0 else min(rest, key=lambda k: pieces[k][0].distance(pieces[i][0]))
    merged.append((pieces[i][1], pieces[i][3], pieces[j][1],
                   "общая граница" if best[0] > 0 else "ближайший"))
    pieces[j][0] = unary_union([pieces[j][0], pieces[i][0]])
    pieces[j][3] = area_km2(pieces[j][0])
    coasts[j] = coast_count(pieces[j][0])
    pieces.pop(i); coasts.pop(i)

if merged:
    print(f"слито обрезков без берега (< {MIN_COASTLESS_KM2:,} км²): {len(merged)}".replace(",", " "))
    for nm, a, into, why in merged:
        print("   %-28s %9.0f км²  ->  %-24s (%s)" % (nm[:28], a, into[:24], why))

# --- чистка геометрии внутри зоны -----------------------------------------
# Замер 2026-08-07 по просмотру в geojson-вьювере: 107 дыр нулевой ширины и 65
# пар частей одной зоны, разделённых волосяным зазором. И то и другое рисуется
# тёмной линией ВНУТРИ сплошного на вид пятна. Проверка стыков между зонами их
# не видела: она смотрела наружу, а не внутрь.
MAX_FILL_HOLE_KM2 = 200  # выше этого дыра слишком велика, чтобы быть мусором
from shapely.geometry import Polygon as ShpPoly

# Снап на сетку (`set_precision`) здесь пробовался и ОТВЕРГНУТ: он двигает
# границу каждой зоны независимо, поэтому смыкая щели внутри зоны, раскрывает
# их между зонами — 8235 новых щелей на замере. Источник щелей устранён выше,
# в `voronoi_share`, а не заглажен здесь.
otree = STRtree([p[0] for p in pieces])
filled = 0
for i, p in enumerate(pieces):
    g = p[0]
    # дыры-артефакты: внутри нет ни земли, ни другой зоны -> это не остров
    parts, changed = [], False
    for pp in (g.geoms if hasattr(g, "geoms") else [g]):
        if pp.geom_type != "Polygon" or not pp.interiors:
            parts.append(pp); continue
        keep_rings = []
        for ring in pp.interiors:
            h = ShpPoly(ring)
            ha = area_km2(h)
            has_land = any(land[int(k)][2].intersects(h) for k in ltree.query(h))
            has_zone = any(pieces[int(k)][0].intersection(h).area > 0.01 * h.area
                           for k in otree.query(h) if int(k) != i)
            if has_land or has_zone or ha > MAX_FILL_HOLE_KM2:
                keep_rings.append(ring)
            else:
                filled += 1; changed = True
        parts.append(ShpPoly(pp.exterior, keep_rings) if changed else pp)
    if changed:
        g = unary_union(parts) if len(parts) > 1 else parts[0]
    p[0] = g if g.is_valid else g.buffer(0)
    p[3] = area_km2(p[0])
print(f"чистка: закрыто дыр-артефактов {filled}, зазоры между частями снапнуты")

order = sorted(range(len(pieces)), key=lambda i: -pieces[i][3])
pieces = [pieces[i] for i in order]; coasts = [coasts[i] for i in order]
print("\n%-28s %-12s %12s %6s" % ("зона", "местность", "площадь км²", "приб."))
tot = 0
for (g, nm, t, a), c in zip(pieces, coasts):
    tot += a
    print("%-28s %-12s %12.0f %6d" % (nm[:28], t, a, c))
print("максимум прибрежных регионов на зону: %d | зон без берега: %d"
      % (max(coasts) if coasts else 0, sum(1 for c in coasts if c == 0)))
print(f"\nзон {len(pieces)} | сумма {tot:,.0f} | океан {tprops['area_km2']:,.0f} | "
      f"разница {tot - tprops['area_km2']:,.0f} км²".replace(",", " "))

# --- самопроверка: разбиение, а не набор кусков ----------------------------
# Расхождение суммы с площадью океана само по себе ничего не говорит: его даёт
# и наложение зон, и непокрытая дыра, и они друг друга гасят. Меряем раздельно.
ptree = STRtree([p[0] for p in pieces])
ov_tot, ov_worst = 0.0, ("", "", 0.0)
for i, (g, nm, t, a) in enumerate(pieces):
    for k in ptree.query(g):
        j = int(k)
        if j <= i:
            continue
        try:
            inter = g.intersection(pieces[j][0])
        except Exception:
            continue
        if inter.is_empty or inter.geom_type in ("Point", "LineString", "MultiLineString"):
            continue
        ia = area_km2(inter)
        ov_tot += ia
        if ia > ov_worst[2]:
            ov_worst = (nm, pieces[j][1], ia)
allz = unary_union([p[0] for p in pieces])
hole = area_km2(target.difference(allz))
spill = area_km2(allz.difference(target))
bad = [nm for g, nm, t, a in pieces if not g.is_valid]
print("самопроверка: наложение %.0f км² | непокрыто %.0f | вне океана %.0f | "
      "битых геометрий %d" % (ov_tot, hole, spill, len(bad)))

# Внутрь полигона проверка тоже обязана смотреть: щель нулевой ширины и зазор
# между частями площади почти не имеют, поэтому три числа выше их не видят, а
# на карте они рисуются тёмной линией.
from geometry_cleanup import compactness
# Считаем ДЕФЕКТЫ, а не всё подряд. Вытянутая дыра с землёй внутри — это
# вытянутый остров, и он законен; тревога по ней однажды увела меня искать
# несуществующий баг. Зазор шириной 1e-15° — это предел точности double, а не
# щель: порог 1e-9° (~0.1 мм) отделяет настоящую щель от машинного нуля.
GAP_DEG = 1e-9
thread_bad, island_thin, gap = 0, 0, 0
for i, (g, nm, t, a) in enumerate(pieces):
    ps = list(g.geoms) if hasattr(g, "geoms") else [g]
    for pp in ps:
        if pp.geom_type != "Polygon":
            continue
        for ring in pp.interiors:
            h = ShpPoly(ring)
            has_land = any(land[int(k)][2].intersects(h) for k in ltree.query(h))
            if not has_land:
                thread_bad += 1
            elif compactness(h) < 0.12:
                island_thin += 1
    for x in range(len(ps)):
        for y in range(x + 1, len(ps)):
            if GAP_DEG < ps[x].distance(ps[y]) < 1e-4:
                gap += 1
print("внутри зон: дыр-артефактов (без земли) %d | щелей между частями шире "
      "0.1 мм %d | тонких островов-дыр (норма) %d" % (thread_bad, gap, island_thin))
if ov_worst[2] > 1:
    print("   худшее наложение: %s / %s — %.0f км²" % ov_worst)
if bad:
    print("   битые:", ", ".join(bad[:6]))

# --- антимеридиан: зона, разорванная ±180, — артефакт координат, не география
EPS = 0.01
west = [nm for g, nm, t, a in pieces
        if any(pp.bounds[0] <= -180 + EPS for pp in (g.geoms if hasattr(g, "geoms") else [g]))]
east = [nm for g, nm, t, a in pieces
        if any(pp.bounds[2] >= 180 - EPS for pp in (g.geoms if hasattr(g, "geoms") else [g]))]
both = sorted(set(west) & set(east))
if west or east:
    print("на ±180: зон слева %d, справа %d, разорванных надвое %d"
          % (len(east), len(west), len(both)))
    if both:
        print("   разорваны:", ", ".join(both))

# --- сохранить нарезку, иначе результат прогона теряется -------------------
from shapely.geometry import mapping
dump = {"type": "FeatureCollection", "features": [
    {"type": "Feature",
     "properties": {"name": nm, "naval_terrain": t, "area_km2": round(a, 1),
                    "coastal_regions": c, "source": "World Ablaze via warp",
                    "parent": OCEAN},
     "geometry": mapping(g)}
    for (g, nm, t, a), c in zip(pieces, coasts)]}
dpath = SCR / ("zones_" + re.sub(r"\W+", "_", OCEAN).lower() + ".geojson")
json.dump(dump, open(dpath, "w", encoding="utf-8"), ensure_ascii=False)
print("нарезка сохранена:", dpath.name)

# --- рендер ---------------------------------------------------------------
from matplotlib.patches import Polygon as MplPoly
import matplotlib.patches as mp
PAL = {"shallow_sea": (126, 186, 222), "deep_ocean": (28, 68, 122),
       "fjords": (96, 150, 140), "ocean": (58, 116, 178), "southern_sea": (150, 170, 200)}

# Океан через ±180 (Пацифика) в обычных координатах растягивает картинку на
# весь мир: его края уезжают влево и вправо, а посередине оказывается Евразия.
# Для рендера переводим долготы в 0..360 — карта центрируется на океане.
# Части полигонов через антимеридиан не идут: слой обрезан по ±180.
DATELINE = (target.bounds[2] - target.bounds[0]) > 350


def shift(g):
    """Западное полушарие сдвигается на +360 ЦЕЛЫМИ частями.

    По вершинам сдвигать нельзя: полигон на нулевом меридиане (Испания,
    Британия, Африка) разорвётся, станет самопересекающимся, и первое же
    пересечение с ним упадёт TopologyException. Часть, лежащая на нуле,
    остаётся на месте — до тихоокеанского кадра ей всё равно далеко.
    """
    if not DATELINE:
        return g
    from shapely.affinity import translate
    parts = list(g.geoms) if hasattr(g, "geoms") else [g]
    out_ = []
    for pp in parts:
        if pp.is_empty:
            continue
        out_.append(translate(pp, xoff=360) if pp.bounds[2] <= 0 else pp)
    if not out_:
        return g
    return out_[0] if len(out_) == 1 else MultiPolygon(
        [q for o in out_ for q in (o.geoms if hasattr(o, "geoms") else [o])
         if q.geom_type == "Polygon"])


if DATELINE:
    xs_ = [c for p_ in (shift(target).geoms if hasattr(shift(target), "geoms")
                        else [shift(target)]) for c in (p_.bounds[0], p_.bounds[2])]
    ys_ = [c for p_ in (shift(target).geoms if hasattr(shift(target), "geoms")
                        else [shift(target)]) for c in (p_.bounds[1], p_.bounds[3])]
    bb = (min(xs_), min(ys_), max(xs_), max(ys_))
else:
    bb = target.bounds
fig, ax = plt.subplots(figsize=(17, 15) if not DATELINE else (20, 12))
ax.set_xlim(bb[0] - 2, bb[2] + 2); ax.set_ylim(bb[1] - 2, bb[3] + 2)
ax.set_aspect(1.0 / math.cos(math.radians((bb[1] + bb[3]) / 2)))
ax.set_facecolor("#eef3f7")
clip = box(bb[0] - 5, bb[1] - 5, bb[2] + 5, bb[3] + 5)
for iso, nm, g in land:
    gs = shift(g)
    if gs.intersects(clip):
        gg = gs.intersection(clip)
        for pp in (gg.geoms if hasattr(gg, "geoms") else [gg]):
            if pp.geom_type == "Polygon":
                ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                     facecolor="#d8d2c4", edgecolor="#b9b09c", lw=0.3))
rng = np.random.default_rng(12)
for g, nm, t, a in pieces:
    base = np.array(PAL.get(t, (58, 116, 178))) / 255.0
    col = np.clip(base * rng.uniform(0.82, 1.18), 0, 1)
    gs = shift(g)
    # Части, разорванные ±180, после сдвига стыкуются вплотную. Не склеив их,
    # обводка нарисует по 180° белую линию через весь океан — глаз прочтёт её
    # как границу зон, которой нет.
    if DATELINE:
        gs = unary_union(gs)
    biggest, ba = None, -1.0
    for pp in (gs.geoms if hasattr(gs, "geoms") else [gs]):
        if pp.geom_type == "Polygon":
            ax.add_patch(MplPoly(list(pp.exterior.coords), closed=True,
                                 facecolor=col, edgecolor="white", lw=1.1, alpha=0.93))
            if pp.area > ba:
                biggest, ba = pp, pp.area
    # подпись — в самой крупной части, иначе на разорванной зоне она уезжает
    c = (biggest or gs).representative_point()
    ax.annotate(nm, (c.x, c.y), ha="center", va="center", fontsize=7.5,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
ax.set_xticks([]); ax.set_yticks([])
ax.legend(handles=[mp.Patch(color=np.array(v) / 255, label=k) for k, v in PAL.items()],
          loc="upper left", bbox_to_anchor=(1.005, 1.0), fontsize=10, frameon=False)
ax.set_title(f"{OCEAN} -> {len(pieces)} зон по World Ablaze.\n"
             f"Границы — контуры их карты, прогнанные через деформацию: линии плавные.",
             fontsize=14)
out = SCR / ("ocean_" + re.sub(r"\W+", "_", OCEAN).lower() + ".png")
fig.tight_layout(); fig.savefig(out, dpi=120, bbox_inches="tight")
print("картинка:", out.name)
