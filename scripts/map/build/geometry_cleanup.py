"""
geometry_cleanup.py

Gap-first устранение слайверов между полигонами ("зиппер"-разрывы вдоль
границ из независимых источников). Заменяет buffer-based дозаполнение
(fill_palestine_gaps_to_neighbors / fill_gap_between_countries,
docs/DECISIONS.md "2026-07-19-d"), у которого были врождённые дефекты:
форма шва зависела от join_style буфера ("пипки"), пороговый радиус
подбирался руками под конкретный стык, сходимость требовала нескольких
проходов без гарантии, а буфер раздувал полигон ВО ВСЕ стороны и создавал
новые наложения на третьих соседей/моря, которые приходилось дочищать
отдельными клипами.

Метод (2026-07-19-e, "gap-first"):
  1. `polygonize` по объединению ВСЕХ границ (изменяемая земля + контекстная
     земля + вода) -> точная мозаика ячеек плоскости.
  2. Ячейка, чья representative_point не покрыта ни землёй, ни водой, —
     слайвер (настоящая пустота между полигонами).
  3. Каждый слайвер отдаётся изменяемой фиче с самой длинной общей
     границей; крупные вытянутые ленты предварительно режутся пополам
     рекурсивно, чтобы каждый отрезок ушёл СВОЕМУ ближайшему региону, а не
     весь одному "победителю".

По построению: ноль новых наложений (слайвер — пустота, ни с кем не
пересекается), ноль разрывов после прохода, шов проходит ровно по
существующей границе соседа — без буферов, значит физически неоткуда
взяться "пипкам" и не нужны пост-клипы.

Защиты:
  - Настоящие озёра, которых НЕТ в lakes_1946.geojson (Кинерет/Галилейское
    море ~0.017 deg2 — намеренная дыра в land-покрытии, рендерится фоном
    карты), не должны быть проглочены: слайвером считается только ячейка
    меньше MAX_COMPACT_AREA ЛИБО крупнее, но сильно вытянутая (лента вдоль
    границы, а не компактный блоб).
  - Ячейка, касающаяся ровно одной земельной фичи (сосед по остальной
    границе — море либо никто), тоже поглощается в эту фичу, не только
    ячейки на стыке 2+ земель. РАНЬШЕ такие "1 земля + вода" пропускались
    в предположении, что прибрежная нестыковка (страна/полигон моря
    оцифрованы чуть по-разному) маскируется фоном карты — предположение
    было НЕВЕРНО (2026-07-19-g): фон карты темнее моря, разрыв между
    сушей и морем показывает именно фон, разрыв виден. Единственный
    предохранитель тот же — площадь (MAX_COMPACT_AREA/лента).
  - Ячейки, обрезанные рамкой clip_box (контекст/вода режутся по bbox для
    скорости — рамка порождает искусственные "закрытые" ячейки по краям),
    отбрасываются по касанию границы рамки.
"""
from paths import out
import json
import math
from shapely.geometry import shape, mapping, box as shp_box
from shapely.ops import unary_union, polygonize
from pyproj import Geod

GEOD = Geod(ellps="WGS84")

# Компактная ячейка (потенциально настоящее озеро-дыра) поглощается только
# до этой площади; Кинерет ~0.017 deg2 должен остаться нетронутым.
MAX_COMPACT_AREA = 0.008

