"""
fix_names_ru_misassignment.py — возвращает записи `out/names_ru.json` тем
регионам, которым они принадлежат.

ЗАЧЕМ. `import_to_game.py` берёт имя региона из `out/names_ru.json` по
`region_id` и обращается к мастеру только если записи нет вовсе. Поэтому
запись, once съехавшая на соседний регион, показывает в игре чужое имя и
живёт там сколько угодно: тип верный, регион существует, имя осмысленное, ни
один тест этого не видит.

ЧТО ЧИНИТ. Найдено 2026-08-08: семь регионов германской группы образуют
замкнутый сдвиг на единицу — полигон в Берлине (центроид 13,57 / 52,48) зовётся
в игре «Kiel Canal Zone», а сам Кильский канал (9,65 / 54,11) — «Baden +
Württemberg-Hohenzollern». Дефект старше этой правки и `remap_region_ids.py`
его НЕ лечит по построению: тот переносит записи по позиции-тождеству
(старый id -> новый id), а здесь неверно само СОДЕРЖИМОЕ записи, и оно
переезжает вместе с ней.

МЕТОД — тот, что предписан скиллом `map-geometry-qa` для этого класса
(«сдвиг составной, считать смещение бесполезно; сопоставляй по СОДЕРЖИМОМУ»):
строится отображение `name_en -> (name_en, name_ru)` по ВСЕМ записям файла,
даже стоящим не на своём месте, и каждому региону мастера возвращается пара,
у которой `name_en` совпадает с именем его полигона. Смещению любой сложности
это безразлично: оно не вычисляет сдвиг вообще.

Правится только пара имён. `continent`, `region_type` и `iso_a2` берутся из
мастера — они и так должны его повторять.

Проверка результата — `build/check_region_names_match.py` (он же и обнаружил).

Запуск:
    python scripts/map/build/fix_names_ru_misassignment.py [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT, out  # noqa: E402
from import_to_game import strip_trailing_index  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
NAMES_RU = Path(out("names_ru.json"))


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    world = json.loads(MASTER.read_text(encoding="utf-8"))
    entries = json.loads(NAMES_RU.read_text(encoding="utf-8"))
    by_id = {e["region_id"]: e for e in entries}
    master_name = {f["properties"]["region_id"]: f["properties"].get("name", "")
                   for f in world["features"]}

    # Сверяем ОЧИЩЕННЫЕ имена — ровно то преобразование, которое делает
    # `import_to_game.region_name()`. Иначе половина файла попадёт в «дефекты»
    # законно: `names_ru.json` хранит имя уже без технического индекса
    # («Abu Dhabi» против «Abu Dhabi (17)» в мастере), и это норма, а не сдвиг.
    pair_by_name = {}
    for e in entries:
        key = strip_trailing_index(e.get("name_en", ""))
        if key:
            pair_by_name.setdefault(key, []).append(e)

    wrong = []
    for rid, name in master_name.items():
        e = by_id.get(rid)
        if e is None:
            continue
        if strip_trailing_index(e.get("name_en", "")) != strip_trailing_index(name):
            wrong.append((rid, strip_trailing_index(name), e.get("name_en")))

    print(f"регионов в мастере: {len(master_name)}; записей: {len(entries)}")
    print(f"записей не на своём регионе: {len(wrong)}")
    if not wrong:
        print("OK: чинить нечего")
        return 0

    fixes, unresolved = [], []
    for rid, name, got in wrong:
        cands = [c for c in pair_by_name.get(name, []) if c["region_id"] != rid]
        if len(cands) != 1:
            unresolved.append((rid, name, got, len(cands)))
            continue
        src = cands[0]
        fixes.append((rid, got, src.get("name_en"), src.get("name_ru")))

    for rid, got, new_en, new_ru in fixes:
        print(f"   {rid}: «{got}» -> «{new_en}» / «{new_ru}»")
    for rid, name, got, n in unresolved:
        print(f"   ⚠ {rid}: в мастере «{name}», сейчас «{got}»; "
              f"подходящих записей {n} — не трогаю")

    if args.dry_run:
        print("\n  --dry-run: файл не изменён")
        return 0
    if not fixes:
        return 1

    for rid, _got, new_en, new_ru in fixes:
        e = by_id[rid]
        e["name_en"] = new_en
        e["name_ru"] = new_ru
    with open(NAMES_RU, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"\n  исправлено записей: {len(fixes)}; записано: {NAMES_RU}")
    return 1 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main())
