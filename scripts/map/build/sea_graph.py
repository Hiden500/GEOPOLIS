"""
sea_graph.py — граф морских зон: смежность зон между собой и с сушей.

Модуль без побочных эффектов: читает слои, считает связи, ничего не пишет.
Пользуются им `diagnose_sea_graph.py` (постоянная диагностика) и
`split_ocean_shelves.py` (нарезка обязана проверять себя тем же кодом, каким
её потом проверяет диагностика — иначе «сошлось» у одного и «не сошлось» у
другого невозможно свести).

Суша берётся из `master/world_1946.master.geojson` — файла под git, а не из
`out/world_1946.geojson`, который вне git и в свежем дереве отсутствует.
Оба файла на 2026-08-02 побайтно совпадают (md5 f2d01a22…), мастер выбран как
воспроизводимый.

Что здесь считается смежностью — правило одно на весь проект и живёт в
`adjacency.py`: буфер ловит микрозазор оцифровки, касание в одной точке
границей не считается, ±180 обрабатывается отдельным случаем.
"""
from paths import out, REPO_ROOT
import json
import sys
from collections import defaultdict

from shapely.affinity import translate
from shapely.geometry import shape
from shapely.strtree import STRtree

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from adjacency import real_touch, near_seam, seam_pairs, SEAM_SHIFT_DEG

# Тот же рабочий буфер, что в `build_neighbor_graph.py`: ~1 км, ловит
# цифровые микрозазоры и не перепрыгивает открытую воду.
BUFFER_DEG = 0.01

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
SEAS_DEFAULT = out("seas_iho_coastline.geojson")


# --------------------------------------------------------------------------
# загрузка
# --------------------------------------------------------------------------

def _geom(feature):
    g = shape(feature["geometry"])
    if not g.is_valid:
        g = g.buffer(0)
    return g


def load_zones(path=None):
    """Морские зоны: [(name, properties, geom)] в порядке файла."""
    path = str(path or SEAS_DEFAULT)
    fc = json.load(open(path, encoding="utf-8"))
    zones = []
    for f in fc["features"]:
        p = f["properties"]
        zones.append((p["name"], p, _geom(f)))
    return zones


def load_land(path=None):
    """Сухопутные регионы мастер-карты: [(region_id, geom)].

    Озёра и старый слой `SEA-` отбрасываются: берег для морской зоны задают
    только land-регионы.
    """
    path = str(path or MASTER)
    fc = json.load(open(path, encoding="utf-8"))
    land = []
    for f in fc["features"]:
        p = f["properties"]
        if p.get("region_type") != "land":
            continue
        land.append((p["region_id"], _geom(f)))
    return land


# --------------------------------------------------------------------------
# смежность
# --------------------------------------------------------------------------

def _seam_variants(geoms):
    """[(индекс_оригинала, сдвинутая_копия)] для фигур у шва.

    Сдвиг в обе стороны: западная копия уезжает на +360 (ложится справа от
    восточных фигур), восточная на -360 (ложится слева от западных). Так одна
    таблица покрывает обе стороны шва, и вызывающему не нужно знать, с какой
    стороны лежит его фигура.
    """
    variants = []
    for i, g in enumerate(geoms):
        if not near_seam(g):
            continue
        minx, _, maxx, _ = g.bounds
        if minx <= -180.0 + 1.0:
            variants.append((i, translate(g, xoff=SEAM_SHIFT_DEG)))
        if maxx >= 180.0 - 1.0:
            variants.append((i, translate(g, xoff=-SEAM_SHIFT_DEG)))
    return variants


def cross_adjacency(a_geoms, b_geoms):
    """Пары `(i, j)`: `a_geoms[i]` смежна `b_geoms[j]`, включая через ±180.

    Геометрии подаются УЖЕ буферизованными — правило касания обязано
    применяться к тому же входу, на котором строится основной граф.
    """
    pairs = set()

    tree = STRtree(b_geoms)
    for i, g in enumerate(a_geoms):
        for k in tree.query(g):
            k = int(k)
            if real_touch(g.intersection(b_geoms[k])):
                pairs.add((i, k))

    variants = _seam_variants(b_geoms)
    if variants:
        vtree = STRtree([v for _, v in variants])
        for i, g in enumerate(a_geoms):
            if not near_seam(g):
                continue
            for k in vtree.query(g):
                k = int(k)
                j, shifted = variants[k]
                if real_touch(g.intersection(shifted)):
                    pairs.add((i, j))
    return pairs


