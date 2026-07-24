"""
remap_region_ids.py — обязательный шаг после ЛЮБОЙ правки, меняющей число
выходных регионов какой-либо страны в build_*.py (см. docs/HISTORICAL_
ACCURACY.md, "Важная находка о хрупкости ownership_1946.json").

Причина существования этого скрипта (2026-07-19, найдено на Палестине/
Ливане/ОАЭ, повторяет паттерн "постпроцессинг вне пайплайна теряется" из
bug_report.md, п.7): `ownership_1946.json` — внешний, НЕ регенерируемый
никаким скриптом в репозитории файл, привязанный к region_id ПОЗИЦИОННО.
Любое изменение числа кластеров любой страны континента сдвигает нумерацию
всех регионов, идущих после неё в порядке сборки — не только у стран,
идущих алфавитно позже (спец-блоки вроде Китая/Палестины стоят в начале
сборки, сдвигая вообще всё). Рассинхронизация НЕ ловится существующими
тестами (population-по-anchor проверяет только сумму по стране, не
распределение по регионам) — обнаруживается только вручную или по
косвенным симптомам (graph-integrity, странные capitalRegionId).

Метод: снимок {region_id: (name, iso_a2)} из world_1946.geojson ДО правки
(обычно `git show HEAD:client/public/world_1946.geojson`) сравнивается со
свежей пересборкой по составному ключу (name, iso_a2) — не по позиции.
Однозначные совпадения (ровно 1 кандидат с той же парой) автоматически
remap'ятся в:
  - scripts/map/out/ownership_1946.json (ключи верхнего уровня);
  - scripts/map/config/occupation_overlay.json (ключи верхнего уровня,
    кроме "_comment"-подобных);
  - scripts/map/config/country_entities_1946.json (значения regionId
    внутри regionOwnerOverrides всех континентов).

Неоднозначные (>1 кандидат с той же парой) и нерезолвленные (0 кандидатов —
обычно ожидаемо: старая сущность больше не существует как отдельная
фича, например консолидированные шейхства ОАЭ) печатаются, но НЕ трогаются
автоматически — требуют ручного решения (см. вывод скрипта).

Использование:
    git show HEAD:client/public/world_1946.geojson > /tmp/world_OLD.geojson
    # ... правки geometry, полная пересборка build_*.py + merge_world_1946.py ...
    python scripts/map/build/remap_region_ids.py --old /tmp/world_OLD.geojson [--prefix ASI-] [--apply]

Без --apply только печатает найденный remap и статистику (dry-run).
"""
import argparse
import json
import collections
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from paths import out, REPO_ROOT

CONFIG_DIR = REPO_ROOT / "scripts" / "map" / "config"
OWNERSHIP_PATH = Path(out("ownership_1946.json"))
OVERLAY_PATH = CONFIG_DIR / "occupation_overlay.json"
ENTITIES_PATH = CONFIG_DIR / "country_entities_1946.json"
NAMES_RU_PATH = Path(out("names_ru.json"))
NEW_WORLD_PATH = REPO_ROOT / "client" / "public" / "world_1946.geojson"


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=collections.OrderedDict)


def region_props_by_id(world, prefix):
    return {
        ft["properties"]["region_id"]: ft["properties"]
        for ft in world["features"]
        if ft["properties"].get("region_id", "").startswith(prefix)
    }


def build_remap(old_props_by_id, new_props_by_id):
    key_to_new_ids = collections.defaultdict(list)
    for rid, p in new_props_by_id.items():
        key_to_new_ids[(p.get("name"), p.get("iso_a2"))].append(rid)

    remap, unresolved, ambiguous = {}, [], []
    for old_rid, p in old_props_by_id.items():
        key = (p.get("name"), p.get("iso_a2"))
        candidates = key_to_new_ids.get(key, [])
        if len(candidates) == 1:
            remap[old_rid] = candidates[0]
        elif len(candidates) == 0:
            unresolved.append((old_rid, key))
        else:
            ambiguous.append((old_rid, key, candidates))
    return remap, unresolved, ambiguous


