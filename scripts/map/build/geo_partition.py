"""
geo_partition.py — примитивы перераспределения площади между полигонами.

Выделены из `build/apply_sea_zones.py` (2026-08-08), когда та же задача
встала второй раз на Филиппинах: заменить N фич мастера на M новых так, чтобы
покрываемая площадь не изменилась ни на грамм, а границы соседей остались
общими рёбрами.

Почему это не `geometry_cleanup`: тот работает порогами, отбрасывая мелочь как
шум (`DEGENERATE_AREA_DEG2` ~1,24 км²), и для сшивки это правильно. Здесь
порогов быть не должно — перераспределение обязано сохранять всё.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pyproj import Geod
from shapely import prepared
from shapely.geometry import MultiPolygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

GEOD = Geod(ellps="WGS84")
TOUCH_EPS = 1e-7


def parts(geom):
    """Только полигональные части, в виде списка."""
    if geom.is_empty:
        return []
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [g for g in geom.geoms if g.geom_type == "Polygon"]
    return [geom] if geom.geom_type == "Polygon" else []


def area_km2(geom):
    """Геодезическая площадь по частям.

    По частям, а не целиком: у области больше полусферы `Geod` возвращает
    ДОПОЛНЕНИЕ (замер 2026-08-08 на союзе океанских секторов — 236 796 689
    вместо 273 271 745 км², то есть ровно поверхность Земли минус искомое).
    Отдельная часть такого размера не бывает, поэтому суммирование по частям
    от эффекта свободно.
    """
    return sum(abs(GEOD.geometry_area_perimeter(p)[0]) / 1e6 for p in parts(geom))


def clean(geom):
    """Валидная чисто-полигональная геометрия БЕЗ порога по площади.

    `geometry_cleanup.to_polygonal` здесь не годится: он отбрасывает части
    мельче `DEGENERATE_AREA_DEG2` (~1,24 км² на экваторе). Для absorb_slivers
    это шум, а для перераспределения — потеря: первая версия сборщика морских
    зон так потеряла 184 км² и 780 кусков остатка из 1225.
    Убираются только НЕполигональные компоненты — висячие `LineString`,
    которые `unary_union` умеет вернуть в `GeometryCollection` и на которые
    `is_valid` отвечает `True`.
    """
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.geom_type in ("GeometryCollection", "MultiPolygon"):
        polys = [g for g in geom.geoms if g.geom_type == "Polygon" and not g.is_empty]
        if not polys:
            return geom if geom.is_empty else MultiPolygon()
        geom = polys[0] if len(polys) == 1 else MultiPolygon(polys)
    return geom


def strip_overlaps(geoms):
    """Снимает взаимные наложения ПОПАРНО: у пары (i, j), i < j, спорная
    площадь остаётся младшему индексу. Возвращает снятую площадь.

    Накопительный `taken = union(taken, g)` для этого не годится: на десятках
    геометрий океанского размера союз накапливает погрешность,
    `U.difference(taken)` возвращает уже покрытые нити, они попадают в раздачу
    и площадь учитывается дважды (замер: +33,8 км² при 4,07 км² настоящих
    наложений).
    """
    removed = 0.0
    tree = STRtree(geoms)
    for j, g in enumerate(geoms):
        if g.is_empty:
            continue
        earlier = [geoms[i] for i in (int(i) for i in tree.query(g))
                   if i < j and not geoms[i].is_empty and geoms[i].intersects(g)]
        if not earlier:
            continue
        cut = unary_union(earlier)
        inter = g.intersection(cut)
        if inter.is_empty:
            continue
        removed += area_km2(inter)
        geoms[j] = clean(g.difference(cut))
    return removed


def overlap_report(geoms, names, tol=1e-4):
    """Суммарное взаимное наложение и самые крупные пары."""
    tree = STRtree(geoms)
    total, worst = 0.0, []
    for i, g in enumerate(geoms):
        if g.is_empty:
            continue
        for j in (int(j) for j in tree.query(g)):
            if j <= i or geoms[j].is_empty:
                continue
            inter = g.intersection(geoms[j])
            if inter.is_empty:
                continue
            a = area_km2(inter)
            total += a
            if a > tol:
                worst.append((a, names[i], names[j]))
    return total, sorted(worst, reverse=True)


def tile_by_cells(clipped, U, log=print):
    """Мозаика U с ОБЩИМИ рёбрами: нодирование -> polygonize -> раздача ячеек.

    Метод взят у `build/rebuild_shared_edges.py` (он же собрал нынешний
    мастер) и применён локально к перераспределяемой области. Почему не
    хватает «обрезать и залатать остаток»: у двух соседей вдоль общего шва
    РАЗНОЕ число вершин, поэтому шов не сокращается в сумме площадей и
    `coverage_is_valid` ложится. После нодирования общий участок двух фич —
    физически один отрезок, поэтому вершины совпадают по построению.

    Ячейка без хозяина уходит соседу с САМОЙ ДЛИННОЙ общей границей — принцип
    gap-first из `geometry_cleanup.absorb_slivers`; изолированный кусок
    (со всех сторон чужая суша) — ближайшей фиче.
    """
    log("  нодирую границы…")
    bnd = unary_union([U.boundary] + [g.boundary for g in clipped if not g.is_empty])
    cells = list(polygonize(bnd))
    pts = [c.representative_point() for c in cells]
    prep_u = prepared.prep(U)
    keep = [i for i, p in enumerate(pts) if prep_u.contains(p)]
    log(f"    ячеек {len(cells)}, внутри области {len(keep)}")

    tree = STRtree(clipped)
    owner, unassigned = {}, []
    for i in keep:
        p = pts[i]
        cand = [int(j) for j in tree.query(p) if clipped[int(j)].intersects(p)]
        if len(cand) == 1:
            owner[i] = cand[0]
        elif cand:  # точка легла на общий шов
            owner[i] = max(cand, key=lambda j: clipped[j].intersection(cells[i]).area)
        else:
            unassigned.append(i)
    log(f"    ячеек без хозяина (остаток): {len(unassigned)}")

    ctree = STRtree([cells[i] for i in keep])
    pending = list(unassigned)
    while pending:
        progressed, still = False, []
        for i in pending:
            best, best_len = None, 0.0
            for k in ctree.query(cells[i].buffer(TOUCH_EPS)):
                j = keep[int(k)]
                if j == i or j not in owner:
                    continue
                shared = cells[i].boundary.intersection(cells[j].boundary).length
                if shared > best_len:
                    best, best_len = owner[j], shared
            if best is None:
                still.append(i)
            else:
                owner[i], progressed = best, True
        if not progressed:
            for i in still:
                owner[i] = min(range(len(clipped)),
                               key=lambda j: (cells[i].distance(clipped[j])
                                              if not clipped[j].is_empty else float("inf")))
            log(f"    изолированных ячеек, отданных ближайшей фиче: {len(still)}")
            break
        pending = still

    by_owner = {}
    for i, z in owner.items():
        by_owner.setdefault(z, []).append(cells[i])
    return [clean(unary_union(by_owner[j])) if j in by_owner else clipped[j]
            for j in range(len(clipped))]
