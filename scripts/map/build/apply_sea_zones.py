"""
apply_sea_zones.py — заменяет океанские секторы мастера на морские зоны.

ЗАЧЕМ. Нарезка океанов (85 зон, сессия 2026-08-06, `docs/DECISIONS.md`
2026-08-07) существовала пятью файлами `zones_<океан>.geojson` и никуда не
внедрялась: интеграции в водный слой не было. Этот скрипт её и делает.

ЧТО ЗАМЕНЯЕТСЯ. Ровно те морские регионы мастера, чьё имя оканчивается на
«Sector» и не начинается на «Arctic»: шестнадцать крупных океанских секторов
(Южная Атлантика 2, Южная Пацифика 4, Индийский 3, Северная Пацифика 4,
Северная Атлантика 3). Арктические секторы остаются: файлов зон для Арктики
нет, и придумывать их здесь нельзя. Именованные моря (Коралловое, Банда,
Средиземное…) не трогаются вовсе.

ПОЧЕМУ НЕЛЬЗЯ ПРОСТО ПОДСТАВИТЬ ЗОНЫ. Зоны строились против водного слоя
прототипа, а не против мастера, и с ним не совпадают (замер 2026-08-08):
зоны вылезают за союз секторов на 32 523 км² (из них 30 113 км² — поверх
ДРУГИХ именованных морей мастера, крупнейший кусок 28 408 км² в Хальмахере),
а внутри союза остаются непокрытыми 16 138 км². Наивная подстановка сдвинула
бы площадь воды на +16 435 км².

КОНСТРУКЦИЯ, которая этого не допускает: заменяемая вода `U` — союз шестнадцати
секторов — ПЕРЕРАСПРЕДЕЛЯЕТСЯ между зонами, а не подменяется.

  1. каждая зона обрезается по `U`   -> ничего чужого и ничего за берегом;
  2. взаимные наложения зон снимаются попарно -> разбиение, а не покрытие;
  3. границы нодируются и `polygonize` даёт мозаику, чьи рёбра общие ПО
     ПОСТРОЕНИЮ; ячейка без хозяина уходит соседу с самой длинной общей
     границей (gap-first), изолированная — ближайшей зоне.

Шаг 3 — не украшение: без него у двух соседних зон вдоль общего шва разное
число вершин, `coverage_is_valid` ложится и `freeze_master_map.py` отказывается
писать мастер. Примитивы вынесены в `build/geo_partition.py` — та же задача
встала второй раз на Филиппинах.

Берег при этом не трогается вовсе: `U` взят из самого мастера, и обрезка по
нему не может сдвинуть ни одной береговой вершины.

ПРОВЕРКИ — В САМОМ СКРИПТЕ, а не в отчёте: сумма площадей зон обязана совпасть
с суммой площадей заменённых секторов, взаимных наложений 0, непокрытого
остатка 0, пустых зон 0. Не сошлось — файл не записывается.

Площадь: считать союз секторов геодезически ЦЕЛИКОМ нельзя — область больше
полусферы, и `Geod` возвращает дополнение (замер: 236 796 689 вместо
273 271 745 км², то есть ровно поверхность Земли минус искомое). Поэтому
суммы всегда берутся по отдельным фичам, а союзы — только для разностей,
которые заведомо малы. Это же соображение — в `geo_partition.area_km2`.

Вход:
  scripts/map/master/world_1946.master.geojson
  <sources>/sea_zones_2026-08-06/zones_*.geojson

Выход:
  scripts/map/out/world_1946.geojson — далее build/freeze_master_map.py
  проверяет дыры/coverage и пишет мастер.

Запуск:
    python scripts/map/build/apply_sea_zones.py
    python scripts/map/build/apply_sea_zones.py --dry-run   (только замер)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import REPO_ROOT, out, source  # noqa: E402
from geo_partition import (  # noqa: E402
    area_km2, clean, overlap_report, parts, strip_overlaps, tile_by_cells,
)

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
ZONES_DIR = "sea_zones_2026-08-06"

# Порядок океанов = порядок секторов, которые они заменяют (SEA-0096 и далее).
OCEAN_FILES = [
    ("zones_south_atlantic_ocean.geojson", "South Atlantic"),
    ("zones_south_pacific_ocean.geojson", "South Pacific"),
    ("zones_indian_ocean.geojson", "Indian Ocean"),
    ("zones_north_pacific_ocean.geojson", "North Pacific"),
    ("zones_north_atlantic_ocean.geojson", "North Atlantic"),
]

# Допуск на сумму площадей. Абсолютный ±1 км² на этой операции недостижим, и
# это свойство геодезии, а не программы (замер 2026-08-08):
# нодирование границ вставляет новые вершины, а `Geod` считает площадь по
# геодезическим между СОСЕДНИМИ вершинами — вставленная точка лежит на
# планарной хорде, а не на геодезической, поэтому тот же самый регион с другим
# набором вершин даёт слегка другую площадь. Что регион ТОТ ЖЕ, доказывается
# отдельно и точно: обе разности с `U` равны нулю.
# Порядок величины у самого проекта: `build/rebuild_shared_edges.py` в своём
# докстринге фиксирует «+0.1 км² из 75 534» — это 1,3e-6. Здесь 2,3e-7.
AREA_TOL_KM2 = 1.0
AREA_TOL_REL = 5e-7
# Допуск на непокрытый остаток после раздачи. Не ноль: `difference` на
# геометрии такого размера оставляет нити машинной точности (площадь
# 1e-9 км² и меньше), которые не являются дырой ни для кого.
RESIDUAL_TOL_KM2 = 1e-4


def is_replaced_sector(props) -> bool:
    name = props.get("name", "")
    return (props.get("region_type") == "sea"
            and name.endswith("Sector")
            and not name.startswith("Arctic"))


def load_zones():
    """85 зон в порядке океанов; имя, terrain и геометрия."""
    zones = []
    for fname, ocean in OCEAN_FILES:
        path = Path(source(ZONES_DIR)) / fname
        if not path.is_file():
            raise SystemExit(
                f"нет входного файла {path}\n"
                f"  Зоны лежат в общем хранилище источников (см. build/paths.py и\n"
                f"  docs/provenance/MAP_GEOMETRY_PROVENANCE.md). Пересборка с нуля —\n"
                f"  README.source.md в том же каталоге.")
        fc = json.loads(path.read_text(encoding="utf-8"))
        for ft in sorted(fc["features"], key=lambda f: f["properties"]["name"]):
            zones.append({
                "name": ft["properties"]["name"],
                "naval_terrain": ft["properties"].get("naval_terrain"),
                "ocean": ocean,
                "geom": clean(shape(ft["geometry"])),
            })
    return zones


def repartition(zones, U):
    """Разбиение U между зонами: обрезка -> снятие наложений -> мозаика."""
    clipped = [clean(z["geom"].intersection(U)) for z in zones]
    print(f"  снято взаимных наложений зон: {strip_overlaps(clipped):,.3f} км²")
    return tile_by_cells(clipped, U)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    feats = world["features"]
    sectors = [f for f in feats if is_replaced_sector(f["properties"])]
    if not sectors:
        raise SystemExit("в мастере нет заменяемых океанских секторов — "
                         "похоже, зоны уже внедрены")
    keep = [f for f in feats if not is_replaced_sector(f["properties"])]
    print(f"мастер: {len(feats)} фич, заменяемых секторов {len(sectors)}")
    for f in sectors:
        print(f"    {f['properties']['region_id']}  {f['properties']['name']}")

    sector_geoms = [clean(shape(f["geometry"])) for f in sectors]
    area_before = sum(area_km2(g) for g in sector_geoms)
    U = clean(unary_union(sector_geoms))
    print(f"  площадь заменяемой воды: {area_before:,.1f} км²")

    zones = load_zones()
    print(f"зон на входе: {len(zones)}")
    geoms = repartition(zones, U)

    # --- проверки, без которых файл не пишется ---
    problems = []
    empty = [zones[i]["name"] for i, g in enumerate(geoms) if g.is_empty]
    if empty:
        problems.append(f"опустевшие зоны: {empty}")

    area_after = sum(area_km2(g) for g in geoms)
    tol = max(AREA_TOL_KM2, AREA_TOL_REL * area_before)
    if abs(area_after - area_before) > tol:
        problems.append(f"площадь воды: было {area_before:,.3f}, стало {area_after:,.3f} "
                        f"(допуск {tol:,.1f} км²)")

    overlap, worst = overlap_report(geoms, [z["name"] for z in zones], RESIDUAL_TOL_KM2)
    if overlap > RESIDUAL_TOL_KM2:
        problems.append(f"взаимные наложения зон: {overlap:,.6f} км²")
        for a, n1, n2 in worst[:10]:
            problems.append(f"    {a:12,.6f} км²  {n1} / {n2}")

    left = area_km2(clean(U.difference(unary_union(geoms))))
    if left > RESIDUAL_TOL_KM2:
        problems.append(f"непокрытый остаток U: {left:,.6f} км²")

    print(f"\n  зон на выходе: {len(geoms)}")
    print(f"  площадь: {area_before:,.3f} -> {area_after:,.3f} км² "
          f"(разница {area_after - area_before:+.3f}, "
          f"{(area_after - area_before) / area_before:+.2e} относительно)")
    print(f"  наложений: {overlap:.9f} км², непокрыто: {left:.9f} км²")

    if problems:
        print("\nОТКАЗ — файл не записан:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    # --- сборка новых фич ---
    # Морские регионы идут в мастере после суши, поэтому их количество не
    # двигает числовые id сухопутных регионов (import_to_game.py нумерует
    # фичи по порядку). Внутри блока SEA- нумерация сплошная: заменяемые
    # секторы стояли последними перед Арктикой, зоны встают на их место.
    others = [f for f in keep if not f["properties"]["region_id"].startswith("SEA-")]
    kept_seas = sorted((f for f in keep if f["properties"]["region_id"].startswith("SEA-")),
                       key=lambda f: f["properties"]["region_id"])
    arctic = [f for f in kept_seas if f["properties"]["name"].startswith("Arctic")]
    plain = [f for f in kept_seas if not f["properties"]["name"].startswith("Arctic")]

    new_seas = []
    n = 0
    for f in plain:
        n += 1
        f["properties"]["region_id"] = f"SEA-{n:04d}"
        new_seas.append(f)
    for z, g in zip(zones, geoms):
        n += 1
        new_seas.append({
            "type": "Feature",
            "properties": {
                "region_id": f"SEA-{n:04d}",
                "continent": None,
                "region_type": "sea",
                "name": z["name"],
                "area_km2": round(area_km2(g), 1),
                "naval_terrain": z["naval_terrain"],
                "ocean": z["ocean"],
            },
            "geometry": mapping(g),
        })
    for f in arctic:
        n += 1
        f["properties"]["region_id"] = f"SEA-{n:04d}"
        new_seas.append(f)

    land = [f for f in others if not f["properties"]["region_id"].startswith("LAK-")]
    lakes = [f for f in others if f["properties"]["region_id"].startswith("LAK-")]
    result = {"type": "FeatureCollection", "features": land + new_seas + lakes}
    print(f"  фич: {len(feats)} -> {len(result['features'])} "
          f"(море {len(sectors) + len(kept_seas)} -> {len(new_seas)})")

    if args.dry_run:
        print("\n  --dry-run: ничего не записано")
        return 0

    dst = out("world_1946.geojson")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"\n  записано: {dst}")
    print("  дальше: python scripts/map/build/freeze_master_map.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
