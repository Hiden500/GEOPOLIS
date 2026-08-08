"""
fix_german_occupation_zones.py — возвращает зоны оккупации Германии их
регионам.

ДЕФЕКТ (найден 2026-08-08, старше сборки мира). Семь регионов германской
группы несли данные соседа: полигон советского сектора Берлина был
подконтролен британцам, американского — Советам, и так по кругу, а сам
Кильский канал числился под французским контролем. Имена в
`out/names_ru.json` съехали тем же кольцом и починены отдельно
(`build/fix_names_ru_misassignment.py`); здесь чинится ВЛАДЕНИЕ, у которого
своего содержимого для сверки нет — запись `{"controller": ..., "owner":
"DEU"}` ничем не отличается от такой же записи соседа.

Поэтому цель каждого региона задана ЯВНО и проверяема по истории, а не
выведена сдвигом: зона оккупации 1946 года известна для каждого из семи.
Выводить её тем же кольцевым сдвигом, что и имена, было бы догадкой,
похожей на знание.

  Berlin — Soviet Sector             SUN   советский сектор Берлина
  Berlin — American Sector           USA
  Berlin — British Sector            GBR
  Berlin — French Sector             FRA
  Württemberg-Baden                  USA   американская зона (север Бадена
                                           и Вюртемберга, вдоль автобана
                                           Карлсруэ — Мюнхен)
  Baden + Württemberg-Hohenzollern   FRA   французская зона (юг)
  Kiel Canal Zone                    QGB   британская зона; у канала нет
                                           собственной записи владения — он
                                           живёт через `occupation_overlay`,
                                           и запись оверлея тоже стояла не на
                                           том регионе

Регион находится ПО ИМЕНИ полигона в мастере, а не по `region_id`: id этой
группы уже сдвигались и сдвинутся снова.

Идемпотентен: если всё уже стоит верно, ничего не пишет.

Проверка: `python scripts/map/make_1946.py`, затем владелец региона в
`server/data/scenarios/1946/regions.state.json` — QGS/QGA/QGB/QGF.

Запуск:
    python scripts/map/build/fix_german_occupation_zones.py [--dry-run]
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
OVERLAY = REPO_ROOT / "scripts" / "map" / "config" / "occupation_overlay.json"

# имя полигона -> ("ownership", запись) либо ("overlay", код)
TARGET = {
    "Berlin — Soviet Sector": ("ownership", {"controller": "SUN", "owner": "DEU"}),
    "Berlin — American Sector": ("ownership", {"controller": "USA", "owner": "DEU"}),
    "Berlin — British Sector": ("ownership", {"controller": "GBR", "owner": "DEU"}),
    "Berlin — French Sector": ("ownership", {"controller": "FRA", "owner": "DEU"}),
    "Württemberg-Baden": ("ownership", {"controller": "USA", "owner": "DEU"}),
    "Baden + Württemberg-Hohenzollern": ("ownership", {"controller": "FRA", "owner": "DEU"}),
    "Kiel Canal Zone": ("overlay", "QGB"),
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=collections.OrderedDict)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    world = load(MASTER)
    own = load(OWNERSHIP)
    overlay = load(OVERLAY)

    rid_by_name = {}
    for ft in world["features"]:
        p = ft["properties"]
        if p.get("name") in TARGET:
            rid_by_name.setdefault(p["name"], []).append(p["region_id"])
    missing = [n for n in TARGET if len(rid_by_name.get(n, [])) != 1]
    if missing:
        print(f"ОТКАЗ: регионы не найдены однозначно: {missing}", file=sys.stderr)
        return 1

    changed = []
    group = {rid_by_name[n][0] for n in TARGET}
    for name, (kind, value) in TARGET.items():
        rid = rid_by_name[name][0]
        if kind == "ownership":
            if own.get(rid) != value:
                changed.append((rid, name, own.get(rid), value))
                own[rid] = value
            overlay.pop(rid, None)
        else:
            if overlay.get(rid) != value:
                changed.append((rid, name, overlay.get(rid), value))
                overlay[rid] = value
            own.pop(rid, None)
    # запись оверлея, оставшаяся на чужом регионе группы, снимается: её
    # позиция уже занята другим сектором
    for rid in list(overlay):
        if rid in group and rid != rid_by_name["Kiel Canal Zone"][0]:
            print(f"   снята запись оверлея с {rid}")
            overlay.pop(rid)

    print(f"регионов группы: {len(group)}; изменений: {len(changed)}")
    for rid, name, was, now in changed:
        print(f"   {rid} «{name}»: {json.dumps(was, ensure_ascii=False)} -> "
              f"{json.dumps(now, ensure_ascii=False)}")
    if not changed:
        print("OK: зоны уже стоят верно")
        return 0
    if args.dry_run:
        print("\n  --dry-run: файлы не изменены")
        return 0

    with open(OWNERSHIP, "w", encoding="utf-8") as f:
        json.dump(own, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(OVERLAY, "w", encoding="utf-8") as f:
        json.dump(overlay, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\n  записано: {OWNERSHIP}\n            {OVERLAY}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
