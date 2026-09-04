"""
verify_geojson_field_contract.py — контракт полей карты: что несёт мастер, что
доезжает до клиента, и почему каждое поле там есть (2026-08-09, T-5).

ЗАЧЕМ. До этой проверки набор полей не был решён ничем: он сложился
наслоением. Замер 2026-08-09 на 1591 фиче: мастер нёс 12 полей, клиентская
копия 6; три поля жили на ОДНОЙ фиче каждое (следы ручной правки), `iso_a2`
дописывался воде пустой строкой, `state` не читал никто, а половина водного
слоя была атрибутирована и половина нет — и ни один шаг пайплайна об этом не
сообщал.

КРИТЕРИЙ (утверждён с пользователем 2026-08-09). В КЛИЕНТСКУЮ копию едет
геометрия, ключ соединения и то, что надо нарисовать ДО ответа сервера. Всё
остальное — в сценарные json. Это критерий, а не список: поле, которое ему не
отвечает, уезжает независимо от того, кто его когда-то положил.

В МАСТЕРЕ правило другое: мастер не отдаётся браузеру, он источник. Там поле
живёт ровно пока у него есть названный потребитель в пайплайне.

Полная таблица «поле -> где живёт -> кто читает -> чем держится» —
`scripts/map/AGENTS.md`, раздел «Контракт полей geojson». Здесь — исполняемая
часть того же решения; расходятся они только если кто-то правит одно без
другого, поэтому таблица ссылается на этот файл, а не пересказывает его.

ЧТО ЛОВИТ ШАГ:
  - лишнее поле у любой фичи (мастер и клиент) — с именем фичи и поля;
  - отсутствие обязательного поля;
  - `iso_a2` не у суши или не в формате ISO-3166 alpha-2;
  - расхождение префикса `region_id` с `region_type`;
  - разъезд трёх файлов: числовой id клиентской фичи обязан совпадать с id
    региона в `regions.core.json` (суша) и водного узла в `waters.json`.

ЧЕГО НЕ ЛОВИТ (называю прямо): содержательную верность значений. Что `iso_a2`
у фичи именно тот, что `name` не перепутано — это не проверка формы, и здесь
её нет.

Запуск: python scripts/map/verify_geojson_field_contract.py
        python scripts/map/verify_geojson_field_contract.py --master X --client Y
"""
import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parents[2]
MASTER_DEFAULT = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
CLIENT_DEFAULT = REPO_ROOT / "client" / "public" / "world_1946.geojson"
SCENARIO_DEFAULT = REPO_ROOT / "server" / "data" / "scenarios" / "1946"

REGION_ID_RE = re.compile(r"^(AFR|ANT|ASI|EUR|LAK|NAM|OCE|SAM|SEA)-\d{4}$")
ISO_A2_RE = re.compile(r"^[A-Z]{2}$")

# Префикс region_id и region_type — одно и то же утверждение, записанное дважды.
# Разъехались — молча сломается фильтр суши в import_to_game.py.
PREFIX_REGION_TYPE = {"SEA": "sea", "LAK": "lake"}
REGION_TYPES = {"land", "sea", "lake"}

# --- МАСТЕР ---------------------------------------------------------------
# Поле -> потребитель. Потребитель здесь не украшение: поле без него удаляется,
# и наоборот — новое поле не заводится, пока читателя нет.
MASTER_REQUIRED = {
    "region_id": "ключ соединения всего пайплайна",
    "continent": "merge_world_1946.py — префикс region_id; наследуется при добавлении фичи",
    "region_type": "import_to_game.py — фильтр суши и waters.json; freeze_master_map.py — контрольные числа",
    "name": "import_to_game.py — names.en/ru и подпись океана в клиенте",
    "area_km2": "import_to_game.py — regions.core.json.area",
}

# Поле, обязательное у одного region_type и запрещённое у остальных.
MASTER_REQUIRED_BY_TYPE = {
    "iso_a2": ("land", "test_country_entities_1946.py — пара (name, iso_a2); "
                       "build/apply_ph_regions.py — выбор фич страны"),
}

