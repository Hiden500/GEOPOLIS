"""
diagnose_coastline_gaps.py

Пермаментный диагностический скрипт (read-only, НЕ шаг пайплайна — как
diagnose_sea_holes.py/diagnose_missing_land.py/diagnose_scattered_
regions.py). Находит РЕАЛЬНЫЕ визуальные разрывы суша<->вода — те же
непокрытые ячейки, что ищет `absorb_slivers` (`geometry_cleanup.py`) при
поглощении, но здесь ЧИСТО ДЛЯ ПРОВЕРКИ: ничего не меняет, не пишет
файлы, только считает и (по флагу) рисует.

Контекст (2026-07-23): `fix_lake_coastline_gaps.py` отрапортовал успех
(идемпотентен, 0 при повторном прогоне) — но реальные разрывы ОСТАЛИСЬ
(баг во втором size-gate `absorb_slivers`, см. docs/DECISIONS.md). Только
рендер конкретных участков вскрыл проблему. Этот скрипт формализует ту же
проверку как переиспользуемый инструмент — "идемпотентно" и "0 при
повторном прогоне" ДОКАЗЫВАЕТ СХОДИМОСТЬ, не ПОЛНОТУ; регулярная сверка
этим скриптом (особенно рендером) — единственный способ поймать
"стабильно неверный" случай, когда алгоритм каждый раз молча пропускает
один и тот же настоящий разрыв.

Метод: те же 7 континентальных тайлов, что `fix_sea_coastline_gaps.py`
(`TILES`) — суша и вода СЛИТЫ ОТДЕЛЬНО (unary_union) в единые геометрии,
`polygonize()` их границ + рамки box даёт мозаику ячеек, ячейка с
representative_point не покрытой ни сушей ни водой — кандидат в разрыв.

ВАЖНО (найдено при первом прогоне этого скрипта, 2026-07-24): полигоны
соседних РЕГИОНОВ одной/разных стран в этом датасете не всегда совпадают
побитово по узлам вдоль общей административной границы (независимая
генерация/симплификация) — даже после слияния (unary_union НЕ схлопывает
уже-разъединённые полигоны, только касающиеся/перекрывающиеся). Это создаёт
тысячи тонких лентовидных "разрывов" вдоль обычных внутренних границ,
не имеющих отношения к берегу — первый прогон без фильтра дал 1017 "разрывов"
(в т.ч. на Brazil/Paraguay, где 0 пересечений уже отдельно подтверждено).
Поэтому каждая кандидатная ячейка классифицируется на 3 категории:

  COASTLINE — касается воды напрямую: это и есть "разрыв берега" в смысле
      названия скрипта, полный список выводится всегда.
  LAND_SEAM — не касается воды, вытянутая форма (см. LAND_SEAM_ASPECT_RATIO)
      — почти наверняка шум несовпадения соседних административных границ,
      а не разрыв. Выводится только сводным счётчиком (не список), чтобы
      не маскировать её существование, но и не захламлять отчёт.
  LAND_HOLE — не касается воды, НЕ вытянутая (компактная/блобом) —
      вероятно настоящая непокрытая территория (см. Brazil/Paraguay
      1464 km2 находку) — другой класс, чем LAND_SEAM, выводится списком
      отдельно от COASTLINE (это не берег, но и не шум).

  ВАЖНО: для этой классификации `compactness()` (4*pi*area/perimeter^2,
  geometry_cleanup.py) НЕ годится — административные границы зубчатые
  (много мелких узлов), из-за чего периметр раздувается даже у КОМПАКТНОЙ
  по форме ячейки, и compactness ложно показывает "ленту" (проверено:
  1464 km2 ячейка на Brazil/Paraguay дала compactness=0.0024 — как явная
  лента, — но её minimum_rotated_rectangle почти квадратный, aspect=1.5).
  Соотношение сторон minimum_rotated_rectangle нечувствительно к
  зубчатости контура и корректно отличило этот блоб (aspect 1.5-1.9) от
  настоящих узких швов (aspect 8+) на той же тайле.

Два режима:
  --scan (по умолчанию): считает разрывы по всем 7 тайлам, печатает
      сводку + список крупнейших по каждой из 3 категорий — быстрая
      числовая проверка всего мира.
  --render MINX MINY MAXX MAXY [--out PATH.png]: рисует конкретный bbox
      (суша по континентам + море + озеро; COASTLINE — красным, LAND_HOLE —
      оранжевым, LAND_SEAM — не подсвечивается, это шум) — визуальная
      проверка конкретного участка.

Запуск:
  python scripts/map/build/diagnose_coastline_gaps.py
  python scripts/map/build/diagnose_coastline_gaps.py --render -90 41 -78 47 --out gap.png
"""
import argparse
import math
import sys
from shapely.geometry import shape, box as shp_box
from shapely.ops import unary_union, polygonize

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2  # noqa: E402
from paths import out  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MIN_AREA_KM2 = 0.5
# Найдено эмпирически на Brazil/Paraguay тайле (2026-07-24): настоящие швы
# несовпадения границ имели aspect >= ~10, настоящие блобы-находки — <= 1.9.
# Порог 8 — с запасом посередине этого разрыва.
LAND_SEAM_ASPECT_RATIO = 8
# Ячейка касается воды, если ближе этого расстояния (градусы, ~11 см на
# экваторе) — допуск на плавающую точку, не географический порог.
WATER_TOUCH_EPS_DEG = 1e-6


