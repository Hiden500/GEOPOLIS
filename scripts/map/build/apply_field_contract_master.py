"""
apply_field_contract_master.py — хирургическая правка мастер-карты: свойства
приводятся к контракту полей (2026-08-09, задача T-5 роли geometry).

ПОЧЕМУ ХИРУРГИЯ, А НЕ ПЕРЕСБОРКА. Та же причина, что у
`fix_dalian_rio_master.py`: `make_1946.py --rebuild-master` сегодня невозможен,
8 из 11 входов пайплайна лежат вне репозитория. Геометрия не теряется —
мастер под git; теряется воспроизводимость, поэтому правка делается скриптом,
а не руками.

ГЕОМЕТРИЯ НЕ ТРОГАЕТСЯ ВООБЩЕ. Скрипт читает и пишет только
`feature["properties"]`; `feature["geometry"]` не читается и не
пересериализуется по значению — объект переносится как есть. Число фич и
состав `region_id` не меняются, поэтому `master.meta.json.checks` (все восемь
величин там геометрические) остаётся верным без перезаморозки.

ЧТО УБИРАЕТСЯ И ПОЧЕМУ (замер 2026-08-09, 1591 фича):

  `state` — 108 фич, штаты США. Пишет `build_us_states_split_1946.py:155`,
      читает НИКТО во всём репозитории (проверено по `scripts/`, `server/src`,
      `client/src`, `shared/src`). Принадлежность к штату выражена именем
      региона («Washington — San Juan») и владельцем.

  `id` — 1 фича, `EUR-0374 Kiel Canal Zone`, значение `371`. След ручного
      слияния из game_map: игровой числовой id присваивает `import_to_game.py`
      позиционно, и он у этой фичи ДРУГОЙ. Поле не читается и противоречит
      живому id — худший вид данных.

  `type` — 1 фича, та же `EUR-0374`, значение `"region"`. Это КЛИЕНТСКИЙ
      формат (`region`/`ocean`), протёкший в мастер; мастер различает
      `land`/`sea`/`lake` полем `region_type`.

  `strategic_points` — 1 фича, `ASI-0043 Nanjing`, одна запись «столица
      Китайской Республики в 1946». Не читает никто, и факт не теряется: он
      уже живёт в потребляемом `economy_1946/capital_overrides.py`
      (`"TWN": "Nanjing"`).

ЧТО НОРМАЛИЗУЕТСЯ:

  `iso_a2: "DE_KC"` -> `"DE"` у `EUR-0374`. Поле несёт код страны-источника по
      ISO-3166 alpha-2 и по нему разыскиваются фичи
      (`test_country_entities_1946.py` матчит пару `(name, iso_a2)`,
      `build/apply_ph_regions.py` выбирает фичи по `iso_a2 == "PH"`).
      `DE_KC` — рукотворное значение из `merge_kiel_canal_zone.py`, не код
      страны; зона Кильского канала географически Германия, а её игровой
      владелец берётся из `ownership_1946.json`, не отсюда.

      Генератор `merge_kiel_canal_zone.py` при гипотетической пересборке
      напишет `DE_KC` снова. Править его нельзя: он в `MASTER_REBUILD_STEPS`,
      и его правка объявит мастер устаревшим для
      `build/verify_master_freshness.py`, а перезаморозить мастер нечем.
      Возврат ловит `verify_geojson_field_contract.py` в STANDARD_STEPS —
      проверка по содержимому, а не по хешу коммита.

ПОЧЕМУ ЭТОТ СКРИПТ НЕ ВНЕСЁН В `verify_master_freshness.OFF_CHAIN`. Тот
сторож — прокси: он сравнивает коммиты генераторов ГЕОМЕТРИИ, потому что
проверить геометрию содержательно нечем. Здесь содержательная проверка есть и
она сильнее: `verify_geojson_field_contract.py` каждый прогон читает сами
свойства мастера. Запись в OFF_CHAIN добавила бы ложную тревогу (правка
комментария в этом файле объявляла бы мастер устаревшим) и никакого
дополнительного покрытия.

Скрипт идемпотентен: повторный прогон не находит что менять и печатает это.

Запуск:
    python scripts/map/build/apply_field_contract_master.py --dry-run
    python scripts/map/build/apply_field_contract_master.py
Затем:
    python scripts/map/verify_geojson_field_contract.py
"""
import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"

# Поле -> причина удаления (печатается, чтобы решение было видно в логе прогона,
# а не только в этой докстроке).
DROP_FIELDS = {
    "state": "пишет build_us_states_split_1946.py, не читает никто",
    "id": "след ручного слияния; живой числовой id присваивает import_to_game.py",
    "type": "клиентский формат, протёкший в мастер; в мастере — region_type",
    "strategic_points": "не читает никто; факт живёт в capital_overrides.py",
}

# region_id -> (поле, было, стало)
NORMALIZE = {
    "EUR-0374": ("iso_a2", "DE_KC", "DE"),
}


def apply(features) -> list[str]:
    """Правит properties на месте. Возвращает журнал изменений."""
    log: list[str] = []
    dropped = {field: [] for field in DROP_FIELDS}

    for ft in features:
        props = ft["properties"]
        rid = props.get("region_id", "?")
        for field in DROP_FIELDS:
            if field in props:
                del props[field]
                dropped[field].append(rid)

        rule = NORMALIZE.get(rid)
        if rule:
            field, was, now = rule
            if props.get(field) == was:
                props[field] = now
                log.append(f"{rid}: {field} {was!r} -> {now!r}")

    for field, rids in dropped.items():
        if rids:
            shown = ", ".join(rids[:4]) + (" …" if len(rids) > 4 else "")
            log.append(f"снято {field} с {len(rids)} фич ({shown}) — "
                       f"{DROP_FIELDS[field]}")
    return log


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    features = data["features"]
    before = len(features)

    log = apply(features)

    if not log:
        print("  контракт уже применён — менять нечего")
        return 0

    for line in log:
        print(f"  {line}")

    if len(features) != before:
        raise SystemExit("ОТКАЗ: изменилось число фич — правка свойств этого не делает")

    if args.dry_run:
        print("\n  --dry-run: мастер не тронут")
        return 0

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"\n  мастер перезаписан: {MASTER_PATH}")
    print("  дальше: python scripts/map/verify_geojson_field_contract.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