def zone_edges(zone_geoms):
    """Рёбра графа зон: `(set рёбер, сколько из них существует только через ±180)`."""
    buffered = [g.buffer(BUFFER_DEG) for g in zone_geoms]

    edges = set()
    tree = STRtree(buffered)
    for i, bg in enumerate(buffered):
        for k in tree.query(bg):
            j = int(k)
            if j <= i:
                continue
            if real_touch(buffered[i].intersection(buffered[j])):
                edges.add((i, j))

    seam = set(seam_pairs(buffered))
    seam_only = seam - edges
    edges |= seam_only
    return edges, len(seam_only)


def coastal_by_zone(zone_geoms, land_geoms):
    """`{индекс зоны: set индексов прибрежных сухопутных регионов}`."""
    zb = [g.buffer(BUFFER_DEG) for g in zone_geoms]
    lb = [g.buffer(BUFFER_DEG) for g in land_geoms]
    result = defaultdict(set)
    for i, j in cross_adjacency(zb, lb):
        result[i].add(j)
    return result


def land_edges(land_geoms):
    """Рёбра суша-суша: нужны, чтобы отличить остров-одиночку от материкового региона."""
    buffered = [g.buffer(BUFFER_DEG) for g in land_geoms]
    edges = set()
    tree = STRtree(buffered)
    for i, bg in enumerate(buffered):
        for k in tree.query(bg):
            j = int(k)
            if j <= i:
                continue
            if real_touch(buffered[i].intersection(buffered[j])):
                edges.add((i, j))
    edges |= set(seam_pairs(buffered))
    return edges


# --------------------------------------------------------------------------
# графовые метрики
# --------------------------------------------------------------------------

def adjacency_list(n, edges):
    adj = {i: set() for i in range(n)}
    for a, b in edges:
        adj[a].add(b)
        adj[b].add(a)
    return adj


def components(n, edges):
    """Список компонент связности как списков индексов."""
    adj = adjacency_list(n, edges)
    seen = set()
    comps = []
    for start in range(n):
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            v = stack.pop()
            comp.append(v)
            for w in adj[v]:
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        comps.append(sorted(comp))
    return comps


def shortest_path(n, edges, src, dst):
    """Кратчайший путь по рёбрам или None. Нужен для «путь между океанами есть»."""
    if src == dst:
        return [src]
    adj = adjacency_list(n, edges)
    prev = {src: None}
    queue = [src]
    while queue:
        nxt = []
        for v in queue:
            for w in adj[v]:
                if w in prev:
                    continue
                prev[w] = v
                if w == dst:
                    path, cur = [], w
                    while cur is not None:
                        path.append(cur)
                        cur = prev[cur]
                    return path[::-1]
                nxt.append(w)
        queue = nxt
    return None


def bridges(n, edges):
    """Мосты графа: рёбра, снятие которых увеличивает число компонент.

    Итеративный поиск (алгоритм Тарьяна без рекурсии): глубина обхода упирается
    в число зон, и рекурсивная версия на длинной цепочке зон уронила бы Python
    по лимиту стека раньше, чем нашла бы ответ.
    """
    adj = adjacency_list(n, edges)
    disc = [-1] * n
    low = [0] * n
    found = set()
    timer = 0

    for root in range(n):
        if disc[root] != -1:
            continue
        stack = [(root, -1, iter(sorted(adj[root])))]
        disc[root] = low[root] = timer
        timer += 1
        while stack:
            v, parent, it = stack[-1]
            advanced = False
            for w in it:
                if w == parent:
                    continue
                if disc[w] == -1:
                    disc[w] = low[w] = timer
                    timer += 1
                    stack.append((w, v, iter(sorted(adj[w]))))
                    advanced = True
                    break
                low[v] = min(low[v], disc[w])
            if advanced:
                continue
            stack.pop()
            if stack:
                p = stack[-1][0]
                low[p] = min(low[p], low[v])
                if low[v] > disc[p]:
                    found.add((min(p, v), max(p, v)))
    return found