# ОТЛОЖЕНО ДО МИЛСТОУНА 4 (решение пользователя 2026-08-09). Атрибуция воды
# заполнена у 85 морских зон из 182 — раскол двух поколений нарезки. Заполнять
# оставшиеся 97 сейчас незачем: механики, которая их читает, не существует, а
# данные без читателя устаревают быстрее, чем появляется читатель.
#
# Половинчатость поэтому не запрещена, но и не молчит: покрытие печатается
# каждый прогон (см. report_deferred).
#
# СНЯТИЕ ОТЛОЖЕННОСТИ — ОДНА ПРАВКА: перенести обе записи отсюда в
# MASTER_REQUIRED_BY_TYPE как ("sea", "<потребитель>"). Шаг тут же начнёт
# падать на каждой зоне без атрибуции — ровно то, что нужно, когда читатель
# появится.
DEFERRED_BY_TYPE = {
    "naval_terrain": ("sea", "Милстоун 4 — механика морского боя; сегодня читателя нет"),
    "ocean": ("sea", "Милстоун 4 — принадлежность зоны океану; сегодня читателя нет"),
}

# --- КЛИЕНТ ---------------------------------------------------------------
# Ровно три свойства. Каждое проходит критерий: `region_id` — ключ соединения с
# regions.core.json; `type` — вода или суша, нужно покрасить до ответа сервера;
# `name` — подпись, и у воды она ЕДИНСТВЕННАЯ (сервер водных имён не отдаёт).
#
# Числовой игровой id лежит на УРОВНЕ ФИЧИ, а не в properties: это канонический
# geojson-id, и именно его читает MapLibre в setFeatureState (hover, выделение,
# цвет режима карты — client/src/map/MapView.tsx). Дубликат в properties
# читателя не имел.
#
# Ушли по критерию: `iso_a2` (в client/src ни одного читателя; импорт дописывал
# его воде пустой строкой), `continent` (читателя нет; выводится из префикса
# region_id), `properties.id` (дубликат id фичи).
CLIENT_PROPERTIES = {"region_id", "type", "name"}
CLIENT_FEATURE_KEYS = {"type", "id", "properties", "geometry"}
CLIENT_TYPES = {"region", "ocean"}
TYPE_MAP = {"land": "region", "sea": "ocean", "lake": "ocean"}

# --- Явные исключения -----------------------------------------------------
# Все три списка ЗАКРЫТЫ по одному правилу (тот же приём, что
# `NAMES_RU_KNOWN_GAPS` в build/verify_derived_freshness.py): известное
# названо поимённо с причиной, а НОВЫЙ случай роняет шаг. Умолчание
# «пропускаем всё похожее» здесь и есть тот жест, которым набор полей
# зарастает молча.

# `iso_a2` несёт код страны-источника. Не у всякой единицы 1946 года он есть,
# и подменять отсутствие правдоподобным кодом хуже, чем назвать отсутствие.
NON_ISO_SOURCE_CODES = {
    "KAS": "Кашмир — спорная территория, кода ISO-3166 нет ни в 1946, ни сейчас",
    "PGA": "Spratly Islands — код Natural Earth для спорного архипелага",
    "PA_CZ": "Panama Canal Zone — территория под юрисдикцией США (1903-1979), "
             "самостоятельная сущность без кода; в отличие от снятого `DE_KC` "
             "это не переименование Панамы, а другая единица",
    "-1": "сентинел Natural Earth «кода в источнике нет» (Гуантанамо, Клиппертон, "
          "Сомалиленд)",
}

# Регионы без имени: содержательный пробел данных, не устройство контракта.
# Клиент и оба словаря сценария показывают у них пустую строку.
#
# SAM-0040/SAM-0055 закрыты 2026-08-30: имена найдены по координатам фрагмента
# (о. Малпело и о. Авес — см. scripts/map/config/region_name_overrides.json),
# без импорта внешнего датасета. Список снова пуст.
KNOWN_EMPTY_NAMES: dict[str, str] = {}

