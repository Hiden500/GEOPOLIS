"""
apply_region_edits_islands.py — применяет островную запись правок к мастеру.

ЗАЧЕМ. `out/region_edits_islands.json` (27 операций, решения пользователя
2026-08-02, правила R1–R7) не читает НИ ОДИН скрипт репозитория — только
документы и построитель самой записи. Запись существовала, применить её было
нечем. Этот скрипт её и применяет.

ЧТО ПРИМЕНЯЕТСЯ: 23 слияния (73 региона → 23), 2 раздела (+2), 1
переименование. Операция `resplit_from_source` — это Филиппины; их применяет
`build/apply_ph_regions.py`, и здесь она ПРОПУСКАЕТСЯ с проверкой, что та
работа уже сделана. Итого суша −50 +2 = −48.

КАК НАХОДЯТСЯ РЕГИОНЫ. Не по `region_id` из записи: она снята с нумерации ДО
внедрения Филиппин, и блок `ASI-` с тех пор перенумерован. Каждый участник
несёт в записи `name_en` и `area_km2` — по этой паре он и разыскивается в
мастере, а несовпадение id печатается вслух. Арифметика сдвига («+12 после
такого-то») здесь запрещена сознательно: она уже дважды ломала данные
(`docs/DECISIONS.md` 2026-07-19-j, 2026-07-29), потому что молча верна только
до первого второго разрыва. Замер 2026-08-08: 76 ссылок, разрешено 76,
неоднозначных 0; сдвинутыми оказались ровно шесть японских.

КРИТЕРИИ РАЗДЕЛОВ задаёт исполнитель — так и написано в записи («критерий
задаёт исполнитель и показывает площади обеих частей»), и обе операции несут
`needs_decision`: итоговые площади подтверждает пользователь. Критерии здесь
геометрические и проверяемые, а не на глаз:

  SPL-SAKHALIN     Сахалин — части западнее 145°E, Курилы — восточнее.
                   Разделение чистое: у сахалинской части lon ≤ 144,76,
                   у ближайшей курильской lon ≥ 145,41. Результат: Сахалин
                   75 483 км², Курилы 10 447 км² при реальной площади цепи
                   ~10 500 км² — то есть критерий подтверждается независимо.
  SPL-WEST-TIMOR   Западный Тимор — части, КАСАЮЩИЕСЯ Португальского Тимора
                   (буквальный метод записи). Прочие острова (Роте, Алор,
                   Саву) остаются в NTT: правило R4 не велит региону
                   охватывать разные острова.

Ни один раздел не режет полигон — оба делят МУЛЬТИПОЛИГОН по целым частям,
поэтому площадь сохраняется тождественно и берег не двигается.

Вход:  scripts/map/master/world_1946.master.geojson
       scripts/map/out/region_edits_islands.json
Выход: scripts/map/out/world_1946.geojson — далее
       build/rebuild_shared_edges.py --world и build/freeze_master_map.py.

Запуск:
    python scripts/map/build/apply_region_edits_islands.py
    python scripts/map/build/apply_region_edits_islands.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT, out  # noqa: E402
from geo_partition import area_km2, clean, parts  # noqa: E402
from import_to_game import region_name, strip_trailing_index  # noqa: E402

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
RECORD = "region_edits_islands.json"
AREA_MATCH_TOL_KM2 = 1.0
AREA_TOL_KM2 = 1.0
PH_EXPECT = 29

# Критерий раздела Сахалина: долгота, восточнее которой начинается Курильская
# цепь. Разрыв в данных широкий (144,76 против 145,41), поэтому порог не
# подгонка, а середина зазора.
KURIL_LON = 145.0


def index_by_name(feats):
    """Имя (сырое, без индекса, игровое) -> список фич."""
    idx = {}
    for f in feats:
        p = f["properties"]
        for nm in {p["name"], strip_trailing_index(p["name"]),
                   region_name(p["region_id"], p["name"], "en")}:
            idx.setdefault(nm, []).append(f)
    return idx


def resolve(ref, idx, shifts):
    """Фича мастера по записи участника: имя + площадь, а не region_id."""
    cands = idx.get(ref["name_en"], [])
    exact = [c for c in cands
             if abs(c["properties"]["area_km2"] - ref["area_km2"]) < AREA_MATCH_TOL_KM2]
    if len(exact) != 1:
        raise SystemExit(
            f"не разрешена ссылка записи {ref['region_id']} «{ref['name_en']}» "
            f"({ref['area_km2']} км²): кандидатов {len(cands)}, подходящих по "
            f"площади {len(exact)}"
            + (": " + ", ".join(f"{c['properties']['region_id']}/"
                                f"{c['properties']['area_km2']}" for c in cands)
               if cands else ""))
    got = exact[0]
    if got["properties"]["region_id"] != ref["region_id"]:
        shifts.append((ref["region_id"], got["properties"]["region_id"], ref["name_en"]))
    return got


def split_sakhalin(geom):
    """(Сахалин, Курилы) — по долготе; целыми частями, без разрезов."""
    west = [p for p in parts(geom) if p.bounds[2] < KURIL_LON]
    east = [p for p in parts(geom) if p.bounds[2] >= KURIL_LON]
    return clean(unary_union(west)), clean(unary_union(east))


def split_west_timor(geom, timor_neighbour):
    """(Западный Тимор, остальное NTT) — по касанию Португальского Тимора."""
    touching = [p for p in parts(geom) if p.intersects(timor_neighbour)]
    rest = [p for p in parts(geom) if not p.intersects(timor_neighbour)]
    return clean(unary_union(touching)), clean(unary_union(rest))


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    feats = world["features"]
    record = json.loads(Path(out(RECORD)).read_text(encoding="utf-8"))

    ph = sum(1 for f in feats if f["properties"].get("iso_a2") == "PH")
    if ph != PH_EXPECT:
        raise SystemExit(
            f"в мастере {ph} филиппинских регионов, ожидалось {PH_EXPECT}: "
            f"операция resplit_from_source этой записи выполняется отдельно "
            f"(build/apply_ph_regions.py) и должна быть сделана ДО этого шага")

    idx = index_by_name(feats)
    by_id = {f["properties"]["region_id"]: f for f in feats}
    land_before = sum(area_km2(clean(shape(f["geometry"]))) for f in feats
                      if f["properties"]["region_type"] == "land")
    print(f"мастер: {len(feats)} фич, суши "
          f"{sum(1 for f in feats if f['properties']['region_type'] == 'land')}, "
          f"площадь суши {land_before:,.1f} км²")

    shifts = []
    consumed = set()          # region_id фич, которые исчезают
    produced = []             # (позиция-якорь, новая фича)
    renamed = {}              # region_id -> новое имя

    n_merge = n_split = n_rename = 0
    for op in record["operations"]:
        if op["op"] == "merge":
            members = [resolve(m, idx, shifts) for m in op["members"]]
            ids = [m["properties"]["region_id"] for m in members]
            prefixes = {i.split("-")[0] for i in ids}
            if len(prefixes) != 1:
                raise SystemExit(f"{op['id']}: участники из разных блоков {prefixes}")
            g = clean(unary_union([clean(shape(m["geometry"])) for m in members]))
            a_sum = sum(area_km2(clean(shape(m["geometry"]))) for m in members)
            a_new = area_km2(g)
            if abs(a_new - a_sum) > AREA_TOL_KM2:
                raise SystemExit(f"{op['id']}: слияние изменило площадь "
                                 f"{a_sum:,.3f} -> {a_new:,.3f}")
            lead = members[0]["properties"]      # первый участник — крупнейший
            isos = {m["properties"].get("iso_a2") for m in members}
            anchor = min(ids)
            produced.append((anchor, {
                "type": "Feature",
                "properties": {
                    "region_id": None,
                    "continent": lead["continent"],
                    "region_type": "land",
                    "iso_a2": lead.get("iso_a2"),
                    "name": op["target"]["name_en"],
                    "area_km2": round(a_new, 1),
                },
                "geometry": mapping(g),
            }))
            consumed.update(ids)
            mark = "  ⚠ разные iso_a2: " + "/".join(sorted(map(str, isos))) if len(isos) > 1 else ""
            print(f"  {op['id']:22s} {op['target']['name_en']:30s} <- {len(ids):2d} "
                  f"({a_new:>10,.1f} км²){mark}")
            n_merge += 1

        elif op["op"] == "split":
            src = resolve(op["source"], idx, shifts)
            g = clean(shape(src["geometry"]))
            if op["id"] == "SPL-SAKHALIN":
                a, b = split_sakhalin(g)
            elif op["id"] == "SPL-WEST-TIMOR":
                nb = [f for f in feats
                      if f["properties"]["name"].startswith("Portuguese Timor")]
                if len(nb) != 1:
                    raise SystemExit("Португальский Тимор не найден однозначно")
                a, b = split_west_timor(g, clean(shape(nb[0]["geometry"])))
            else:
                raise SystemExit(f"нет критерия раздела для {op['id']}")
            if a.is_empty or b.is_empty:
                raise SystemExit(f"{op['id']}: одна из частей пуста")
            a_sum = area_km2(a) + area_km2(b)
            if abs(a_sum - area_km2(g)) > AREA_TOL_KM2:
                raise SystemExit(f"{op['id']}: раздел изменил площадь "
                                 f"{area_km2(g):,.3f} -> {a_sum:,.3f}")
            base = src["properties"]
            anchor = base["region_id"]
            for name, geo in zip((op["into"][0]["name_en"], op["into"][1]["name_en"]), (a, b)):
                produced.append((anchor, {
                    "type": "Feature",
                    "properties": {
                        "region_id": None,
                        "continent": base["continent"],
                        "region_type": "land",
                        "iso_a2": base.get("iso_a2"),
                        "name": name,
                        "area_km2": round(area_km2(geo), 1),
                    },
                    "geometry": mapping(geo),
                }))
            consumed.add(anchor)
            print(f"  {op['id']:22s} {base['name']:30s} -> "
                  f"{op['into'][0]['name_en']} {area_km2(a):,.1f} км² + "
                  f"{op['into'][1]['name_en']} {area_km2(b):,.1f} км²   "
                  f"⚠ площади подтверждает пользователь")
            n_split += 1

        elif op["op"] == "rename":
            src = resolve(op["source"], idx, shifts)
            renamed[src["properties"]["region_id"]] = op["target"]["name_en"]
            print(f"  {op['id']:22s} {src['properties']['name']:30s} -> "
                  f"{op['target']['name_en']}")
            n_rename += 1

        elif op["op"] == "resplit_from_source":
            print(f"  {op['id']:22s} ПРОПУЩЕНА — применена build/apply_ph_regions.py")

    if shifts:
        print(f"\n  ссылок записи, чей region_id сдвинулся с момента её создания: {len(shifts)}")
        for old, new, nm in shifts:
            print(f"      {old} -> {new}  {nm}")

    # --- сборка ---
    result = []
    for f in feats:
        rid = f["properties"]["region_id"]
        if rid in renamed:
            f["properties"]["name"] = renamed[rid]
        if rid in consumed:
            for anchor, made in produced:
                if anchor == rid:
                    result.append(made)
            continue
        result.append(f)

    order = ["EUR-", "ASI-", "NAM-", "SAM-", "AFR-", "OCE-", "ANT-", "SEA-", "LAK-"]
    out_feats = []
    for pref in order:
        block = [f for f in result if _block_of(f, produced) == pref]
        for i, f in enumerate(block, start=1):
            f["properties"]["region_id"] = f"{pref}{i:04d}"
        out_feats += block

    land_after = sum(area_km2(clean(shape(f["geometry"]))) for f in out_feats
                     if f["properties"]["region_type"] == "land")
    n_land = sum(1 for f in out_feats if f["properties"]["region_type"] == "land")
    print(f"\n  операций: слияний {n_merge}, разделов {n_split}, переименований {n_rename}")
    print(f"  фич: {len(feats)} -> {len(out_feats)}; суши "
          f"{sum(1 for f in feats if f['properties']['region_type'] == 'land')} -> {n_land}")
    print(f"  площадь суши: {land_before:,.3f} -> {land_after:,.3f} км² "
          f"(разница {land_after - land_before:+.3f})")

    if abs(land_after - land_before) > AREA_TOL_KM2:
        print(f"\nОТКАЗ: площадь суши изменилась больше допуска {AREA_TOL_KM2} км²",
              file=sys.stderr)
        return 1
    if len(by_id) - len(consumed) + len(produced) != len(out_feats):
        print("\nОТКАЗ: число фич не сходится с числом операций", file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n  --dry-run: ничего не записано")
        return 0

    dst = out("world_1946.geojson")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": out_feats}, f,
                  ensure_ascii=False)
    print(f"\n  записано: {dst}")
    print("  дальше: build/rebuild_shared_edges.py --world out/world_1946.geojson,"
          " затем build/freeze_master_map.py")
    return 0


def _block_of(f, produced):
    """Блок фичи: у сохранённых — из region_id, у новых — из якоря."""
    rid = f["properties"]["region_id"]
    if rid:
        return rid.split("-")[0] + "-"
    for anchor, made in produced:
        if made is f:
            return anchor.split("-")[0] + "-"
    raise SystemExit("фича без блока")


if __name__ == "__main__":
    sys.exit(main())