def _mrr_aspect(geom):
    """Соотношение сторон minimum_rotated_rectangle — устойчиво к зубчатости
    контура (в отличие от compactness через периметр, см. докстринг модуля)."""
    mrr = geom.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    if len(coords) < 5:
        return 1.0
    sides = [math.dist(coords[i], coords[i + 1]) for i in range(4)]
    nonzero = [s for s in sides if s > 1e-12]
    if not nonzero:
        return 1.0
    return max(sides) / min(nonzero)

CONTINENT_FILES = {
    "EUR": out("europe_1946.geojson"),
    "ASI": out("asia_1946.geojson"),
    "NAM": out("namerica_1946.geojson"),
    "SAM": out("southamerica_1946.geojson"),
    "AFR": out("africa_1946.geojson"),
    "OCE": out("oceania_1946.geojson"),
    "ANT": out("antarctica_1946.geojson"),
}

# Те же 7 тайлов, что fix_sea_coastline_gaps.py — согласованное разбиение
# мира для both построения, и проверки результата.
TILES = [
    ("Europe+Africa+MidEast", (-30, -40, 65, 75)),
    ("Asia", (60, 0, 180, 80)),
    ("N.America", (-170, 5, -50, 85)),
    ("S.America", (-90, -60, -30, 15)),
    ("Oceania", (110, -50, 180, 0)),
    ("Antarctica", (-180, -90, 180, -60)),
    ("Pacific dateline wrap", (-180, -60, -140, 75)),
]


def load(path):
    import json
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def load_all_geoms(box):
    """Суша (все континенты) + море + озеро, обрезанные по box."""
    land_geoms = []
    for path in CONTINENT_FILES.values():
        for ft in load(path):
            g = shape(ft["geometry"])
            if g.intersects(box):
                clipped = g.intersection(box)
                if not clipped.is_empty:
                    land_geoms.append(clipped)
    water_geoms = []
    for path in (out("seas_1946.geojson"), out("lakes_1946.geojson")):
        for ft in load(path):
            g = shape(ft["geometry"])
            if g.intersects(box):
                clipped = g.intersection(box)
                if not clipped.is_empty:
                    water_geoms.append(clipped)
    return land_geoms, water_geoms


def _merge(geoms):
    if not geoms:
        return None
    m = unary_union(geoms)
    return None if m.is_empty else m


def _gap_cells(box, land_geoms, water_geoms):
    """Возвращает список (cell, area_km2, centroid_xy, category).

    category: "COASTLINE" (касается воды), "LAND_SEAM" (лента, не у воды —
    почти наверняка шум несовпадения соседних границ), "LAND_HOLE" (блоб,
    не у воды — вероятно настоящая непокрытая территория).
    """
    land = _merge(land_geoms)
    water = _merge(water_geoms)
    covering = [g for g in (land, water) if g is not None]
    if not covering:
        return []
    boundaries = unary_union([g.boundary for g in covering] + [box.boundary])
    cells = list(polygonize(boundaries))
    gaps = []
    for cell in cells:
        # отбрасываем ячейки рамки (внешние, огромные) по касанию границы box
        if cell.boundary.intersection(box.boundary).length > 1e-9 and cell.area > box.area * 0.3:
            continue
        rp = cell.representative_point()
        if any(g.contains(rp) for g in covering):
            continue
        a = area_km2(cell)
        if a < MIN_AREA_KM2:
            continue
        if water is not None and cell.distance(water) < WATER_TOUCH_EPS_DEG:
            category = "COASTLINE"
        elif _mrr_aspect(cell) >= LAND_SEAM_ASPECT_RATIO:
            category = "LAND_SEAM"
        else:
            category = "LAND_HOLE"
        gaps.append((cell, a, rp.coords[0], category))
    return gaps


def find_gaps(box, land_geoms, water_geoms):
    """Возвращает список (area_km2, centroid_xy) COASTLINE-разрывов (для обратной совместимости)."""
    return [(a, pt) for _, a, pt, cat in _gap_cells(box, land_geoms, water_geoms) if cat == "COASTLINE"]


