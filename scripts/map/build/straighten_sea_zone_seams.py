"""
straighten_sea_zone_seams.py — линия раздела двух акваторий обязана быть
линией, а не пилой (2026-08-14).

ДЕФЕКТ. 85 океанских зон внедрены в мастер `build/apply_sea_zones.py` из
внешнего прототипа `sources/sea_zones_2026-08-06/`. Прототип нарезан в
проекции по сетке, и общие швы зон идут ступеньками: на рендере стык
`SEA-0097`/`SEA-0099` читается лестницей. Топология при этом цела — покрытие
мира сходится, `WATER_SHATTERED` 0, аудит зелёный. Это дефект ФОРМЫ ЛИНИИ, и
ни одна существующая проверка на него не смотрит.

ЧЕМ МЕРЯЕТСЯ. `build/diagnose_seas_iho.py --staircase`: доля вершин с
поворотом ~90°. Замер по мастеру до правки — 4 зоны выше 40% (худшие 58,6%),
12 в коридоре 20–40%, 166 чистых. ВСЕ 16 подозреваемых несут `naval_terrain`,
то есть пришли ровно этой партией; среди 97 ранних зон IHO лестничных ноль.
Доля отрезков «по осям» для этого НЕ ГОДИТСЯ — ступеньки перепроецированы и
наклонены, метрика объявляет обе зоны чистыми (подробности в докстроке
`right_angle_share`).

ПОЧЕМУ ХИРУРГИЯ. Мастер пересобрать нечем (8 из 11 входов пайплайна вне
репозитория), а `apply_sea_zones.py` второй раз не запускается по построению:
заменяемых океанских секторов в мастере уже нет. Поэтому правка идёт по
мастеру напрямую — как `fix_dalian_rio_master.py` и
`restore_china_curation_master.py`. Сам маршрут импорта тоже починен: тот же
примитив `geo_partition.straighten_seams` вызывается теперь и в
`apply_sea_zones.py`, чтобы восстановление мастера с нуля не вернуло лестницу.

ЧТО НЕ ТРОГАЕТСЯ. Берег, стык зон с 97 ранними морями, дырки-острова — вся
внешняя граница блока зон. Это постусловие самой `straighten_seams`, а не
намерение: она сверяет вершины результата на границе области с её
собственными и падает на первой новой. Без этого `coverage_is_valid`
становится False и `freeze_master_map.py` отказывается писать мастер.
Ботнический, Финский заливы и Ла-Манш (`SEA-0059`, `SEA-0058`, `SEA-0079`) в
разбор не входят вовсе: у них изрезан НАСТОЯЩИЙ берег, и это не дефект.

`area_km2` пересчитывается — правка геометрии обязана его двигать, иначе
площадь уезжает в `regions.core.json.area` и дальше в экономику региона.

Запуск:
    python scripts/map/build/straighten_sea_zone_seams.py --dry-run
    python scripts/map/build/straighten_sea_zone_seams.py
Затем обязательно:
    python scripts/map/build/freeze_master_map.py
    python scripts/map/build/diagnose_seas_iho.py --staircase
"""
import argparse
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import REPO_ROOT, out  # noqa: E402
from geo_partition import SEAM_TOL_DEG, area_km2, clean, straighten_seams  # noqa: E402
from diagnose_seas_iho import right_angle_share  # noqa: E402

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
META = REPO_ROOT / "scripts" / "map" / "master" / "master.meta.json"

# Признак партии: `ocean` есть только у зон, внедрённых apply_sea_zones.py.
# Отбор по имени или по `naval_terrain` был бы хуже — первое ломается на
# переименовании, второе на зоне, у которой поле не заполнено.
def is_zone(props) -> bool:
    return props.get("region_type") == "sea" and props.get("ocean") is not None


