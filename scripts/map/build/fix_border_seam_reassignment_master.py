"""
fix_border_seam_reassignment_master.py — хирургическая правка мастер-карты:
куски суши, физически встроенные в территорию СОСЕДНЕГО региона, но
приписанные не туда (T-2, реестр отделённых кусков, 2026-08-30).

ПОЧЕМУ ХИРУРГИЯ, А НЕ ПЕРЕСБОРКА. `make_1946.py --rebuild-master` недоступен
(G7: 8 из 15 входов пайплайна отсутствуют), правка идёт по мастеру напрямую —
тем же приёмом, что `fix_dalian_rio_master.py`.

МЕТОД, КОТОРЫЙ ЭТО НАШЁЛ И ПОДТВЕРДИЛ (записан в .claude/skills/
map-geometry-qa/SKILL.md). Имя сырой ADM1-единицы под куском НЕНАДЁЖНО —
раздутые/неточные raw-полигоны дают правдоподобное, но неверное имя (Ликома:
раздутый raw-полигон 198,8 км² вокруг видимого острова 21,9 км², куда меньше
самого раздутого; тот же приём чуть не увёл к неверному выводу и на этих
кусках). Решающий тест — РАССТОЯНИЕ: кусок с `distance(own_main_body)` в
десятки км, но `touches(neighbour)` с нулевым наложением, принадлежит
соседу, независимо от того, что говорит сырой источник.

ДЕФЕКТ 1: AFR-0055 (Malawi "Northern") несёт 21 кусок вдоль восточного
берега озера Малави, физически сросшихся с AFR-0093 (Tanzania "Ruvuma") —
40-71 км от главного тела Northern, touches(Ruvuma) с overlap=0 у каждого.
Вероятная природа — извилистая граница Malawi/Танзания, порезанная на
несвязанные многоугольники при сборке (тот же класс, что T-6 чинил для
морских швов, здесь суша против суши). Единственный кусок в этом кластере,
который остаётся у Northern, — Ликома (21,91 км², НЕ касается Ruvuma,
свободно плавающий остров в открытой воде, легитимно малавийский).

ДЕФЕКТ 2: NAM-0149 (Minnesota — Cass) несёт 8 кусков архипелага Айл-Ройял
и уголок у границы с Висконсином, физически сросшихся с соседями:
- 7 кусков touches(NAM-0153 Michigan — Marquette), 42-127 км от тела
  Minnesota — Cass. Остров Айл-Ройял реально принадлежит округу Кивино,
  Мичиган; бо́льшая часть острова УЖЕ у Michigan — Marquette (зелёная на
  рендере), эти 7 — рваный край, не весь остров;
- 1 кусок (1,11 км²) touches(NAM-0236 Wisconsin — Barron), 5,9 км от тела
  Minnesota — Cass (стык границ у Дулута/Superior).

Правится только геометрия (union в принимающий регион, difference у
отдающего) и area_km2 обеих сторон каждой пары. Ownership/economy не
трогаются здесь — они каскадно пересчитываются полным пайплайном
(generate_country_registry.py, fill_region_economy_1946.py) после этой
правки, как и для любой другой хирургической правки мастера.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402

# ВАЖНО (найдено 2026-08-30, собственная ошибка этого скрипта в процессе
# правки): `area_km2` здесь — ГОЛЫЙ geodesic, без planar-ограничения
# (safe_area_km2 из audit_region_fragments.py/audit_map_geometry.py).
# Так и должно быть — `verify_area_matches_geometry.py` (реальный гейт
# пайплайна) сверяет `area_km2` свойства ИМЕННО с этим голым расчётом;
# попытка "защитить" его safe_area_km2 разошлась с гейтом на 184-487 км²
# у трёх регионов и была отменена в том же заходе. safe_area_km2 —
# инструмент FRAGMENT-классификации (чтобы не забраковать по площади
# нормальный узкий остров), не формула для записи в area_km2.

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"

# (отдающий, принимающий, минимальная площадь куска, чтобы не задеть
# крошки < MIN_FRAGMENT_KM2 порога аудита — здесь порог 0, переносим всё,
# что действительно touches(принимающий) и не является главным телом)
TRANSFERS = [
    ("AFR-0055", "AFR-0093"),
    ("NAM-0149", "NAM-0153"),
    ("NAM-0149", "NAM-0236"),
]


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    by_rid = {ft["properties"]["region_id"]: ft for ft in data["features"]}

    # Группируем переносы по отдающему региону — у NAM-0149 их два (Michigan
    # и Wisconsin), различать куски нужно ОДНИМ проходом по его частям, не
    # двумя независимыми (второй проход после первой мутации работал бы уже
    # с изменённой геометрией).
    by_donor = {}
    for donor, recipient in TRANSFERS:
        by_donor.setdefault(donor, []).append(recipient)

    updates = {}  # region_id -> new shapely geometry
    report = []

    for donor, recipients in by_donor.items():
        donor_ft = by_rid.get(donor)
        if donor_ft is None:
            raise SystemExit(f"ОТКАЗ: донор {donor} не найден в мастере")
        donor_geom = shape(donor_ft["geometry"])
        donor_parts = list(donor_geom.geoms) if donor_geom.geom_type == "MultiPolygon" else [donor_geom]
        if len(donor_parts) < 2:
            raise SystemExit(f"ОТКАЗ: {donor} — не MultiPolygon с несколькими частями")
        main_body = max(donor_parts, key=lambda p: area_km2(p))

        recipient_geoms = {}
        for rid in recipients:
            ft = by_rid.get(rid)
            if ft is None:
                raise SystemExit(f"ОТКАЗ: получатель {rid} не найден в мастере")
            recipient_geoms[rid] = shape(ft["geometry"])

        movers_by_recipient = {rid: [] for rid in recipients}
        kept_parts = [main_body]
        for part in donor_parts:
            if part is main_body:
                continue
            matched = None
            for rid, geom in recipient_geoms.items():
                if part.touches(geom):
                    matched = rid
                    break
            if matched:
                movers_by_recipient[matched].append(part)
            else:
                kept_parts.append(part)

        for rid, parts in movers_by_recipient.items():
            if not parts:
                raise SystemExit(f"ОТКАЗ: ни одного куска {donor}->{rid} не найдено — "
                                  f"проверь TRANSFERS, состав мог измениться")
            merged = unary_union([recipient_geoms[rid]] + parts)
            if not merged.is_valid:
                raise SystemExit(f"ОТКАЗ: {rid} после объединения получил невалидную геометрию")
            updates[rid] = merged
            report.append((donor, rid, len(parts), sum(area_km2(p) for p in parts)))

        new_donor = unary_union(kept_parts) if len(kept_parts) > 1 else kept_parts[0]
        if not new_donor.is_valid:
            raise SystemExit(f"ОТКАЗ: {donor} после difference получил невалидную геометрию")
        updates[donor] = new_donor
        report.append((donor, "(остаток у себя)", len(kept_parts) - 1,
                        sum(area_km2(p) for p in kept_parts[1:])))

    print("  Перенос:")
    for donor, rid, n, a in report:
        print(f"    {donor} -> {rid}: {n} кусков, {a:.3f} км²")

    if args.dry_run:
        print("\n  --dry-run: мастер не тронут")
        return 0

    for rid, geom in updates.items():
        by_rid[rid]["geometry"] = mapping(geom)
        by_rid[rid]["properties"]["area_km2"] = round(area_km2(geom), 1)

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"\n  мастер перезаписан: {MASTER_PATH}")
    print("  новые area_km2:")
    for rid in updates:
        print(f"    {rid}: {by_rid[rid]['properties']['area_km2']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