# Реальные внутренние водоёмы, которых НЕТ в lakes_1946.geojson — ячейка,
# содержащая такую точку, НИКОГДА не поглощается. Порог компактности такие
# блобы не защищает надёжно: изрезанная естественная береговая линия даёт
# низкий Polsby-Popper, неотличимый от ленты зазора. Держи здесь любой
# намеренный "прогал" в land-покрытии, который absorb_slivers иначе принял
# бы за зазор. Прим.: Кинерет уже НЕ здесь — с 2026-07-19-f он настоящая
# LAK-фича (lakes_1946.geojson), absorb видит его как воду через
# load_water_geoms и не трогает.
PROTECTED_HOLE_POINTS = [
]
# Вытянутая лента вдоль границы (низкая компактность) может быть крупнее —
# исходный разрыв Газа/Синай был одной лентой ~0.04 deg2 на ~2° длины.
MAX_RIBBON_AREA = 0.08
RIBBON_COMPACTNESS = 0.12
# Ленты крупнее этого режутся пополам рекурсивно перед раздачей.
SPLIT_AREA = 0.0008


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    """Polsby-Popper: 4*pi*A/P^2; 1.0 — круг, ~0 — нитевидная лента."""
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def load_water_geoms(clip_box=None):
    """Все моря+озёра пайплайна, по желанию обрезанные по clip_box (границы
    обрезки порождают ячейки, касающиеся рамки, — absorb_slivers их сам
    отбрасывает)."""
    geoms = []
    for fname in ("seas_1946.geojson", "lakes_1946.geojson"):
        with open(out(fname), encoding="utf-8") as f:
            fc = json.load(f)
        for ft in fc["features"]:
            g = shape(ft["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            if clip_box is not None:
                if not g.intersects(clip_box):
                    continue
                g = g.intersection(clip_box)
            geoms.append(g)
    return geoms


def _split_ribbon(cell, depth=0):
    """Режет вытянутую ячейку пополам по длинной стороне bbox рекурсивно,
    до кусочков ~SPLIT_AREA — чтобы длинная лента зазора раздалась по
    сегментам ближайшим регионам, а не целиком одному."""
    if depth >= 10 or cell.area <= SPLIT_AREA:
        return [cell]
    minx, miny, maxx, maxy = cell.bounds
    if maxx - minx >= maxy - miny:
        midx = (minx + maxx) / 2
        halves = (shp_box(minx, miny, midx, maxy), shp_box(midx, miny, maxx, maxy))
    else:
        midy = (miny + maxy) / 2
        halves = (shp_box(minx, miny, maxx, midy), shp_box(minx, midy, maxx, maxy))
    parts = []
    for half in halves:
        piece = cell.intersection(half)
        if piece.is_empty:
            continue
        sub = list(piece.geoms) if piece.geom_type.startswith("Multi") \
            or piece.geom_type == "GeometryCollection" else [piece]
        for p in sub:
            if p.geom_type == "Polygon" and p.area > 1e-12:
                parts.extend(_split_ribbon(p, depth + 1))
    return parts or [cell]


def absorb_slivers(mutable_feats, context_geoms=(), water_geoms=(),
                   clip_box=None, label=""):
    """Один проход gap-first поглощения слайверов. Меняет геометрию только
    mutable_feats (контекст/вода авторитетны). Возвращает число поглощённых
    ячеек (0 = слайверов не осталось)."""
    mutable_geoms = [shape(ft["geometry"]) for ft in mutable_feats]
    land_geoms = mutable_geoms + list(context_geoms)
    all_geoms = land_geoms + list(water_geoms)

    boundaries = unary_union([g.boundary for g in all_geoms])
    cells = list(polygonize(boundaries))
    frame = clip_box.boundary if clip_box is not None else None
    protected_pts = [shape({"type": "Point", "coordinates": p})
                     for p in PROTECTED_HOLE_POINTS]

    additions = {}   # idx изменяемой фичи -> [геометрии на присоединение]
    n_absorbed = 0
    n_skipped_blob = 0
    for cell in cells:
        c = compactness(cell)
        if cell.area > MAX_COMPACT_AREA and not (
                cell.area <= MAX_RIBBON_AREA and c < RIBBON_COMPACTNESS):
            # либо интерьер страны/моря, либо компактный блоб (озеро-дыра)
            if cell.area <= MAX_RIBBON_AREA:
                n_skipped_blob += 1
            continue
        if any(cell.contains(p) for p in protected_pts):
            continue  # известный настоящий водоём-дыра (Кинерет и т.п.)
        if frame is not None and cell.boundary.intersection(frame).length > 1e-9:
            continue  # артефакт обрезки контекста по clip_box
        rp = cell.representative_point()
        if any(g.contains(rp) for g in all_geoms):
            continue  # ячейка уже покрыта землёй или водой
        # общая граница с каждой земельной фичей
        land_touch = []
        for idx, g in enumerate(land_geoms):
            shared = cell.boundary.intersection(g.boundary)
            if shared.length > 1e-9:
                land_touch.append((idx, shared.length))
        if not land_touch:
            continue
        if len(land_touch) < 2:
            # Одна земля (сосед по остальной границе ячейки — море либо
            # никто): раньше здесь пропускались случаи "1 суша + вода",
            # в предположении что такая прибрежная нестыковка (страна и
            # полигон моря оцифрованы чуть по-разному) замаскирована фоном
            # карты. НЕВЕРНО (2026-07-19-g, прямой скриншот пользователя —
            # видимый разрыв ровно на побережье Ливана): в реальном рендере
            # фон карты темнее моря, разрыв между сушей и морем показывает
            # именно фон, не море — щель видна. Суша авторитетна для
            # идентичности страны (море — просто подложка), поэтому такой
            # слайвер поглощается в единственную касающуюся сушу, как и
            # "пинхол" без воды рядом. Единственный предохранитель —
            # площадь: не поглощаем то, что похоже на целое море/озеро.
            if cell.area > MAX_COMPACT_AREA:
                continue
        mutable_touch = [(i, l) for i, l in land_touch if i < len(mutable_feats)]
        if not mutable_touch:
            continue  # шов между двумя авторитетными сторонами - не нам чинить

        if len(mutable_touch) >= 2 and cell.area > SPLIT_AREA:
            pieces = _split_ribbon(cell)
        else:
            pieces = [cell]
        cand_idx = [i for i, _ in mutable_touch]
        for piece in pieces:
            best_i, best_len = None, 0.0
            for i in cand_idx:
                shared = piece.boundary.intersection(mutable_geoms[i].boundary)
                if shared.length > best_len:
                    best_i, best_len = i, shared.length
            if best_i is None:  # отрезанный сегмент без общей границы - ближайшему
                best_i = min(cand_idx, key=lambda i: piece.distance(mutable_geoms[i]))
            additions.setdefault(best_i, []).append(piece)
        n_absorbed += 1

    for idx, pieces in additions.items():
        new_g = unary_union([mutable_geoms[idx]] + pieces)
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        if new_g.geom_type not in ("Polygon", "MultiPolygon"):
            print(f"  [SLIVER/{label}] ОТКАЗ {mutable_feats[idx]['properties'].get('name')}: "
                  f"union дал {new_g.geom_type}")
            continue
        mutable_feats[idx]["geometry"] = mapping(new_g)
        mutable_feats[idx]["properties"]["area_km2"] = round(area_km2(new_g), 1)

    blob_note = f", пропущено компактных блобов (озёра-дыры?): {n_skipped_blob}" if n_skipped_blob else ""
    print(f"  [SLIVER/{label}] ячеек: {len(cells)}, поглощено слайверов: {n_absorbed}{blob_note}")
    return n_absorbed


def absorb_slivers_until_stable(mutable_feats, context_geoms=(), water_geoms=(),
                                 clip_box=None, label="", max_passes=3):
    """absorb_slivers сходится за один проход по построению; второй прогон —
    дешёвая проверка инварианта (должен поглотить 0). max_passes — страховка
    на случай каскадных ячеек у сложных тройных стыков."""
    for i in range(max_passes):
        n = absorb_slivers(mutable_feats, context_geoms, water_geoms, clip_box, label)
        if n == 0:
            return
    print(f"  [SLIVER/{label}] ВНИМАНИЕ: {max_passes} проходов не сошлись до 0 — проверь стык вручную")