def apply_ownership_remap(remap, prefix):
    data = load_json(OWNERSHIP_PATH)
    new_data = collections.OrderedDict()
    remapped, dropped = 0, []
    for k, v in data.items():
        if k.startswith(prefix):
            if k in remap:
                new_data[remap[k]] = v
                remapped += 1
            else:
                dropped.append(k)
        else:
            new_data[k] = v
    with open(OWNERSHIP_PATH, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return remapped, dropped


def apply_overlay_remap(remap, prefix):
    """Неразрешённый старый ключ внутри префикса ДРОПАЕТСЯ, не сохраняется
    как есть (2026-07-19-h): его старый region_id больше не существует как
    отдельная фича, а числовая позиция могла достаться СОВСЕМ другому
    региону в новой сборке — "оставляем как есть" тихо вешало оверрэй
    оккупации не на ту фичу (найдено на Европе: orphaned "EUR-0366": "QGB"
    от исчезнувшей Kiel Canal Zone внезапно приписался Ватикану, занявшему
    ту же позицию после сдвига)."""
    data = load_json(OVERLAY_PATH)
    new_data = collections.OrderedDict()
    remapped, dropped = 0, []
    for k, v in data.items():
        if k.startswith("_") or not k.startswith(prefix):
            new_data[k] = v
            continue
        if k in remap:
            new_data[remap[k]] = v
            remapped += 1
        else:
            dropped.append(k)
    with open(OVERLAY_PATH, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return remapped, dropped


def apply_entities_remap(remap, prefix):
    data = load_json(ENTITIES_PATH)
    remapped = 0
    for continent, section in data.get("continents", {}).items():
        for entry in section.get("regionOwnerOverrides", []):
            rid = entry.get("regionId")
            if rid and rid.startswith(prefix) and rid in remap:
                entry["regionId"] = remap[rid]
                remapped += 1
    with open(ENTITIES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return remapped


def apply_names_ru_remap(remap, prefix):
    """scripts/map/out/names_ru.json — список {region_id, name_en, name_ru,
    ...}, ТА ЖЕ позиционная хрупкость, что и ownership_1946.json, но не
    регенерируется никаким шагом пайплайна вообще (regen_names_ru.py только
    точечно правит exonym'ы поверх уже существующего файла) — легко забыть
    (забыли при самой первой правке Палестины/Ливана/ОАЭ этой сессии,
    найдено только 2026-07-19 по жалобе пользователя на "Кашмир"/"Пхукет"
    на месте Иерусалима/Иордании)."""
    data = load_json(NAMES_RU_PATH)
    remapped, dropped = 0, []
    for entry in data:
        rid = entry.get("region_id")
        if not rid or not rid.startswith(prefix):
            continue
        if rid in remap:
            entry["region_id"] = remap[rid]
            remapped += 1
        else:
            dropped.append(rid)
    if dropped:
        data = [e for e in data if e.get("region_id") not in dropped]
    with open(NAMES_RU_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return remapped, dropped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True, help="Путь к world_1946.geojson ДО правки (напр. из git show HEAD:...)")
    ap.add_argument("--prefix", default="ASI-", help="Континентальный префикс region_id для проверки (по умолчанию ASI- для Азии)")
    ap.add_argument("--apply", action="store_true", help="Применить remap к файлам (без флага — только dry-run)")
    args = ap.parse_args()

    old_world = load_json(args.old)
    new_world = load_json(NEW_WORLD_PATH)

    old_props = region_props_by_id(old_world, args.prefix)
    new_props = region_props_by_id(new_world, args.prefix)

    remap, unresolved, ambiguous = build_remap(old_props, new_props)

    print(f"Старых регионов с префиксом {args.prefix}: {len(old_props)}")
    print(f"Однозначно сопоставлено: {len(remap)}")
    print(f"Неоднозначно (>1 кандидат, ТРЕБУЕТ РУЧНОГО РЕШЕНИЯ): {len(ambiguous)}")
    for old_rid, key, candidates in ambiguous:
        print(f"  {old_rid} {key} -> {candidates}")
    print(f"Нерезолвлено (0 кандидатов — обычно ожидаемо, сущность исчезла): {len(unresolved)}")
    for old_rid, key in unresolved:
        print(f"  {old_rid} {key}")

    changed = sum(1 for old_rid, new_rid in remap.items() if old_rid != new_rid)
    print(f"Реально сдвинулись (old_id != new_id): {changed}")

    if not args.apply:
        print("\nDRY-RUN — файлы не изменены. Повторить с --apply, чтобы применить.")
        return

    if ambiguous:
        print("\nОСТАНОВЛЕНО: есть неоднозначные соответствия — разреши их вручную "
              "(добавь дизамбигуацию по дополнительному полю) перед --apply.")
        return

    n_own, dropped = apply_ownership_remap(remap, args.prefix)
    n_overlay, dropped_overlay = apply_overlay_remap(remap, args.prefix)
    n_entities = apply_entities_remap(remap, args.prefix)
    n_names, dropped_names = apply_names_ru_remap(remap, args.prefix)
    print(f"\nПрименено: ownership_1946.json {n_own} ключей (отброшено {len(dropped)}: {dropped}), "
          f"occupation_overlay.json {n_overlay} ключей (отброшено {len(dropped_overlay)}: {dropped_overlay}), "
          f"country_entities_1946.json regionOwnerOverrides {n_entities} записей, "
          f"names_ru.json {n_names} записей (отброшено {len(dropped_names)}: {dropped_names}).")
    print("Не забудь: (1) добавить occupation_overlay-записи для ПОЛНОСТЬЮ новых регионов "
          "(которых не было в старой карте вообще — их этот скрипт не создаёт, только "
          "переносит существующие соответствия), (2) прогнать make_1946.py и проверить "
          "validate_region_economy_1946.py.")


if __name__ == "__main__":
    main()
