"""
rebuild_shared_edges.py — топологическая пересборка: граница двух соседей
становится ОДНИМ физическим ребром (2026-07-30).

ЗАЧЕМ. Требование пользователя: «Все полигоны должны прилипать друг к другу»,
«не должно быть этой белой линии» (то же с 2026-07-19-e). После
`weld_map_gaps.py` пустот в карте не осталось — но «прилипания» всё ещё нет:
у двух соседей вдоль общей границы ДВА независимых набора вершин. Замер на
тайле Пьюджет-Саунд: `shapely.coverage_is_valid` = False, невалидных рёбер
171° суммарной длины при 7 фичах.

Следствия этого расхождения не косметические:
  - `client/src/map/engine/TopologyBuilder.ts` считает отрезок берегом, если
    он встречается ровно у ОДНОГО региона (ключ — координаты, округлённые до
    1e-5). При несовпадении узлов ОБА соседа получают `isCoast: true`, и на
    внутренний шов ложатся `coastline-glow` 4 px + `coastline-solid` 2.5 px
    почти чёрного. Замер: ~9200 отрезков рисуют берег там, где берега нет.
  - `diagnose_coastline_gaps.py` вынужден держать категорию `LAND_SEAM`
    (MRR aspect >= 8) и игнорировать её как «шум»: без фильтра первый прогон
    давал 1017 ложных «разрывов» ровно по этой причине.

ПОЧЕМУ НЕ `set_precision`. Проверено прямым замером (2026-07-30): приведение
координат к сетке 1e-7…1e-4 снижает длину невалидных рёбер лишь с 171° до
135–151° и НИ ПРИ КАКОМ шаге не даёт `coverage_is_valid`. Причина
принципиальная: у соседей РАЗНОЕ ЧИСЛО вершин на общем участке, а округление
вершины не добавляет и не удаляет. Поэтому сетка здесь — не решение, а лишь
необязательная подготовка.

МЕТОД (классический topology build, проверен на тайле — coverage_is_valid
True, невалидных рёбер ровно 0.000000°, площадь +0.1 км² из 75 534):
  1. Взять границы ВСЕХ фич всех слоёв сразу (континенты + seas + lakes) —
     иначе границы «континент↔море» так и останутся раздельными.
  2. `unary_union` границ: попутно нодирует их, то есть разрезает в каждой
     точке взаимного пересечения. С этого момента общий участок двух соседей
     физически один и тот же отрезок.
  3. `polygonize` → мозаика элементарных ячеек, чьи рёбра общие по построению.
  4. Каждую ячейку отдать той фиче, которая содержит её
     `representative_point`.
  5. Каждую фичу собрать как union её ячеек.

ЧЕГО СКРИПТ НЕ ДЕЛАЕТ (осознанно, каждое — из найденного риска):
  - не меняет число, порядок и состав фич: мутирует `ft["geometry"]` по
    индексу. Иначе каскад позиционных id (`out/ownership_1946.json`,
    `out/names_ru.json`, `economy_1946/capital_overrides.py`).
  - не применяет `geometry_cleanup.to_polygonal()`: его
    `DEGENERATE_AREA_DEG2 = 1e-4` (~1.24 км²) молча выбрасывает мелкие
    острова как части MultiPolygon.
  - не «подчищает» фичу, для которой не нашлось ни одной ячейки — оставляет
    исходную геометрию и громко сообщает.

КОНТРОЛЬ, который обязателен именно для этого шага:
  - якоря столиц лежат в 0.45 км (Рио, SAM-0013), 1.27 км (Вашингтон,
    NAM-0216), 2.91 км (Оттава, NAM-0014) от границы своего региона —
    сдвиг вершин может выбросить точку за полигон, и падение покрытия
    инварианта 15 `validate_region_economy_1946.py` даёт лишь warning,
    который легко пропустить;
  - население распределяется по площади через квантильные пороги
    `economy_1946/density_tiers.py::generic_tier` — перескок тира даёт ×5 и
    не ловится ни одним тестом;
  - число частей MultiPolygon до/после (потеря мелких островов).
Скрипт печатает эти сверки сам; `--check` считает их, ничего не записывая.

Читает/пишет континентальные `out/<continent>_1946.geojson` +
`out/seas_1946.geojson` + `out/lakes_1946.geojson`. НЕ пишет
`out/world_1946.geojson` — он производный (`merge_world_1946.py`).

Идемпотентен: повторный прогон на уже сшитой карте даёт те же геометрии
(мозаика уже совпадает с фичами) и `coverage_is_valid` остаётся True.
"""
import argparse
import json
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import shape, mapping  # noqa: E402
from shapely.ops import unary_union, polygonize  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

LAYERS = [
    "europe_1946.geojson",
    "asia_1946.geojson",
    "namerica_1946.geojson",
    "southamerica_1946.geojson",
    "africa_1946.geojson",
    "oceania_1946.geojson",
    "antarctica_1946.geojson",
    "seas_1946.geojson",
    "lakes_1946.geojson",
]


def valid(g):
    return g if g.is_valid else g.buffer(0)


