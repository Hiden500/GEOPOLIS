"""
fill_new_region_entries.py — заводит позиционные записи для СОВЕРШЕННО НОВЫХ
регионов, которых `remap_region_ids.py` не создаёт по построению.

ЗАЧЕМ. Ремап переносит соответствия для сущностей, которые уже существовали:
он сопоставляет старую и новую карту по паре (name, iso_a2). Регион, которого
в старой карте не было вовсе — слитый островной, разделённый, переименованный
или филиппинский, — не имеет старого соответствия, и после ремапа остаётся без
владельца и без имён. `import_to_game.py` такой регион молча ПРОПУСКАЕТ
(«land-регионов без владельца пропущены»), то есть он исчезает из игры вместе
со своей площадью и населением. Этот шаг всегда делался руками и всегда
упоминался в конце вывода ремапа отдельным напоминанием.

ОТКУДА БЕРУТСЯ ЗНАЧЕНИЯ — из тех же принятых записей, что породили регионы:

  `out/region_edits_islands.json`  имена целей слияний/разделов/переименований
                                   и `owner` участников;
  `out/ph_regions_1946.geojson`    имена 29 филиппинских областей.

Владелец слитого региона — владелец КРУПНЕЙШЕГО участника (участники в записи
идут по убыванию площади). У пяти слияний участники принадлежат РАЗНЫМ
владельцам, и выбор среди них — продуктовое решение, а не техническое:
скрипт печатает такие случаи вслух вместе со списком владельцев, теряющих свой
последний регион. То же правило применял генератор самой записи
(`build/build_world_after_edits.py`), поэтому расхождения между записью и
картой оно не создаёт.

Идемпотентен: трогает только те регионы, записей о которых нет.

Вход:  scripts/map/master/world_1946.master.geojson
       scripts/map/out/region_edits_islands.json
       scripts/map/out/ph_regions_1946.geojson
       --old-ownership <ownership_1946.json ДО правки> (для `controller`/`note`)
Выход: дописывает scripts/map/out/ownership_1946.json и out/names_ru.json.

Запуск:
    python scripts/map/build/fill_new_region_entries.py --old-ownership <путь>
    python scripts/map/build/fill_new_region_entries.py --dry-run
"""
import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paths import REPO_ROOT, out  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
OWNERSHIP = Path(out("ownership_1946.json"))
NAMES_RU = Path(out("names_ru.json"))
OVERLAY = REPO_ROOT / "scripts" / "map" / "config" / "occupation_overlay.json"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=collections.OrderedDict)


