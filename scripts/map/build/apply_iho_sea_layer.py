"""
apply_iho_sea_layer.py — подставляет в мастер СВЕЖИЙ водный слой IHO.

ЗАЧЕМ. Мастер заморожен 2026-07-30 (`a9530ea`), а `build_seas_from_iho.py`
после этого менялся семь раз (2026-07-31…08-01): берег из game_map, одно
правило заполнения вместо шести заплаток, диагональ вместо лестницы на линиях
раздела (вершин −57%), чистка лишних точек, разбор неглавных частей,
курируемые линии раздела. Пересобрать мастер целиком нечем — 8 из 11 входов
пайплайна отсутствуют, — поэтому все семь улучшений в карту не попали и
пролежали незамеченными: у Чёрного моря в мастере 1285 вершин против 1098 в
свежем слое, а линия раздела с Азовским идёт не поперёк горла Керченского
пролива, а выше и иначе.

ЧТО ПОДСТАВЛЯЕТСЯ. Только ИМЕНОВАННЫЕ моря — 95 штук плюс Арктика. Океанские
зоны (`build/apply_sea_zones.py`, поле `ocean`) не трогаются: они уже свежие,
это тот же прогон, из которого взят слой.

ПОЧЕМУ НЕ ПРОСТАЯ ПОДМЕНА. У свежего слоя свой берег (из `game_map.json`), а у
мастера — свой, сваренный с сушей (`weld_map_gaps.py` + `rebuild_shared_edges
.py`). Подставить его целиком значило бы оторвать воду от суши. Поэтому
подставляются НЕ полигоны, а ЛИНИИ РАЗДЕЛА: вода мастера перераспределяется
между морями по новой делимитации (`build/geo_partition.py`), а берег остаётся
мастерский до последней вершины. Отсюда:

  - суммарная площадь воды не меняется;
  - суша не меняется вовсе;
  - число фич и `region_id` не меняются, значит каскад позиционных файлов
    не трогается — ни один из восьми файлов не требует ремапа.

АРКТИКА. В свежем слое это ОДНА фича «Arctic Ocean», в мастере — два сектора
(`Arctic — American-Pacific`, `Arctic — Euro-Atlantic`), которые нарезка
океанов не заменяла: файлов зон для Арктики нет. Поэтому новая арктическая
вода делится существующей границей секторов мастера, и оба сектора остаются.

Вход:  scripts/map/master/world_1946.master.geojson
       scripts/map/out/seas_iho_coastline.geojson (build_seas_from_iho.py)
Выход: scripts/map/out/world_1946.geojson — далее
       build/rebuild_shared_edges.py --world и build/freeze_master_map.py.

Запуск:
    python scripts/map/build/apply_iho_sea_layer.py
    python scripts/map/build/apply_iho_sea_layer.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import REPO_ROOT, out  # noqa: E402
from geo_partition import (  # noqa: E402
    area_km2, clean, overlap_report, strip_overlaps, tile_by_cells,
)

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
LAYER = "seas_iho_coastline.geojson"
ARCTIC_SOURCE = "Arctic Ocean"
# Пять океанских монолитов свежего слоя заменены нарезкой на 85 зон и сюда
# не идут (`build/apply_sea_zones.py`).
OCEAN_MONOLITHS = {"Indian Ocean", "North Atlantic Ocean", "North Pacific Ocean",
                   "South Atlantic Ocean", "South Pacific Ocean"}

AREA_TOL_KM2 = 1.0
AREA_TOL_REL = 5e-7
RESIDUAL_TOL_KM2 = 1e-4


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    feats = world["features"]
    src = Path(out(LAYER))
    if not src.is_file():
        raise SystemExit(
            f"нет {src}: сначала прогони build/build_seas_from_iho.py "
            f"(нужны sources/iho/oceans-seas.geo.json, out/lakes_1946.geojson "
            f"и game_map.json — все три есть в общем хранилище)")
    layer = {f["properties"]["name"]: f
             for f in json.loads(src.read_text(encoding="utf-8"))["features"]
             if f["properties"]["name"] not in OCEAN_MONOLITHS}

    # Заменяются ровно морские фичи БЕЗ поля `ocean`: именованные моря и
    # арктические секторы. Зоны нарезки остаются как есть.
    targets = [f for f in feats
               if f["properties"]["region_type"] == "sea" and not f["properties"].get("ocean")]
    arctic = [f for f in targets if f["properties"]["name"].startswith("Arctic —")]
    named = [f for f in targets if f not in arctic]
    print(f"мастер: {len(feats)} фич; заменяемых морских {len(targets)} "
          f"(именованных {len(named)}, арктических секторов {len(arctic)})")

    missing = [f["properties"]["name"] for f in named
               if f["properties"]["name"] not in layer]
    if missing:
        raise SystemExit(f"в свежем слое нет морей мастера: {missing}")
    if ARCTIC_SOURCE not in layer:
        raise SystemExit(f"в свежем слое нет «{ARCTIC_SOURCE}»")

    old_geoms = [clean(shape(f["geometry"])) for f in targets]
    area_before = sum(area_km2(g) for g in old_geoms)
    W = clean(unary_union(old_geoms))
    print(f"  площадь перераспределяемой воды: {area_before:,.1f} км²")

    # Кандидаты в том же порядке, что и заменяемые фичи.
    cands, names = [], []
    arctic_new = clean(shape(layer[ARCTIC_SOURCE]["geometry"]).intersection(W))
    taken = None
    for f in targets:
        nm = f["properties"]["name"]
        if nm.startswith("Arctic —"):
            part = clean(arctic_new.intersection(clean(shape(f["geometry"]))))
            if taken is not None:
                part = clean(part.difference(taken))
            taken = part if taken is None else clean(unary_union([taken, part]))
            cands.append(part)
        else:
            cands.append(clean(shape(layer[nm]["geometry"]).intersection(W)))
        names.append(nm)

    print(f"  снято взаимных наложений: {strip_overlaps(cands):,.3f} км²")
    geoms = tile_by_cells(cands, W)

    problems = []
    empty = [names[i] for i, g in enumerate(geoms) if g.is_empty]
    if empty:
        problems.append(f"опустевшие моря: {empty}")
    area_after = sum(area_km2(g) for g in geoms)
    tol = max(AREA_TOL_KM2, AREA_TOL_REL * area_before)
    if abs(area_after - area_before) > tol:
        problems.append(f"площадь воды: было {area_before:,.3f}, стало "
                        f"{area_after:,.3f} (допуск {tol:,.1f} км²)")
    overlap, worst = overlap_report(geoms, names, RESIDUAL_TOL_KM2)
    if overlap > RESIDUAL_TOL_KM2:
        problems.append(f"взаимные наложения: {overlap:,.6f} км²")
        for a, n1, n2 in worst[:10]:
            problems.append(f"    {a:12,.6f} км²  {n1} / {n2}")
    left = area_km2(clean(W.difference(unary_union(geoms))))
    if left > RESIDUAL_TOL_KM2:
        problems.append(f"непокрытый остаток: {left:,.6f} км²")

    def nv(g):
        return sum(len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors)
                   for p in (g.geoms if g.geom_type == "MultiPolygon" else [g])
                   if not g.is_empty)

    print(f"\n  морей на выходе: {len(geoms)}")
    print(f"  площадь: {area_before:,.3f} -> {area_after:,.3f} км² "
          f"(разница {area_after - area_before:+.3f})")
    print(f"  наложений: {overlap:.9f} км², непокрыто: {left:.9f} км²")
    print(f"  вершин: {sum(nv(g) for g in old_geoms):,} -> {sum(nv(g) for g in geoms):,}")

    if problems:
        print("\nОТКАЗ — файл не записан:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    # Геометрия мутируется НА МЕСТЕ: число фич, порядок и region_id те же,
    # поэтому каскад позиционных файлов не затрагивается вовсе.
    by_id = {id(f): g for f, g in zip(targets, geoms)}
    for f in feats:
        g = by_id.get(id(f))
        if g is not None:
            f["geometry"] = mapping(g)
            f["properties"]["area_km2"] = round(area_km2(g), 1)

    if args.dry_run:
        print("\n  --dry-run: ничего не записано")
        return 0
    dst = out("world_1946.geojson")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(world, f, ensure_ascii=False)
    print(f"\n  записано: {dst}")
    print("  дальше: build/rebuild_shared_edges.py --world out/world_1946.geojson,"
          " затем build/freeze_master_map.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