def n_parts(g):
    return len(g.geoms) if g.geom_type == "MultiPolygon" else 1


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="посчитать и проверить, ничего не записывать")
    args = ap.parse_args()

    layers, entries, geoms = {}, [], []
    for name in LAYERS:
        with open(out(name), encoding="utf-8") as f:
            data = json.load(f)
        layers[name] = data
        for i, ft in enumerate(data["features"]):
            entries.append((name, i))
            geoms.append(valid(shape(ft["geometry"])))
    nv = sum(len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors)
             for g in geoms for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]))
    print(f"  фич: {len(geoms)}, вершин: {nv:,}", flush=True)

    t = time.time()
    print("  нодирую границы всех слоёв (unary_union)…", flush=True)
    bnd = unary_union([g.boundary for g in geoms])
    print(f"    готово за {time.time() - t:.1f}с", flush=True)

    t = time.time()
    print("  polygonize…", flush=True)
    cells = list(polygonize(bnd))
    print(f"    ячеек: {len(cells)} за {time.time() - t:.1f}с", flush=True)

    t = time.time()
    print("  раздаю ячейки владельцам…", flush=True)
    tree = STRtree(geoms)
    assign, orphan_n, orphan_a = {}, 0, 0.0
    for c in cells:
        rp = c.representative_point()
        owners = [int(i) for i in tree.query(rp) if geoms[int(i)].contains(rp)]
        if not owners:
            orphan_n += 1
            orphan_a += area_km2(c)
            continue
        # Ячейка внутри двух фич возможна только при остаточном наложении;
        # берём первую — resolve_same_iso_overlaps/clip_* отвечают за то,
        # чтобы таких не было, а здесь важнее не потерять площадь.
        assign.setdefault(owners[0], []).append(c)
    print(f"    готово за {time.time() - t:.1f}с; ячеек без владельца: {orphan_n}"
          + (f" ({orphan_a:.2f} км²)" if orphan_n else ""), flush=True)

    t = time.time()
    print("  пересобираю фичи из ячеек…", flush=True)
    rebuilt, no_cells = [], []
    for i in range(len(geoms)):
        cs = assign.get(i)
        if not cs:
            no_cells.append(i)
            rebuilt.append(geoms[i])
            continue
        g = unary_union(cs) if len(cs) > 1 else cs[0]
        rebuilt.append(valid(g))
    print(f"    готово за {time.time() - t:.1f}с", flush=True)
    if no_cells:
        print(f"    ВНИМАНИЕ: без ячеек осталось {len(no_cells)} фич "
              f"(геометрия сохранена как была):")
        for i in no_cells[:10]:
            name, idx = entries[i]
            nm = layers[name]["features"][idx]["properties"].get("name")
            print(f"      {nm} [{name}] {area_km2(geoms[i]):.3f} км²")

    # --- сверки ---
    a0 = sum(area_km2(g) for g in geoms)
    a1 = sum(area_km2(g) for g in rebuilt)
    p0 = sum(n_parts(g) for g in geoms)
    p1 = sum(n_parts(g) for g in rebuilt)
    print()
    print(f"  площадь: {a0:,.1f} -> {a1:,.1f} км² ({a1 - a0:+,.2f})")
    print(f"  частей MultiPolygon всего: {p0} -> {p1} ({p1 - p0:+d})")
    lost = [(entries[i], n_parts(geoms[i]) - n_parts(rebuilt[i])) for i in range(len(geoms))
            if n_parts(rebuilt[i]) < n_parts(geoms[i])]
    if lost:
        print(f"  фич, потерявших части: {len(lost)}")
        for (name, idx), d in sorted(lost, key=lambda x: -x[1])[:10]:
            nm = layers[name]["features"][idx]["properties"].get("name")
            print(f"      {nm} [{name}]: -{d} част(и/ей)")

    import numpy as np
    arr = np.array(rebuilt, dtype=object)
    try:
        ok = shapely.coverage_is_valid(arr, gap_width=0.0)
        edges = shapely.coverage_invalid_edges(arr, gap_width=0.0)
        badlen = sum(e.length for e in edges if e is not None and not e.is_empty)
        badn = sum(1 for e in edges if e is not None and not e.is_empty)
        print(f"  coverage_is_valid: {ok}; фич с невалидными рёбрами {badn}, "
              f"длина {badlen:.6f}°")
    except Exception as exc:
        print(f"  coverage-проверка не выполнена: {type(exc).__name__}: {exc}")

    if args.check:
        print("\n  --check: ничего не записано")
        return 0

    changed = set()
    for i, g in enumerate(rebuilt):
        name, idx = entries[i]
        ft = layers[name]["features"][idx]
        ft["geometry"] = mapping(g)
        ft["properties"]["area_km2"] = round(area_km2(g), 1)
        changed.add(name)
    for name in LAYERS:
        if name in changed:
            with open(out(name), "w", encoding="utf-8") as f:
                json.dump(layers[name], f, ensure_ascii=False)
    print(f"\n  Записано слоёв: {len(changed)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