def build_expectations(record, ph_fc, old_own):
    """name_en -> {name_ru, owner, entry, source} по принятым записям."""
    want = {}
    for op in record["operations"]:
        if op["op"] == "merge":
            owners = [old_own.get(m["region_id"], {}) for m in op["members"]]
            lead = owners[0] if owners else {}
            want[op["target"]["name_en"]] = {
                "name_ru": op["target"]["name_ru"],
                "entry": dict(lead) or {"owner": op["members"][0].get("owner")},
                "source": op["id"],
                "owners": [o.get("owner") for o in owners],
            }
        elif op["op"] == "split":
            src = old_own.get(op["source"]["region_id"], {})
            for part in op["into"]:
                want[part["name_en"]] = {
                    "name_ru": part["name_ru"],
                    "entry": dict(src),
                    "source": op["id"],
                    "owners": [src.get("owner")],
                }
        elif op["op"] == "rename":
            src = old_own.get(op["source"]["region_id"], {})
            want[op["target"]["name_en"]] = {
                "name_ru": op["target"]["name_ru"],
                "entry": dict(src),
                "source": op["id"],
                "owners": [src.get("owner")],
            }
        elif op["op"] == "resplit_from_source":
            ph_entry = old_own.get(op["replaces"][0]["region_id"], {"owner": op["owner"]})
            for ft in ph_fc["features"]:
                p = ft["properties"]
                want[p["name"]] = {
                    "name_ru": p.get("name_ru", ""),
                    "entry": dict(ph_entry),
                    "source": op["id"],
                    "owners": [ph_entry.get("owner")],
                }
    return want


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old-ownership", required=True,
                    help="ownership_1946.json ДО правки (git show <base>:...)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    world = load(MASTER)
    own = load(OWNERSHIP)
    names = load(NAMES_RU)
    overlay = load(OVERLAY)
    old_own = load(args.old_ownership)
    record = load(Path(out("region_edits_islands.json")))
    ph_fc = load(Path(out("ph_regions_1946.geojson")))

    want = build_expectations(record, ph_fc, old_own)
    have_names = {e["region_id"] for e in names}

    land = [f for f in world["features"]
            if f["properties"]["region_type"] == "land"]
    need_own = [f for f in land if f["properties"]["region_id"] not in own
                and f["properties"]["region_id"] not in overlay]
    need_name = [f for f in land if f["properties"]["region_id"] not in have_names]

    added_own, added_name, unknown = [], [], []
    multi = []
    for f in need_own:
        p = f["properties"]
        spec = want.get(p["name"])
        if not spec:
            unknown.append((p["region_id"], p["name"], "ownership"))
            continue
        own[p["region_id"]] = spec["entry"]
        added_own.append((p["region_id"], p["name"], spec["entry"].get("owner"),
                          spec["source"]))
        distinct = {o for o in spec["owners"] if o}
        if len(distinct) > 1:
            multi.append((p["region_id"], p["name"], spec["entry"].get("owner"),
                          sorted(distinct)))

    for f in need_name:
        p = f["properties"]
        spec = want.get(p["name"])
        if not spec:
            unknown.append((p["region_id"], p["name"], "names_ru"))
            continue
        names.append(collections.OrderedDict([
            ("region_id", p["region_id"]),
            ("continent", p.get("continent")),
            ("region_type", "land"),
            ("iso_a2", p.get("iso_a2")),
            ("name_en", p["name"]),
            ("name_ru", spec["name_ru"]),
        ]))
        added_name.append((p["region_id"], p["name"], spec["name_ru"]))

    names.sort(key=lambda e: e["region_id"])

    print(f"суши {len(land)}; без владельца {len(need_own)}, без имён {len(need_name)}")
    print(f"\nдобавлено ownership: {len(added_own)}")
    for rid, nm, ow, src in added_own:
        print(f"   {rid} {nm:32s} {ow}   [{src}]")
    print(f"\nдобавлено names_ru: {len(added_name)}")
    for rid, nm, ru in added_name:
        print(f"   {rid} {nm:32s} {ru}")

    if multi:
        print(f"\n⚠ СЛИЯНИЯ РАЗНЫХ ВЛАДЕЛЬЦЕВ ({len(multi)}) — выбор продуктовый, "
              f"не технический; взят владелец КРУПНЕЙШЕГО участника:")
        for rid, nm, ow, distinct in multi:
            print(f"   {rid} {nm:32s} -> {ow}   из {distinct}")
        lost = set()
        for _rid, _nm, ow, distinct in multi:
            lost |= {o for o in distinct if o != ow}
        still = {v.get("owner") for v in own.values() if isinstance(v, dict)}
        gone = sorted(o for o in lost if o not in still)
        print(f"   владельцы, потерявшие ВСЕ свои регионы: {gone or 'нет'}")

    if unknown:
        print(f"\n⚠ НЕ НАЙДЕНО в принятых записях ({len(unknown)}) — "
              f"это либо предсуществующий пробел, либо регресс:")
        for rid, nm, what in unknown:
            print(f"   {rid} {nm} ({what})")

    if args.dry_run:
        print("\n  --dry-run: файлы не изменены")
        return 0

    with open(OWNERSHIP, "w", encoding="utf-8") as f:
        json.dump(own, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(NAMES_RU, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"\n  записано: {OWNERSHIP}\n            {NAMES_RU}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
