"""
regen_names_ru.py — заменяет наивную транслитерацию (Niederösterreich ->
Нидеростеррайх) корректными русскими экзонимами в scripts/map/out/names_ru.json.

Источник правок — scripts/map/config/exonym_overrides_ru.json, ручной аудит
(сейчас покрывает Европу — Австрия/Германия/Дания/Греция/Франция, см.
docs/TODO.md по остальным континентам). Запускать ПЕРЕД import_to_game.py,
иначе regions.json/countries.json унаследуют старые имена.
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "scripts" / "map" / "out"
NAMES_PATH = OUT_DIR / "names_ru.json"
OVERRIDES_PATH = REPO_ROOT / "scripts" / "map" / "config" / "exonym_overrides_ru.json"


def main():
    with open(NAMES_PATH, encoding="utf-8") as f:
        names = json.load(f)
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        overrides = json.load(f)
    overrides = {k: v for k, v in overrides.items() if not k.startswith("_")}

    changed = 0
    by_id = {n["region_id"]: n for n in names}
    for region_id, correct_ru in overrides.items():
        entry = by_id.get(region_id)
        if entry is None:
            print(f"ВНИМАНИЕ: {region_id} из overrides не найден в names_ru.json")
            continue
        if entry["name_ru"] != correct_ru:
            entry["name_ru"] = correct_ru
            changed += 1

    with open(NAMES_PATH, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, indent=1)

    print(f"Применено исправлений: {changed} из {len(overrides)} в overrides")


if __name__ == "__main__":
    main()
