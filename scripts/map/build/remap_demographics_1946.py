"""
remap_demographics_1946.py — переносит демографический слой через изменение
состава регионов.

ЗАЧЕМ. `config/demographics_1946.json` — ШЕСТОЙ позиционный файл (найден
2026-08-08), и единственный, привязанный не к строковому `region_id`, а к
ЧИСЛОВОМУ `id` из `regions.core.json`, который `import_to_game.py` присваивает
по порядку фич. `remap_region_ids.py` его не видит и видеть не может: он
работает со строковыми id. При этом файл курируемый — 1399 записей
этнического состава с провенансом по каждому региону
(`docs/provenance/DEMOGRAPHICS_1946_PROVENANCE.md`), терять его нельзя.

Симптом рассинхрона мягкий и потому опасный: пока новых регионов не МЕНЬШЕ
старых, валидатор молчит, а состав просто съезжает на соседние регионы.
Громко падает только когда регионов стало меньше («регион 1390 не существует»).

СЛОЙ БЫЛ УЖЕ СМЕЩЁН ДО ЭТОЙ ПРАВКИ. Замер 2026-08-08: слой написан под мир из
1399 регионов (коммит `1b67bcd`), где ложится идеально — id 900 = Campeche и
майя, 1100 = Córdoba и италоаргентинцы, 1300 = Masvingo и шона, 1399 = Pohnpei
и микронезийцы. Позже мир вырос до 1444, и те же числа стали означать другие
регионы: id 1300 — уже камерунский «Nord» с зимбабвийским составом, id 1399 —
Южная Австралия с микронезийским. Поэтому опорой берётся НЕ предыдущее
состояние, а мир того коммита, под который слой писался: чинить надо от места,
где данные верны, иначе перенос закрепит порчу.

КАК ПЕРЕНОСИТСЯ. Двумя разными способами, и это осознанно:

  выживший регион  — запись копируется ДОСЛОВНО. Сопоставление идёт по паре
                     (имя, iso_a2) между опорным и текущим клиентским
                     `world_1946.geojson` тем же `build_remap`, что и у
                     `remap_region_ids.py`, поэтому курируемые доли не
                     перетряхиваются арифметикой;
  новый регион     — смесь долей тех старых регионов, которые он покрывает.
                     Вес = население старого региона × доля его площади,
                     попавшая в новый. То есть оценка «сколько людей оттуда
                     оказалось здесь» — так требует и сама островная запись
                     («доли групп усредняются ВЗВЕШЕННО по населению»).
                     Способ один на все случаи: слияние, раздел и
                     перенарезку Филиппин, где 36 старых регионов не
                     вкладываются в 29 новых вообще.

Смесь режется до `MAX_GROUPS` крупнейших групп и нормируется — таковы
инварианты `validate_demographics_1946.py` (максимум 4 группы, сумма долей
1.0 ± 0.001, каждая доля строго больше нуля).

Регион без покрытия остаётся без записи: частичное покрытие штатно, а
выдуманный состав — нет.

Вход:  --ref-world, --ref-core, --ref-state — снимки коммита, под который слой
       писался (`git show 1b67bcd:...`), а НЕ предыдущего состояния;
       client/public/world_1946.geojson и regions.core.json (пересобранные);
       scripts/map/config/demographics_1946.json (старый, числовые id)
Выход: scripts/map/config/demographics_1946.json (новые числовые id)

Запуск:
    python scripts/map/build/remap_demographics_1946.py \
        --ref-world <...> --ref-core <...> --ref-state <...> [--dry-run]
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import REPO_ROOT  # noqa: E402
from geo_partition import area_km2, clean  # noqa: E402
from remap_region_ids import build_remap, region_props_by_id  # noqa: E402

from shapely.geometry import shape  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WORLD = REPO_ROOT / "client" / "public" / "world_1946.geojson"
CORE = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "regions.core.json"
SOURCE = REPO_ROOT / "scripts" / "map" / "config" / "demographics_1946.json"
SPOT = REPO_ROOT / "scripts" / "map" / "data" / "historical_spot_checks_1946.json"
PREFIXES = ("EUR-", "ASI-", "NAM-", "SAM-", "AFR-", "OCE-", "ANT-", "SEA-", "LAK-")
MAX_GROUPS = 4


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref-world", required=True)
    ap.add_argument("--ref-core", required=True)
    ap.add_argument("--ref-state", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    old_world = load(args.ref_world)
    new_world = load(WORLD)
    remap = {}
    for pref in PREFIXES:
        part, _unres, _amb = build_remap(region_props_by_id(old_world, pref),
                                         region_props_by_id(new_world, pref))
        remap.update(part)

    old_core = load(args.ref_core)
    old_state = {r["id"]: r for r in load(args.ref_state)}
    new_core = load(CORE)
    old_gid_by_num = {r["id"]: r["geoJsonId"] for r in old_core}
    new_num_by_gid = {r["geoJsonId"]: r["id"] for r in new_core}
    old_pop_by_gid = {r["geoJsonId"]: old_state.get(r["id"], {}).get("population", 0)
                      for r in old_core}

    src = load(SOURCE)["regions"]
    old_groups_by_gid = {}
    for entry in src:
        gid = old_gid_by_num.get(entry["regionId"])
        if gid:
            old_groups_by_gid[gid] = entry["groups"]
    print(f"исходных записей {len(src)}, привязано к region_id {len(old_groups_by_gid)}")

    # --- 1. выжившие: дословный перенос ---
    out = {}
    carried = 0
    for gid, groups in old_groups_by_gid.items():
        new_gid = remap.get(gid)
        if new_gid and new_gid in new_num_by_gid:
            out[new_num_by_gid[new_gid]] = groups
            carried += 1
    print(f"перенесено дословно: {carried}")

    # --- 2. новые регионы: смесь по перекрытию ---
    old_geom = {f["properties"]["region_id"]: clean(shape(f["geometry"]))
                for f in old_world["features"]
                if f["properties"]["region_id"] in old_groups_by_gid}
    if not old_geom:
        print("нет старых геометрий с разметкой — смешивать нечего")
    keys = list(old_geom)
    tree = STRtree([old_geom[k] for k in keys])
    old_area = {k: area_km2(old_geom[k]) for k in keys}

    new_by_gid = {f["properties"]["region_id"]: f for f in new_world["features"]}
    old_geom_all = {f["properties"]["region_id"]: clean(shape(f["geometry"]))
                    for f in old_world["features"]}
    old_name = {f["properties"]["region_id"]: f["properties"].get("name")
                for f in old_world["features"]}
    new_name = {gid: ft["properties"].get("name") for gid, ft in new_by_gid.items()}
    new_land = [gid for gid in new_num_by_gid if gid in new_by_gid]
    new_geom = {gid: clean(shape(new_by_gid[gid]["geometry"])) for gid in new_land}
    new_area = {gid: area_km2(new_geom[gid]) for gid in new_land}
    new_tree = STRtree([new_geom[g] for g in new_land])

    def successors(gid):
        """Текущие регионы, больше половины площади которых лежит в старом."""
        src_g = old_geom_all[gid]
        heirs = []
        for i in (int(i) for i in new_tree.query(src_g)):
            h = new_land[i]
            if new_area[h] <= 0 or not new_geom[h].intersects(src_g):
                continue
            if area_km2(new_geom[h].intersection(src_g)) / new_area[h] > 0.5:
                heirs.append(h)
        return heirs

    missing = [gid for gid, num in new_num_by_gid.items() if num not in out]
    blended, uncovered = 0, 0
    for gid in sorted(missing):
        ft = new_by_gid.get(gid)
        if ft is None:
            continue
        g = clean(shape(ft["geometry"]))
        weights = defaultdict(float)
        for i in (int(i) for i in tree.query(g)):
            k = keys[i]
            if not old_geom[k].intersects(g):
                continue
            inter = area_km2(old_geom[k].intersection(g))
            if inter <= 0 or old_area[k] <= 0:
                continue
            w = old_pop_by_gid.get(k, 0) * (inter / old_area[k])
            if w <= 0:
                continue
            for s in old_groups_by_gid[k]:
                weights[s["groupId"]] += w * s["share"]
        if not weights:
            uncovered += 1
            continue
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:MAX_GROUPS]
        total = sum(v for _g, v in top)
        groups = []
        for j, (g_id, v) in enumerate(top):
            share = round(v / total, 4)
            if share <= 0:
                continue
            groups.append({"groupId": g_id, "share": share})
        if not groups:
            uncovered += 1
            continue
        # нормировка на строгую сумму 1.0: остаток кладём в крупнейшую группу
        drift = round(1.0 - sum(x["share"] for x in groups), 4)
        groups[0]["share"] = round(groups[0]["share"] + drift, 4)
        groups = [x for x in groups if x["share"] > 0]
        out[new_num_by_gid[gid]] = groups
        blended += 1
        print(f"   смесь {gid} {ft['properties']['name']}: "
              + ", ".join(f"{x['groupId']} {x['share']}" for x in groups))
    print(f"\nсобрано смесью: {blended}; без покрытия оставлено без записи: {uncovered}")

    regions = [{"regionId": num, "groups": grp} for num, grp in sorted(out.items())]
    print(f"итого записей: {len(src)} -> {len(regions)}")

    # --- 3. курируемые спот-чеки: тот же слой, та же опора, тот же ключ ---
    # `data/historical_spot_checks_1946.json` ссылается на регионы ЧИСЛОВЫМ id
    # и потому смещается вместе с демографией. Проверки ERROR-уровня: запись,
    # ссылающаяся не на тот регион, либо блокирует правду, либо пропускает
    # выдумку. Замер 2026-08-08: 5 из 8 чеков падали, 3 совпадали случайно.
    spot_out = []
    if SPOT.is_file():
        spot = load(SPOT)
        for check in spot.get("checks", []):
            new_ids, lost = [], []
            for num in check.get("regions", []):
                gid = old_gid_by_num.get(num)
                new_gid = remap.get(gid) if gid else None
                if new_gid and new_gid in new_num_by_gid:
                    new_ids.append(new_num_by_gid[new_gid])
                elif gid and gid in old_geom_all:
                    # регион исчез как имя (слияние/раздел/переименование) —
                    # берём его ГЕОМЕТРИЧЕСКИХ преемников: те текущие регионы,
                    # чья площадь больше чем наполовину лежит внутри старого.
                    heirs = successors(gid)
                    if heirs:
                        new_ids += [new_num_by_gid[h] for h in heirs
                                    if h in new_num_by_gid]
                        print(f"   {check['id']}: {num} «{old_name.get(gid)}» -> "
                              + ", ".join(f"{new_num_by_gid[h]} «{new_name.get(h)}»"
                                          for h in heirs if h in new_num_by_gid))
                    else:
                        lost.append((num, old_name.get(gid)))
                else:
                    lost.append((num, old_name.get(gid)))
            if lost:
                print(f"   ⚠ {check['id']}: не разрешены {lost}")
            check["regions"] = sorted(set(new_ids))
            spot_out.append(check)
        print(f"спот-чеков перенесено: {len(spot_out)}")

    bad = [r["regionId"] for r in regions
           if abs(sum(x["share"] for x in r["groups"]) - 1.0) > 0.001
           or len(r["groups"]) > MAX_GROUPS
           or any(not (0 < x["share"] <= 1) for x in r["groups"])]
    if bad:
        print(f"ОТКАЗ: записи вне инвариантов: {bad[:10]}", file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n  --dry-run: файлы не изменены")
        return 0
    with open(SOURCE, "w", encoding="utf-8") as f:
        json.dump({"regions": regions}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"\n  записано: {SOURCE}")
    if spot_out:
        spot["checks"] = spot_out
        with open(SPOT, "w", encoding="utf-8") as f:
            json.dump(spot, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"            {SPOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
