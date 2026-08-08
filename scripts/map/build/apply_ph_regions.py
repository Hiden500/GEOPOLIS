"""
apply_ph_regions.py — заменяет 36 филиппинских регионов мастера на 29.

ЗАЧЕМ. `build/build_ph_regions_1946.py` строит итоговую нарезку Филиппин
(вариант C, выбор пользователя 2026-08-02: 29 исторических областей вместо 36
современных админрегионов) — и её никто не потреблял. Файл
`out/ph_regions_1946.geojson` производился и оставался лежать. Этот скрипт его
и применяет.

ЧТО В МАСТЕРЕ СЕЙЧАС. 36 фич с `iso_a2 == "PH"`, и лежат они ДВУМЯ кусками
нумерации (`ASI-0288`…`ASI-0304` и `ASI-0426`…`ASI-0444`) — след более поздней
досборки островов. Новые 29 встают ОДНИМ блоком на позицию первого из старых,
после чего весь блок `ASI-` перенумеровывается подряд.

ПОЧЕМУ ЭТО НЕ ПРОСТАЯ ПОДСТАНОВКА. Новая нарезка построена из `game_map.json`
(81 провинция по `region_sub`, затем укрупнение), а мастер прошёл сшивку и
пересборку общих рёбер. Замер 2026-08-08 показал, что здесь повезло:
союзы совпадают тождественно — `area(новые − мастер) = 0` и
`area(мастер − новые) = 0` при 293 035,6 км² с обеих сторон. Но полагаться на
везение нельзя, поэтому применяется та же конструкция, что и к морским зонам:
площадь мастера ПЕРЕРАСПРЕДЕЛЯЕТСЯ между новыми регионами
(`build/geo_partition.py`), а не подменяется. Совпали союзы — конструкция
ничего не меняет; разойдутся при следующей правке источника — сохранит берег
и площадь.

ЧЕГО ЗДЕСЬ НЕТ. Старая фича НЕ обязана попасть ровно в одну новую: 36
современных админрегионов не вкладываются в 29 исторических (ARMM
распределяется между Ланао, Котабато и Сулу). Проверяется поэтому не
вложенность, а то, что действительно обязано выполняться: суша не потеряна и
не задвоена.

КАСКАД. Филиппины уменьшаются на 7 регионов — позиционная нумерация всего, что
идёт после них, сдвигается. Обязателен `build/remap_region_ids.py`, а русские
имена 29 новых регионов надо добавить в `out/names_ru.json` руками: ремап
переносит только то, что уже существовало.

Вход:
  scripts/map/master/world_1946.master.geojson
  scripts/map/out/ph_regions_1946.geojson  (build_ph_regions_1946.py)

Выход:
  scripts/map/out/world_1946.geojson — далее build/rebuild_shared_edges.py
  --world и build/freeze_master_map.py.

Запуск:
    python scripts/map/build/apply_ph_regions.py
    python scripts/map/build/apply_ph_regions.py --dry-run
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
SOURCE = "ph_regions_1946.geojson"
ISO = "PH"
PREFIX = "ASI-"
EXPECT_OLD, EXPECT_NEW = 36, 29

AREA_TOL_KM2 = 1.0
AREA_TOL_REL = 5e-7
RESIDUAL_TOL_KM2 = 1e-4


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    feats = world["features"]
    old = [f for f in feats if f["properties"].get("iso_a2") == ISO]
    if len(old) == EXPECT_NEW:
        raise SystemExit(f"в мастере уже {EXPECT_NEW} филиппинских регионов — "
                         f"похоже, нарезка уже применена")
    if len(old) != EXPECT_OLD:
        raise SystemExit(f"ожидалось {EXPECT_OLD} фич с iso_a2={ISO}, найдено {len(old)}")

    src = Path(out(SOURCE))
    if not src.is_file():
        raise SystemExit(f"нет {src}: сначала запусти build/build_ph_regions_1946.py")
    new_fc = json.loads(src.read_text(encoding="utf-8"))
    new = sorted(new_fc["features"], key=lambda f: f["properties"]["name"])
    if len(new) != EXPECT_NEW:
        raise SystemExit(f"в {SOURCE} {len(new)} фич, ожидалось {EXPECT_NEW}")

    old_geoms = [clean(shape(f["geometry"])) for f in old]
    area_before = sum(area_km2(g) for g in old_geoms)
    M = clean(unary_union(old_geoms))
    print(f"мастер: {len(feats)} фич; {ISO} {len(old)} -> {len(new)}")
    print(f"  площадь Филиппин в мастере: {area_before:,.1f} км²")

    names = [f["properties"]["name"] for f in new]
    raw = [clean(shape(f["geometry"])) for f in new]
    print(f"  нарезка на входе: {sum(area_km2(g) for g in raw):,.1f} км²")
    print(f"    новые вне мастера: {area_km2(clean(unary_union(raw).difference(M))):,.3f} км²")
    print(f"    мастер вне новых : {area_km2(clean(M.difference(unary_union(raw)))):,.3f} км²")

    clipped = [clean(g.intersection(M)) for g in raw]
    print(f"  снято взаимных наложений: {strip_overlaps(clipped):,.3f} км²")
    geoms = tile_by_cells(clipped, M)

    # --- проверки, без которых файл не пишется ---
    problems = []
    empty = [names[i] for i, g in enumerate(geoms) if g.is_empty]
    if empty:
        problems.append(f"опустевшие регионы: {empty}")

    area_after = sum(area_km2(g) for g in geoms)
    tol = max(AREA_TOL_KM2, AREA_TOL_REL * area_before)
    if abs(area_after - area_before) > tol:
        problems.append(f"площадь суши Филиппин: было {area_before:,.3f}, "
                        f"стало {area_after:,.3f} (допуск {tol:,.3f} км²)")

    overlap, worst = overlap_report(geoms, names, RESIDUAL_TOL_KM2)
    if overlap > RESIDUAL_TOL_KM2:
        problems.append(f"взаимные наложения: {overlap:,.6f} км²")
        for a, n1, n2 in worst[:10]:
            problems.append(f"    {a:12,.6f} км²  {n1} / {n2}")

    left = area_km2(clean(M.difference(unary_union(geoms))))
    if left > RESIDUAL_TOL_KM2:
        problems.append(f"непокрытый остаток суши: {left:,.6f} км²")

    print(f"\n  регионов на выходе: {len(geoms)}")
    print(f"  площадь: {area_before:,.3f} -> {area_after:,.3f} км² "
          f"(разница {area_after - area_before:+.3f})")
    print(f"  наложений: {overlap:.9f} км², непокрыто: {left:.9f} км²")

    if problems:
        print("\nОТКАЗ — файл не записан:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    # --- сборка: 29 одним блоком на позицию первого старого ---
    old_ids = {f["properties"]["region_id"] for f in old}
    asia = [f for f in feats if f["properties"]["region_id"].startswith(PREFIX)]
    others = [f for f in feats if not f["properties"]["region_id"].startswith(PREFIX)]
    insert_at = next(i for i, f in enumerate(asia)
                     if f["properties"]["region_id"] in old_ids)
    kept = [f for f in asia if f["properties"]["region_id"] not in old_ids]

    made = []
    for f, g in zip(new, geoms):
        made.append({
            "type": "Feature",
            "properties": {
                "region_id": None,
                "continent": "Asia",
                "region_type": "land",
                "iso_a2": ISO,
                "name": f["properties"]["name"],
                "area_km2": round(area_km2(g), 1),
            },
            "geometry": mapping(g),
        })
    block = kept[:insert_at] + made + kept[insert_at:]
    for i, f in enumerate(block, start=1):
        f["properties"]["region_id"] = f"{PREFIX}{i:04d}"

    # Мастер лежит блоками континентов в исходном порядке — восстанавливаем его.
    head = [f for f in others if not f["properties"]["region_id"].startswith(
        ("NAM-", "SAM-", "AFR-", "OCE-", "ANT-", "SEA-", "LAK-"))]
    tail = [f for f in others if f["properties"]["region_id"].startswith(
        ("NAM-", "SAM-", "AFR-", "OCE-", "ANT-", "SEA-", "LAK-"))]
    result = {"type": "FeatureCollection", "features": head + block + tail}
    print(f"  фич: {len(feats)} -> {len(result['features'])}; "
          f"блок {PREFIX} {len(asia)} -> {len(block)}")

    if args.dry_run:
        print("\n  --dry-run: ничего не записано")
        return 0

    dst = out("world_1946.geojson")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"\n  записано: {dst}")
    print("  дальше: build/rebuild_shared_edges.py --world out/world_1946.geojson,"
          " затем build/freeze_master_map.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
