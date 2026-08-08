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

ПЯТЫЙ ПОЗИЦИОННЫЙ ФАЙЛ — `config/region_name_overrides.json` (2026-08-08).
Он появился 2026-08-02, позже этого инструмента, и в него не попал: 43 плоских
имени, привязанных к `region_id`. Симптом пропуска — не тихий дрейф, а
немедленный отказ `import_to_game.py` («имена со скобками остались»), потому
что переопределение перестаёт попадать в свой регион.

РЕЖИМ ПО МАСТЕРАМ `--old-master PATH` (2026-08-08) — предпочтительный, и вот
почему. Сопоставление по `client/public/world_1946.geojson` требует, чтобы тот
был уже пересобран из новой геометрии, то есть чтобы `import_to_game.py`
отработал. А он отказывается работать, пока позиционные файлы смещены: имена
он берёт из `out/names_ru.json` и `config/region_name_overrides.json`, то есть
ровно из того, что этот скрипт и чинит. Круг замкнут, и разорвать его правкой
порядка нельзя.

У мастеров этой болезни нет: имена в них СЫРЫЕ — со скобками и индексами,
какими их видит `region_name()` на входе, и ни от одного позиционного файла не
зависят. Поэтому при `--old-master` сопоставление строится по паре мастеров и
применяется ко ВСЕМ пяти файлам, а `client/public` не читается вовсе. Режим по
клиентскому файлу оставлен как был: он появился раньше мастера (2026-07-19) и
на ветках без мастера всё ещё единственный.

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
NAME_OVERRIDES_PATH = CONFIG_DIR / "region_name_overrides.json"
NEW_WORLD_PATH = REPO_ROOT / "client" / "public" / "world_1946.geojson"
NEW_MASTER_PATH = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"


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
    """Неразрешённый ключ внутри префикса ДРОПАЕТСЯ — ровно по той же причине,
    что и в `apply_overlay_remap` (2026-07-19-h), просто здесь это правило
    забыли применить (найдено 2026-08-08 на сборке мира). Симптом тот же и
    такой же тихий: `AFR-0092/AFR-0093 -> QZN` (Занзибар) после слияния своих
    регионов остались стоять на прежних позициях и достались материковым
    Manyara и Ruvuma, а `NAM-0005 -> QND` — базе Гуантанамо. Ни один тест
    этого не видит: id существует, тип верный, значение осмысленное.
    Дополнительно: два дропа могут схлопнуть две записи в одну и дать дубль
    regionId, на который `import_to_game.load_historical_region_overrides`
    падает уже вслух — поэтому дубли снимаем здесь же."""
    data = load_json(ENTITIES_PATH)
    remapped, dropped = 0, []
    for continent, section in data.get("continents", {}).items():
        kept = []
        for entry in section.get("regionOwnerOverrides", []):
            rid = entry.get("regionId")
            if not rid or not rid.startswith(prefix):
                kept.append(entry)
                continue
            if rid in remap:
                entry["regionId"] = remap[rid]
                remapped += 1
                kept.append(entry)
            else:
                dropped.append(f"{continent}:{rid}")
        if "regionOwnerOverrides" in section:
            section["regionOwnerOverrides"] = kept
    with open(ENTITIES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return remapped, dropped


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
    kept = []
    # Отбор идёт ОДНИМ проходом. Раньше записи сначала переписывались на новые
    # id, а потом фильтровались по списку отброшенных СТАРЫХ id — и удаляли
    # заодно чужую корректную запись, чей НОВЫЙ id совпал с чьим-то старым.
    # Срабатывало ровно тогда, когда регионы исчезают, то есть в единственном
    # сценарии, ради которого этот скрипт и существует. Замер 2026-08-08 на
    # сборке мира: так потерялись 67 записей, включая Valais, Gibraltar,
    # Sevastopol и Northern Cyprus — регионы, которых правка не касалась вовсе.
    for entry in data:
        rid = entry.get("region_id")
        if not rid or not rid.startswith(prefix):
            kept.append(entry)
            continue
        if rid in remap:
            entry["region_id"] = remap[rid]
            remapped += 1
            kept.append(entry)
        else:
            dropped.append(rid)
    data = kept
    with open(NAMES_RU_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return remapped, dropped


def apply_name_overrides_remap(remap, prefix):
    """config/region_name_overrides.json — плоские имена, привязанные к
    region_id. Неразрешённый ключ ДРОПАЕТСЯ по той же причине, что в
    apply_overlay_remap: позицию мог занять совсем другой регион."""
    data = load_json(NAME_OVERRIDES_PATH)
    ov = data.get("overrides", {})
    new_ov = collections.OrderedDict()
    remapped, dropped = 0, []
    for k, v in ov.items():
        if not k.startswith(prefix):
            new_ov[k] = v
            continue
        if k in remap:
            new_ov[remap[k]] = v
            remapped += 1
        else:
            dropped.append(k)
    data["overrides"] = new_ov
    with open(NAME_OVERRIDES_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return remapped, dropped


def disambiguate_by_geometry(ambiguous, old_world, new_world):
    """Пара с одинаковым (name, iso_a2) разводится ГЕОМЕТРИЕЙ.

    Так велит скилл `map-geometry-qa`: «разреши по точному совпадению площади и
    центроида — совпадение это доказательство, а не догадка». Легитимные дубли
    имён в датасете есть и никуда не денутся (два «Chitipa» в Малави, два
    «Territoires du Sud» — оба помечены в `build_africa_1946.py` как намеренно
    не слитые), поэтому ручной шаг здесь был бы обязательным при КАЖДОЙ правке
    Африки. Автоматизируем, но осторожно: берём ближайший центроид и требуем,
    чтобы он был на порядок ближе следующего кандидата, иначе не решаем.
    """
    from shapely.geometry import shape

    old_geom = {f["properties"]["region_id"]: shape(f["geometry"])
                for f in old_world["features"]}
    new_geom = {f["properties"]["region_id"]: shape(f["geometry"])
                for f in new_world["features"]}
    resolved = {}
    for old_rid, key, candidates in ambiguous:
        if old_rid not in old_geom:
            continue
        c = old_geom[old_rid].centroid
        dists = sorted(((c.distance(new_geom[n].centroid), n)
                        for n in candidates if n in new_geom))
        if len(dists) < 2:
            continue
        best, second = dists[0], dists[1]
        if best[0] * 10 <= second[0]:
            resolved[old_rid] = best[1]
            print(f"  разведено геометрией: {old_rid} {key} -> {best[1]} "
                  f"(центроид {best[0]:.6f}° против {second[0]:.6f}° у второго)")
    return resolved


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", help="Путь к world_1946.geojson ДО правки (напр. из git show HEAD:...)")
    ap.add_argument("--prefix", default="ASI-", help="Континентальный префикс region_id для проверки (по умолчанию ASI- для Азии)")
    ap.add_argument("--apply", action="store_true", help="Применить remap к файлам (без флага — только dry-run)")
    ap.add_argument("--old-master", default=None,
                    help="Путь к world_1946.master.geojson ДО правки. Включает "
                         "ремап config/region_name_overrides.json по СЫРЫМ именам "
                         "мастера — клиентские имена для этого не годятся, они "
                         "уже прошли через сами эти переопределения")
    args = ap.parse_args()

    if not args.old and not args.old_master:
        ap.error("нужен --old-master (предпочтительно) либо --old")

    if args.old_master:
        source = "мастерам"
        old_props = region_props_by_id(load_json(args.old_master), args.prefix)
        new_props = region_props_by_id(load_json(NEW_MASTER_PATH), args.prefix)
    else:
        source = "клиентским файлам"
        old_props = region_props_by_id(load_json(args.old), args.prefix)
        new_props = region_props_by_id(load_json(NEW_WORLD_PATH), args.prefix)

    remap, unresolved, ambiguous = build_remap(old_props, new_props)
    if ambiguous and args.old_master:
        resolved = disambiguate_by_geometry(
            ambiguous, load_json(args.old_master), load_json(NEW_MASTER_PATH))
        remap.update(resolved)
        ambiguous = [a for a in ambiguous if a[0] not in resolved]

    print(f"Сопоставление по {source}. "
          f"Старых регионов с префиксом {args.prefix}: {len(old_props)}")
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
    n_entities, dropped_entities = apply_entities_remap(remap, args.prefix)
    n_names, dropped_names = apply_names_ru_remap(remap, args.prefix)
    n_ov, dropped_ov = (apply_name_overrides_remap(remap, args.prefix)
                        if args.old_master else (0, []))
    if args.old_master:
        print(f"region_name_overrides.json: перенесено {n_ov} "
              f"(отброшено {len(dropped_ov)}: {dropped_ov})")
    print(f"\nПрименено: ownership_1946.json {n_own} ключей (отброшено {len(dropped)}: {dropped}), "
          f"occupation_overlay.json {n_overlay} ключей (отброшено {len(dropped_overlay)}: {dropped_overlay}), "
          f"country_entities_1946.json regionOwnerOverrides {n_entities} записей "
          f"(отброшено {len(dropped_entities)}: {dropped_entities}), "
          f"names_ru.json {n_names} записей (отброшено {len(dropped_names)}: {dropped_names}).")
    print("Не забудь: (1) добавить occupation_overlay-записи для ПОЛНОСТЬЮ новых регионов "
          "(которых не было в старой карте вообще — их этот скрипт не создаёт, только "
          "переносит существующие соответствия), (2) прогнать make_1946.py и проверить "
          "validate_region_economy_1946.py.")


if __name__ == "__main__":
    main()