# Суммарная площадь зон обязана сохраниться: шов переносит площадь между
# соседями, а не создаёт её. Допуск того же порядка, что в apply_sea_zones.py
# (там 5e-7 относительных) — нодирование вставляет вершины, и `Geod` считает
# площадь по геодезическим между СОСЕДНИМИ вершинами, поэтому та же область с
# другим набором вершин даёт слегка другое число.
AREA_TOL_REL = 5e-7
# Остаток области после перераздачи. Не ноль: `difference` на геометрии такого
# размера оставляет нити машинной точности.
RESIDUAL_TOL_KM2 = 1.0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    ap.add_argument("--tol", type=float, default=SEAM_TOL_DEG,
                    help=f"допуск выпрямления в градусах (по умолчанию {SEAM_TOL_DEG})")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    feats = world["features"]
    idx = [i for i, f in enumerate(feats) if is_zone(f["properties"])]
    if not idx:
        raise SystemExit("в мастере нет океанских зон с полем `ocean` — "
                         "похоже, читается не тот файл")
    print(f"мастер: {len(feats)} фич, океанских зон {len(idx)}")

    geoms = [clean(shape(feats[i]["geometry"])) for i in idx]
    U = clean(unary_union(geoms))
    area_before = sum(area_km2(g) for g in geoms)
    print(f"  площадь зон до: {area_before:,.1f} км²")

    new = straighten_seams(geoms, U=U, tol=args.tol)

    # --- проверки, без которых файл не пишется ---
    problems = []
    empty = [feats[idx[k]]["properties"]["region_id"]
             for k, g in enumerate(new) if g.is_empty]
    if empty:
        problems.append(f"опустевшие зоны: {empty}")

    area_after = sum(area_km2(g) for g in new)
    if abs(area_after - area_before) > AREA_TOL_REL * area_before:
        problems.append(f"площадь зон: было {area_before:,.3f}, "
                        f"стало {area_after:,.3f}")

    union_new = unary_union(new)
    left = area_km2(clean(U.difference(union_new)))
    over = area_km2(clean(union_new.difference(U)))
    if left > RESIDUAL_TOL_KM2 or over > RESIDUAL_TOL_KM2:
        problems.append(f"область не сохранена: непокрыто {left:.6f} км², "
                        f"вылезло {over:.6f} км²")

    print(f"  площадь зон после: {area_after:,.1f} км² "
          f"({area_after - area_before:+.3f}, "
          f"{(area_after - area_before) / area_before:+.2e} относительно)")
    print(f"  непокрыто области: {left:.6f} км², вылезло за область: {over:.6f} км²")

    rows = []
    for k, i in enumerate(idx):
        s0, n0 = right_angle_share(geoms[k])
        s1, n1 = right_angle_share(new[k])
        rows.append((s0, s1, feats[i]["properties"]["region_id"],
                     feats[i]["properties"]["name"], n0, n1,
                     area_km2(geoms[k]), area_km2(new[k])))
    rows.sort(reverse=True)
    print(f"\n  доля поворотов ~90° (зоны, у которых до было >= 20%):")
    print(f"    {'зона':9s} {'имя':28s} {'до':>7s} {'после':>7s} "
          f"{'вершин':>14s} {'площадь, км²':>26s}")
    changed = []
    for s0, s1, rid, name, n0, n1, a0, a1 in rows:
        if s0 < 0.20:
            continue
        print(f"    {rid:9s} {str(name)[:28]:28s} {s0*100:6.1f}% {s1*100:6.1f}% "
              f"{n0:6d} -> {n1:6d} {a0:12,.0f} -> {a1:12,.0f}")
        changed.append((rid, name, a0, a1))
    worst_after = max(r[1] for r in rows)
    still = [r[2] for r in rows if r[1] >= 0.20]
    print(f"\n  максимум после: {worst_after*100:.1f}%; зон >= 20% после: {len(still)} {still}")

    if problems:
        print("\nОТКАЗ — файл не записан:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n  --dry-run: ничего не записано")
        return 0

    moved = 0
    for k, i in enumerate(idx):
        if new[k].equals(geoms[k]):
            continue
        moved += 1
        feats[i]["geometry"] = mapping(new[k])
        feats[i]["properties"]["area_km2"] = round(area_km2(new[k]), 1)
    print(f"\n  изменено зон: {moved} из {len(idx)}")

    dst = out("world_1946.geojson")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(world, f, ensure_ascii=False)
    print(f"  записано: {dst}")

    record_surgical_edit(area_before, area_after, moved, args.tol)
    print("  дальше: python scripts/map/build/freeze_master_map.py")
    return 0


def record_surgical_edit(area_before, area_after, moved, tol):
    """Провенанс правки — в `master.meta.json`, до заморозки.

    До, а не после: `freeze_master_map.py` переписывает meta целиком и
    переносит только уже существующий блок `_surgical_edits`. Запись, сделанная
    после заморозки, пережила бы её лишь до следующей — ровно так однажды и
    стёрлись записи про Далянь и курацию Китая.
    """
    if not META.is_file():
        print("  master.meta.json нет — запись о правке не сделана")
        return
    meta = json.loads(META.read_text(encoding="utf-8"))
    edits = [e for e in meta.get("_surgical_edits", [])
             if e.get("script") != "build/straighten_sea_zone_seams.py"]
    edits.append({
        "date": date.today().isoformat(),
        "script": "build/straighten_sea_zone_seams.py",
        "why": "швы 85 океанских зон пришли из прототипа ступеньками (нарезка в "
               "проекции по сетке); линия раздела двух акваторий обязана быть "
               "линией. Мастер пересобрать нечем, apply_sea_zones.py второй раз "
               "не запускается — заменяемых секторов в мастере уже нет",
        "changed": [
            f"выпрямлены внутренние швы блока зон, допуск {tol}° (~{tol * 111:.1f} км); "
            f"геометрия изменилась у {moved} зон из 85",
            "внешняя граница блока (берег, стык с 97 ранними морями, дырки-острова) "
            "не изменилась ни на вершину — постусловие geo_partition.straighten_seams",
        ],
        "delta": f"сумма площадей зон {area_before:,.1f} -> {area_after:,.1f} км² "
                 f"({area_after - area_before:+.3f}); число фич и region_id не менялись; "
                 f"area_km2 пересчитан у изменившихся зон",
    })
    meta["_surgical_edits"] = edits
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  запись о правке добавлена в {META.name}")


if __name__ == "__main__":
    sys.exit(main())
