"""
explode_sea_parts.py — разбор составной геометрии морей на одиночные полигоны
с автоматической классификацией причины.

Аналог инструмента QGIS «Разбить составную геометрию» (Multipart to
singleparts), но не просто разбивает: каждую НЕглавную часть относит к одному
из классов, чтобы не разбирать 38 кусков вручную.

Разовая диагностика, НЕ шаг пайплайна. Ничего не меняет — только считает и
печатает; `--geojson` дополнительно кладёт результат разбора в
`out/seas_parts_debug.geojson` для просмотра в QGIS.

Классы (по убыванию «трогать не надо»):

  ANTIMERIDIAN  часть за линией перемены дат. Океан, пересекающий ±180°,
                ОБЯЗАН быть двумя кусками — это не дефект. Плоское расстояние
                между ними при этом огромно (десятки тысяч км) и обманывает
                любую проверку «далеко от тела»;
  OVERLAP       часть лежит внутри или почти внутри ДРУГОГО моря — спор за
                одну и ту же воду, кто-то из двух лишний;
  NEIGHBOUR     часть касается другого моря: вливается в соседа без потери
                воды;
  ISOLATED      часть не касается ничего: сирота, кандидат на удаление либо
                на присоединение по ближайшей исходной акватории.

Запуск:

    python scripts/map/build/explode_sea_parts.py
    python scripts/map/build/explode_sea_parts.py --geojson
"""
from paths import out
import json
import sys
from shapely.geometry import shape, mapping
from shapely.strtree import STRtree

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2

SEAS = out("seas_iho_coastline.geojson")
DEBUG_OUT = "seas_parts_debug.geojson"

# Часть, чей центр дальше этого от антимеридиана, разрывом по ±180° не
# объясняется. Океаны у даты меняют долготу с +179 на -179, и плоская
# метрика видит между ними полмира.
ANTIMERIDIAN_DEG = 25.0
ANTIMERIDIAN_MIN_SPLIT_DEG = 100.0

# Доля площади части, попавшая в чужое море, выше которой это спор, а не стык.
OVERLAP_SHARE = 0.5

# Касание: ближе этого считаем, что часть прилегает к соседу.
TOUCH_DEG = 1e-6


def classify(part, main, others_tree, others):
    """Причина, по которой часть отделена от тела своего моря."""
    c = part.centroid
    if abs(abs(c.x) - 180.0) < ANTIMERIDIAN_DEG and main.distance(part) > ANTIMERIDIAN_MIN_SPLIT_DEG:
        return "ANTIMERIDIAN", None

    best_share, best_name = 0.0, None
    touch_name = None
    for j in others_tree.query(part.buffer(TOUCH_DEG)):
        name, geom = others[int(j)]
        try:
            inter = part.intersection(geom)
        except Exception:
            continue
        if not inter.is_empty and part.area > 0:
            share = inter.area / part.area
            if share > best_share:
                best_share, best_name = share, name
        if touch_name is None and geom.distance(part) <= TOUCH_DEG:
            touch_name = name

    if best_share >= OVERLAP_SHARE:
        return "OVERLAP", best_name
    if touch_name is not None:
        return "NEIGHBOUR", touch_name
    return "ISOLATED", None


def main():
    fc = json.load(open(SEAS, encoding="utf-8"))
    feats = [(f["properties"]["name"], shape(f["geometry"]).buffer(0))
             for f in fc["features"]]

    singles = []          # (name, part_index, geom)
    for name, g in feats:
        parts = sorted(g.geoms, key=lambda p: -p.area) if g.geom_type == "MultiPolygon" else [g]
        for i, p in enumerate(parts, start=1):
            singles.append((name, i, p))
    print(f"морей {len(feats)} -> одиночных полигонов {len(singles)}")

    # индекс по ЧУЖИМ морям целиком
    others = [(n, g) for n, g in feats]
    tree = STRtree([g for _, g in others])

    rows = []
    for name, g in feats:
        if g.geom_type != "MultiPolygon":
            continue
        parts = sorted(g.geoms, key=lambda p: -p.area)
        main_part = parts[0]
        others_wo = [(n, og) for n, og in others if n != name]
        tree_wo = STRtree([og for _, og in others_wo])
        for p in parts[1:]:
            kind, who = classify(p, main_part, tree_wo, others_wo)
            c = p.centroid
            rows.append((area_km2(p), name, kind, who, c.x, c.y,
                          main_part.distance(p) * 111.0))

    rows.sort(reverse=True)
    by_kind = {}
    for r in rows:
        by_kind[r[2]] = by_kind.get(r[2], 0) + 1

    print(f"\nнеглавных частей: {len(rows)}")
    for k in ("ANTIMERIDIAN", "OVERLAP", "NEIGHBOUR", "ISOLATED"):
        if by_kind.get(k):
            print(f"  {k:13s} {by_kind[k]:3d}")

    print(f"\n{'км²':>13s}  {'класс':13s}{'море':32s}{'с кем':26s}{'от тела, км':>12s}")
    for a, name, kind, who, x, y, d in rows:
        print(f"{a:13,.2f}  {kind:13s}{name[:32]:32s}{(who or '')[:26]:26s}{d:12,.0f}"
              f"   ({x:8.3f},{y:7.3f})")

    if "--geojson" in sys.argv:
        path = out(DEBUG_OUT)
        gj = {"type": "FeatureCollection", "features": [
            {"type": "Feature",
             "properties": {"name": f"{n}_{i}", "sea": n, "part": i,
                             "area_km2": round(area_km2(p), 3)},
             "geometry": mapping(p)}
            for n, i, p in singles]}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(gj, f, ensure_ascii=False)
        print(f"\nЗаписано для QGIS: {path} ({len(singles)} полигонов)")


if __name__ == "__main__":
    main()