def scan():
    totals = {"COASTLINE": [0, 0.0], "LAND_HOLE": [0, 0.0], "LAND_SEAM": [0, 0.0]}
    found = {"COASTLINE": [], "LAND_HOLE": []}  # LAND_SEAM — только счётчик, не список
    for label, (minx, miny, maxx, maxy) in TILES:
        box = shp_box(minx, miny, maxx, maxy)
        land_geoms, water_geoms = load_all_geoms(box)
        gaps = _gap_cells(box, land_geoms, water_geoms)
        tile_counts = {"COASTLINE": 0, "LAND_HOLE": 0, "LAND_SEAM": 0}
        tile_area = {"COASTLINE": 0.0, "LAND_HOLE": 0.0, "LAND_SEAM": 0.0}
        for cell, a, pt, cat in gaps:
            totals[cat][0] += 1
            totals[cat][1] += a
            tile_counts[cat] += 1
            tile_area[cat] += a
            if cat in found:
                found[cat].append((a, label, pt))
        print(f"  [{label}] COASTLINE: {tile_counts['COASTLINE']} ({tile_area['COASTLINE']:.1f} km2)"
              f" | LAND_HOLE: {tile_counts['LAND_HOLE']} ({tile_area['LAND_HOLE']:.1f} km2)"
              f" | LAND_SEAM (шум границ, игнорируется): {tile_counts['LAND_SEAM']} ({tile_area['LAND_SEAM']:.1f} km2)")

    print(f"\nВСЕГО COASTLINE (разрыв суша<->вода): {totals['COASTLINE'][0]}, {totals['COASTLINE'][1]:.1f} km2")
    print(f"ВСЕГО LAND_HOLE (непокрытая суша, не у воды): {totals['LAND_HOLE'][0]}, {totals['LAND_HOLE'][1]:.1f} km2")
    print(f"ВСЕГО LAND_SEAM (шум несовпадения границ, ИГНОРИРУЕТСЯ): {totals['LAND_SEAM'][0]}, {totals['LAND_SEAM'][1]:.1f} km2")

    for cat, title in (("COASTLINE", "Крупнейшие COASTLINE"), ("LAND_HOLE", "Крупнейшие LAND_HOLE")):
        rows = found[cat]
        if not rows:
            continue
        rows.sort(reverse=True)
        print(f"\n{title} (топ 20):")
        for a, label, pt in rows[:20]:
            print(f"  {a:8.1f} km2  [{label}]  at ({pt[0]:.3f},{pt[1]:.3f})")


def render(minx, miny, maxx, maxy, out_path, title=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    box = shp_box(minx, miny, maxx, maxy)
    land_geoms, water_geoms = load_all_geoms(box)

    fig, ax = plt.subplots(figsize=(10, 10))
    for g in land_geoms:
        polys = [g] if g.geom_type == "Polygon" else (list(g.geoms) if g.geom_type == "MultiPolygon" else [])
        for p in polys:
            if p.is_empty:
                continue
            xs, ys = p.exterior.xy
            ax.fill(xs, ys, color="wheat", edgecolor="saddlebrown", linewidth=0.5, zorder=2)
            for interior in p.interiors:
                ixs, iys = interior.xy
                ax.fill(ixs, iys, color="white", zorder=2.5)
    for g in water_geoms:
        polys = [g] if g.geom_type == "Polygon" else (list(g.geoms) if g.geom_type == "MultiPolygon" else [])
        for p in polys:
            if p.is_empty:
                continue
            xs, ys = p.exterior.xy
            ax.fill(xs, ys, color="#a8d8f0", zorder=1)

    gaps = _gap_cells(box, land_geoms, water_geoms)
    counts = {"COASTLINE": 0, "LAND_HOLE": 0, "LAND_SEAM": 0}
    areas = {"COASTLINE": 0.0, "LAND_HOLE": 0.0, "LAND_SEAM": 0.0}
    for cell, a, _, cat in gaps:
        counts[cat] += 1
        areas[cat] += a
        if cat == "COASTLINE":
            color = "red"
        elif cat == "LAND_HOLE":
            color = "orange"
        else:
            continue  # LAND_SEAM — шум границ, не подсвечиваем
        xs, ys = cell.exterior.xy
        ax.fill(xs, ys, color=color, alpha=0.85, zorder=3)

    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.set_aspect("equal")
    ax.set_title(title or (
        f"({minx},{miny})-({maxx},{maxy})\n"
        f"COASTLINE(красн): {counts['COASTLINE']}/{areas['COASTLINE']:.1f}km2  "
        f"LAND_HOLE(оранж): {counts['LAND_HOLE']}/{areas['LAND_HOLE']:.1f}km2"
    ))
    plt.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"COASTLINE: {counts['COASTLINE']} ({areas['COASTLINE']:.1f} km2) | "
          f"LAND_HOLE: {counts['LAND_HOLE']} ({areas['LAND_HOLE']:.1f} km2) | "
          f"LAND_SEAM игнорируется: {counts['LAND_SEAM']} ({areas['LAND_SEAM']:.1f} km2) -> {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--render", nargs=4, type=float, metavar=("MINX", "MINY", "MAXX", "MAXY"))
    parser.add_argument("--out", default="coastline_gap_render.png")
    parser.add_argument("--title", default=None)
    args = parser.parse_args()

    if args.render:
        render(*args.render, out_path=args.out, title=args.title)
    else:
        scan()


if __name__ == "__main__":
    main()