# Нулевая площадь: дефект ГЕОМЕТРИИ, а не записи. Полигон Ватикана 0,0107 км²
# при настоящих 0,44 км² — `area_km2` его честно округляет, и
# `verify_area_matches_geometry.py` подтверждает: число сходится с полигоном,
# врёт полигон.
#
# НЕ ЧИНИМ, и вот почему (замер 2026-08-10, T-8; протокол
# `find-existing-solutions` по `game_map.json` пройден целиком):
#
#   - ADM1-контур в `game_map.json` — фича #1620 (`iso_a2=VA`, `sov_a3=VAT`) —
#     это ровно 0,0107 км², bbox 12,45271–12,45404 × 41,90275–41,90391, то
#     есть прямоугольник ~110×130 м. Мастер несёт его побайтно: симметрическая
#     разность с источником 0,000 м². Первичный источник не «потерял» Ватикан
#     по дороге — он такой и есть;
#   - соседняя геометрия Рима не помогает: у полигона `Roma` (#2484) ровно
#     ОДНА внутренняя дыра, и это тот же самый огрызок 0,0107 км². Настоящего
#     контура анклава нет и там;
#   - остаётся внешний источник (OSM/geoBoundaries) либо кураторская
#     реконструкция по документированным размерам. Первое — последнее средство
#     с проверкой provenance/лицензии (корневой AGENTS.md), второе — решение
#     пользователя о составе регионов (`scripts/map/AGENTS.md`). Плюс любая из
#     правок вырезает 0,43 км² из `EUR-0177 Lazio` и переделывает общее ребро,
#     то есть трогает соседа и заморозку мастера ради 0,43 км² из 146 млн.
#
# Снятие записи — отдельная задача с явно выбранным источником контура.
KNOWN_ZERO_AREA = {
    "EUR-0363": "Ватикан: полигон 0,0107 км² (ADM1 game_map #1620 такой же, дыра "
                "в Roma такая же) при настоящих ~0,44 — защищаемого контура нет",
}

MAX_SHOWN = 10


