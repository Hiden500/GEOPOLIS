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
from shapely.geometry import MultiPolygon, Point
from shapely.ops import linemerge, polygonize, unary_union
from shapely.strtree import STRtree

GEOD = Geod(ellps="WGS84")
TOUCH_EPS = 1e-7

# Допуск выпрямления шва (градусы) — см. `straighten_seams`. 0.05° ≈ 5,5 км.
SEAM_TOL_DEG = 0.05

# Насколько глубоко допуск понижается для цепочки, которая при полном допуске
# вылезает из области. Пять ступеней = до 0,003°; не прошло и там — цепочка
# остаётся как есть, и это печатается.
SEAM_TOL_STEPS = 5


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


def ring_vertices(geom):
    """Множество вершин всех колец — точные координаты, без округления."""
    gi = geom.__geo_interface__
    if gi["type"] == "Polygon":
        polys = [gi["coordinates"]]
    elif gi["type"] == "MultiPolygon":
        polys = gi["coordinates"]
    else:
        return set()
    return {tuple(pt) for poly in polys for ring in poly for pt in ring}


def straighten_seams(geoms, U=None, tol=SEAM_TOL_DEG, log=print):
    """Выпрямляет ВНУТРЕННИЕ швы разбиения, не трогая его внешнюю границу.

    ЗАЧЕМ. Линия раздела двух акваторий обязана быть линией. Зоны, пришедшие из
    внешнего прототипа (`sources/sea_zones_2026-08-06`, внедрены
    `apply_sea_zones.py`), нарезаны в проекции по сетке, и их общие швы идут
    ступеньками: замер 2026-08-14 по мастеру — 16 зон с долей поворотов ~90°
    выше 20%, худшие 58,6%. Все 16 несут `naval_terrain`, то есть пришли ровно
    этой партией; среди 97 ранних зон IHO лестничных ноль. Внутри
    `build_seas_from_iho.py` та же болезнь уже вылечена разрезом по линии
    делимитации (диагональ в две точки вместо квадрантного дробления, вершин
    −57%), но последняя партия через это решение не проходила.

    ЧТО ИМЕННО МЕНЯЕТСЯ. Только швы «фича↔фича» ВНУТРИ области. Внешняя граница
    `U` — берег, стык с соседними морями, дырки-острова — не меняется ни на
    вершину, и это не обещание, а постусловие: функция сверяет вершины
    результата, лежащие на границе `U`, с теми, что были у ВХОДА, и падает на
    первой новой. Без этой сверки правка ломает `coverage_is_valid` (общие
    рёбра с соседями перестают совпадать) и мастер не запишется.

    КАК. Швы вырезаются из объединения границ (`difference` с границей `U`),
    сливаются в максимальные цепочки, каждая упрощается по Дугласу–Пойкеру, и
    из «граница U + выпрямленные швы» полигонизуется новая мозаика; ячейка
    достаётся той исходной фиче, с которой у неё наибольшее пересечение.
    Полигонизация здесь не украшение: она делает общие рёбра общими ПО
    ПОСТРОЕНИЮ — тот же довод, что в `tile_by_cells`.

    ДОПУСК 0,05° (≈5,5 км) ВЗЯТ ЗАМЕРОМ, а не на глаз. Сагитта вершины
    (расстояние до отрезка между соседями) по всем 8965 вершинам швов
    2026-08-14: медиана 0,0066°, p90 0,027°, p99 0,431°, максимум 1,849°. Между
    ступенькой и настоящим изломом линии раздела лежит провал в порядок
    величины — 0,05° стоит в нём. Меньший допуск лестницу не снимает (0,03°
    оставляет 12 зон выше 20%), больший начинает съедать сами изломы (0,1°
    оставляет 2 зоны выше 20%, потому что от линии остаются одни углы).

    Цепочка, которая при полном допуске вылезает за `U` (упрощение спрямляет
    её поперёк острова), получает допуск вдвое меньше, и так до
    `SEAM_TOL_STEPS` раз; не помогло — остаётся как есть. Такие цепочки
    считаются и печатаются: молча оставленная лестница выглядела бы как
    вылеченная.

    Возвращает новый список геометрий в том же порядке.
    """
    live = [g for g in geoms if not g.is_empty]
    if not live:
        return list(geoms)
    if U is None:
        U = clean(unary_union(live))
    Ub = U.boundary
    seam = unary_union([g.boundary for g in live]).difference(Ub)
    if seam.is_empty:
        log("  внутренних швов нет — выпрямлять нечего")
        return list(geoms)

    merged = linemerge(seam)
    chains = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    prep_u = prepared.prep(U)

    simple, kept, lowered = [], 0, 0
    before_v = after_v = 0
    for c in chains:
        before_v += len(c.coords)
        # Точки, где цепочка касается границы области, ДО упрощения. Новых
        # появиться не должно: каждое новое касание — вершина, вставленная в
        # чужую границу.
        touch = c.intersection(Ub)
        chosen, t = c, tol
        for step in range(SEAM_TOL_STEPS + 1):
            s = c.simplify(t, preserve_topology=False)
            new_touch = s.intersection(Ub)
            if (prep_u.contains(s) and new_touch.length == 0.0
                    and new_touch.difference(touch.buffer(TOUCH_EPS)).is_empty):
                chosen = s
                lowered += 1 if step else 0
                break
            t /= 2.0
        else:
            kept += 1
        after_v += len(chosen.coords)
        simple.append(chosen)

    log(f"  швов: {len(chains)} цепочек, вершин {before_v} -> {after_v}"
        f" (допуск понижен у {lowered}, оставлено как есть {kept})")

    cells = list(polygonize(unary_union([Ub] + simple)))
    pts = [c.representative_point() for c in cells]
    inside = [i for i, p in enumerate(pts) if prep_u.contains(p)]
    log(f"  ячеек {len(cells)}, внутри области {len(inside)}")

    tree = STRtree(live)
    by_owner, orphan = {}, 0
    for i in inside:
        cell = cells[i]
        best, best_area = None, 0.0
        for k in (int(k) for k in tree.query(cell)):
            inter = cell.intersection(live[k])
            if inter.is_empty:
                continue
            if inter.area > best_area:
                best, best_area = k, inter.area
        if best is None:
            orphan += 1
            continue
        by_owner.setdefault(best, []).append(cell)
    if orphan:
        log(f"  ячеек без хозяина (отброшено): {orphan}")

    rebuilt = [clean(unary_union(by_owner[k])) if k in by_owner else live[k]
               for k in range(len(live))]

    # --- постусловие: внешняя граница области не сдвинулась ---
    # Вершина результата, лежащая на границе `U`, обязана быть вершиной, которая
    # там УЖЕ БЫЛА. Новая означает, что упрощённый шов рассёк чужое ребро — а
    # это и есть тот дефект, из-за которого `coverage_is_valid` становится
    # False, и заметен он был бы только на следующей заморозке мастера.
    #
    # Эталон — вершины ВХОДА, а не одной лишь `U`: сравнение только с `U`
    # объявляло бы дефектом вершину, которую вход нёс изначально (её `U` не
    # обязана иметь, если два соседа стыкуются в ней встык). Вопрос здесь
    # ровно один: вставило ли ЧТО-ТО НОВОЕ само выпрямление.
    known = ring_vertices(U)
    for g in live:
        known |= ring_vertices(g)
    for k, g in enumerate(rebuilt):
        for v in ring_vertices(g) - known:
            if Ub.distance(Point(v)) < 1e-12:
                raise AssertionError(
                    f"выпрямление вставило вершину {v} в границу области "
                    f"(фича №{k}) — общие рёбра с соседями перестали совпадать")

    out_geoms, it = [], iter(rebuilt)
    for g in geoms:
        out_geoms.append(g if g.is_empty else next(it))
    return out_geoms