def load(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _label(ft, idx):
    props = ft.get("properties") or {}
    return props.get("region_id") or f"фича #{idx}"


def check_master(features) -> list[str]:
    errors: list[str] = []
    seen: dict[str, int] = {}
    allowed = set(MASTER_REQUIRED) | set(MASTER_REQUIRED_BY_TYPE) | set(DEFERRED_BY_TYPE)

    for idx, ft in enumerate(features):
        props = ft.get("properties") or {}
        rid = _label(ft, idx)

        for field in MASTER_REQUIRED:
            if field not in props:
                errors.append(f"{rid}: нет обязательного поля {field!r} "
                              f"({MASTER_REQUIRED[field]})")
        for field in sorted(set(props) - allowed):
            errors.append(f"{rid}: поле {field!r} вне контракта мастера "
                          f"(разрешены: {', '.join(sorted(allowed))})")

        region_type = props.get("region_type")
        if region_type is not None and region_type not in REGION_TYPES:
            errors.append(f"{rid}: region_type={region_type!r}, допустимы {sorted(REGION_TYPES)}")

        for field, (owner_type, consumer) in MASTER_REQUIRED_BY_TYPE.items():
            if region_type == owner_type and field not in props:
                errors.append(f"{rid}: нет поля {field!r}, обязательного у "
                              f"region_type={owner_type!r} ({consumer})")
            if region_type != owner_type and field in props:
                errors.append(f"{rid}: поле {field!r} есть у region_type="
                              f"{region_type!r}, а живёт только у {owner_type!r}")
        for field, (owner_type, why) in DEFERRED_BY_TYPE.items():
            if field in props and region_type != owner_type:
                errors.append(f"{rid}: поле {field!r} есть у region_type="
                              f"{region_type!r}, а живёт только у {owner_type!r} ({why})")

        if "region_id" in props:
            if not REGION_ID_RE.match(str(props["region_id"])):
                errors.append(f"{rid}: region_id не в формате PRE-0000")
            else:
                prefix = str(props["region_id"]).split("-")[0]
                expected = PREFIX_REGION_TYPE.get(prefix, "land")
                if region_type is not None and region_type != expected:
                    errors.append(f"{rid}: префикс {prefix} требует region_type="
                                  f"{expected!r}, а стоит {region_type!r}")
                if props["region_id"] in seen:
                    errors.append(f"{rid}: region_id повторяется "
                                  f"(фичи #{seen[props['region_id']]} и #{idx})")
                seen[props["region_id"]] = idx

        iso = props.get("iso_a2")
        if iso is not None and not ISO_A2_RE.match(str(iso)):
            if str(iso) not in NON_ISO_SOURCE_CODES:
                errors.append(f"{rid}: iso_a2={iso!r} — не код ISO-3166 alpha-2 и "
                              f"не названное исключение (см. NON_ISO_SOURCE_CODES)")
        if "name" in props and not str(props["name"]).strip():
            if props.get("region_id") not in KNOWN_EMPTY_NAMES:
                errors.append(f"{rid}: пустое name — назови регион или внеси в "
                              f"KNOWN_EMPTY_NAMES с причиной")
        area = props.get("area_km2")
        if area is None or isinstance(area, bool) or not isinstance(area, (int, float)):
            if area is not None:
                errors.append(f"{rid}: area_km2={area!r} — ожидается число")
        elif area <= 0 and props.get("region_id") not in KNOWN_ZERO_AREA:
            errors.append(f"{rid}: area_km2={area!r} — площадь не положительна и "
                          f"это не названный случай (см. KNOWN_ZERO_AREA)")

    return errors


def check_client(features, master_features) -> list[str]:
    errors: list[str] = []
    by_master = {ft["properties"]["region_id"]: ft["properties"]
                 for ft in master_features if "region_id" in ft.get("properties", {})}
    seen_ids: dict[int, str] = {}

    for idx, ft in enumerate(features):
        props = ft.get("properties") or {}
        rid = _label(ft, idx)

        for field in sorted(set(ft) - CLIENT_FEATURE_KEYS):
            errors.append(f"{rid}: ключ фичи {field!r} вне контракта клиента")
        for field in sorted(CLIENT_FEATURE_KEYS - set(ft)):
            errors.append(f"{rid}: у фичи нет ключа {field!r}")
        for field in sorted(set(props) - CLIENT_PROPERTIES):
            errors.append(f"{rid}: свойство {field!r} вне контракта клиента "
                          f"(разрешены: {', '.join(sorted(CLIENT_PROPERTIES))})")
        for field in sorted(CLIENT_PROPERTIES - set(props)):
            errors.append(f"{rid}: нет обязательного свойства {field!r}")

        fid = ft.get("id")
        if not isinstance(fid, int) or isinstance(fid, bool) or fid < 1:
            errors.append(f"{rid}: id фичи={fid!r} — ожидается целое >= 1")
        elif fid in seen_ids:
            errors.append(f"{rid}: id фичи {fid} уже занят {seen_ids[fid]}")
        else:
            seen_ids[fid] = rid

        if props.get("type") not in CLIENT_TYPES:
            errors.append(f"{rid}: type={props.get('type')!r}, допустимы {sorted(CLIENT_TYPES)}")
        if ("name" in props and not str(props["name"]).strip()
                and props.get("region_id") not in KNOWN_EMPTY_NAMES):
            errors.append(f"{rid}: пустое name — назови регион или внеси в "
                          f"KNOWN_EMPTY_NAMES с причиной")
        if "(" in str(props.get("name", "")):
            errors.append(f"{rid}: скобки в игровом имени {props['name']!r} "
                          f"(решение 2026-08-02)")

        master_props = by_master.get(props.get("region_id"))
        if master_props is None:
            errors.append(f"{rid}: region_id клиента отсутствует в мастере")
        else:
            expected = TYPE_MAP.get(master_props.get("region_type"))
            if expected and props.get("type") != expected:
                errors.append(f"{rid}: region_type={master_props.get('region_type')!r} "
                              f"в мастере даёт type={expected!r}, в клиенте "
                              f"{props.get('type')!r}")

    if len(features) != len(master_features):
        errors.append(f"фич в клиенте {len(features)}, в мастере "
                      f"{len(master_features)} — клиентская копия несёт весь мир")
    return errors


def check_join(client_features, scenario_dir: Path) -> list[str]:
    """Числовой id — общий для трёх файлов. Разъехались — клиент подсветит
    не тот регион, и ни один тест этого не увидит."""
    errors: list[str] = []
    by_rid = {ft.get("properties", {}).get("region_id"): ft for ft in client_features}

    checks = (
        ("regions.core.json", "region", "суша"),
        ("waters.json", "ocean", "вода"),
    )
    for filename, expected_type, human in checks:
        path = scenario_dir / filename
        if not path.is_file():
            errors.append(f"нет {path} — сценарий не описывает {human}")
            continue
        for entry in load(path):
            geo_id = entry.get("geoJsonId")
            ft = by_rid.get(geo_id)
            if ft is None:
                errors.append(f"{filename}: {geo_id} нет в клиентской копии")
                continue
            if ft.get("id") != entry.get("id"):
                errors.append(f"{filename}: {geo_id} — id {entry.get('id')}, "
                              f"а у фичи {ft.get('id')}")
            if ft.get("properties", {}).get("type") != expected_type:
                errors.append(f"{filename}: {geo_id} — фича типа "
                              f"{ft.get('properties', {}).get('type')!r}, "
                              f"ожидался {expected_type!r}")

    waters = scenario_dir / "waters.json"
    if waters.is_file():
        listed = {e.get("geoJsonId") for e in load(waters)}
        actual = {ft["properties"]["region_id"] for ft in client_features
                  if ft.get("properties", {}).get("type") == "ocean"}
        missing = sorted(actual - listed)
        if missing:
            errors.append(f"waters.json не описывает {len(missing)} водных узлов: "
                          f"{', '.join(missing[:MAX_SHOWN])}")
    return errors


def report_deferred(master_features) -> None:
    """Отложенное состояние печатается каждый прогон — чтобы половинчатость не
    была молчаливой."""
    for field, (owner_type, why) in DEFERRED_BY_TYPE.items():
        total = sum(1 for ft in master_features
                    if ft.get("properties", {}).get("region_type") == owner_type)
        filled = sum(1 for ft in master_features
                     if field in ft.get("properties", {}))
        print(f"  отложено: {field} заполнено у {filled} из {total} "
              f"({owner_type}) — {why}")

    # Пробелы содержания печатаются рядом с отложенностью и по той же причине:
    # известный дефект, который проверка пропускает, обязан быть виден каждый
    # прогон, иначе «пропускаем» неотличимо от «всё в порядке».
    for label, known in (("без имени", KNOWN_EMPTY_NAMES),
                         ("с нулевой площадью", KNOWN_ZERO_AREA)):
        print(f"  известные пробелы, {label}: {len(known)} "
              f"({', '.join(sorted(known))})")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--master", default=str(MASTER_DEFAULT))
    ap.add_argument("--client", default=str(CLIENT_DEFAULT))
    ap.add_argument("--scenario", default=str(SCENARIO_DEFAULT))
    args = ap.parse_args()

    master = load(Path(args.master))["features"]
    client = load(Path(args.client))["features"]
    scenario_dir = Path(args.scenario)

    print(f"  мастер: {len(master)} фич, клиент: {len(client)} фич")
    report_deferred(master)

    errors = check_master(master)
    errors += check_client(client, master)
    errors += check_join(client, scenario_dir)

    if not errors:
        print(f"OK: контракт полей соблюдён "
              f"(мастер {len(MASTER_REQUIRED) + len(MASTER_REQUIRED_BY_TYPE)} полей "
              f"+ {len(DEFERRED_BY_TYPE)} отложенных, клиент "
              f"{len(CLIENT_PROPERTIES)} свойств + id фичи)")
        return 0

    print(f"\n  НАРУШЕНИЙ КОНТРАКТА: {len(errors)}", file=sys.stderr)
    for line in errors[:MAX_SHOWN * 5]:
        print(f"    {line}", file=sys.stderr)
    if len(errors) > MAX_SHOWN * 5:
        print(f"    … ещё {len(errors) - MAX_SHOWN * 5}", file=sys.stderr)
    print("\n  Контракт и причина каждого поля — scripts/map/AGENTS.md, раздел\n"
          "  «Контракт полей geojson». Новое поле сначала получает потребителя\n"
          "  и запись там, потом появляется в данных.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
