#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерирует три новых слоя сценария 1946 — каталог демо-групп, демо-состав
регионов и координаты идеологии стран (docs/CONCEPT.md §4.1/§4.2,
docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A).

Выход (не редактировать вручную — правь ИСТОЧНИК и перегенерируй):
    server/data/scenarios/1946/groups.json        <- scripts/map/config/groups_1946.json
    server/data/scenarios/1946/demographics.json  <- scripts/map/config/demographics_1946.json
    server/data/scenarios/1946/ideology.json      <- scripts/map/config/ideology_1946.json
    server/data/scenarios/1946/government.json    <- scripts/map/config/government_1946.json

Запуск из корня: python scripts/map/generate_demographics_1946.py
После записи прогоняет scripts/map/validate_demographics_1946.py.

------------------------------------------------------------------------------
ИСТОЧНИКИ И ДОСТОВЕРНОСТЬ (docs/HISTORICAL_ACCURACY.md)
------------------------------------------------------------------------------
Таблицы ниже — НЕ первичный seed, а внешнее историческое наполнение
(2026-07-26), заменившее прежние оценки разработчика. Пообъектный провенанс —
основа оценки, уверенность и обоснование по КАЖДОМУ региону и КАЖДОЙ группе —
вынесен в `docs/DEMOGRAPHICS_1946_PROVENANCE.md`, по КАЖДОЙ СТРАНЕ — в
`docs/IDEOLOGY_1946_PROVENANCE.md`; здесь он не дублируется, чтобы не
разъезжаться в двух местах.

Общая рамка: переписи населения СССР 1946 года не было. Ближайшие опорные
точки — довоенные национальные переписи Литвы (1923), Латвии и Эстонии
(1934-1935) и советская перепись 1959 года, между которыми лежат Холокост,
депортации 1941 и 1945-49, эвакуация, репатриация поляков 1944-1946 и приток
славянских переселенцев. Доли — интерполяция между этими точками с поправкой
на известное направление процессов, а НЕ измеренные значения; уверенность по
регионам LOW-MEDIUM.

Координатам идеологии стран уверенность выше (структуру собственности и тип
режима 1946 года видно прямо), группам — ниже: их «желаемая позиция» это
игровой агрегат, а не результат опроса. Проверяемость обеспечивают именованные
зоны спектра, а не точность до сотых.

Покрытие регионов СОЗНАТЕЛЬНО частичное: 14 регионов (Прибалтика + славянские
соседи и Калининград) и 9 групп. Регион без записи трактуется движком как
неразмеченный. Расширение покрытия — отдельная задача наполнения данными, схему
менять не нужно.

Формы правления и юридический статус (`government.json`, наполнение 2026-07-29)
покрывают страны ПОЛНОСТЬЮ и живут тем же способом: авторский вход в
`config/government_1946.json`, провенанс — `docs/GOVERNMENT_1946_PROVENANCE.md`.
Слой сверх собственных инвариантов проверяется на непротиворечивость с
`diplomacy.puppets`: это два разных предиката, но противоречить друг другу они
не могут (разбор — `shared/src/types/politics/Government.ts`).

Покрытие стран — ПОЛНОЕ (157/157, наполнение 2026-07-27): координаты больше не
живут в таблице этого файла, а читаются из `scripts/map/config/ideology_1946.json`
(см. ideology_zones.py — там же обратное отображение координат в именованную
зону и объяснение, почему источник вынесен наружу). Сто пятьдесят семь строк в
теле скрипта были бы нечитаемой стеной, а главное — тот же файл нужен второму
генератору (generate_country_registry.py выводит из него ярлык
politics.ideology), и держать его внутри одного из двух потребителей значило бы
сделать второго зависимым от чужого выхода.

Тесты движка НЕ опираются на конкретные доли и номера регионов из этих таблиц
(server/src/simulation/__tests__/campaignSmoke.test.ts проверяет монотонность
механики, а не расстановку) — наполнение можно менять, не переписывая тесты.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import SCENARIO_DIR, load_json
from ideology_zones import load_coordinates
from validate_demographics_1946 import validate

GROUPS_PATH = SCENARIO_DIR / "groups.json"
DEMOGRAPHICS_PATH = SCENARIO_DIR / "demographics.json"
IDEOLOGY_PATH = SCENARIO_DIR / "ideology.json"
GOVERNMENT_PATH = SCENARIO_DIR / "government.json"
REGIONS_CORE_PATH = SCENARIO_DIR / "regions.core.json"
COUNTRIES_PATH = SCENARIO_DIR / "countries.json"

# Демо-слои вынесены во ВХОД пайплайна (2026-07-27, расширение до 504
# регионов и 270 групп). Держать полтысячи регионов питоновскими литералами
# нельзя: файл перестаёт читаться, а diff перестаёт быть обозримым. Тот же
# приём, что у остальных наборов пайплайна в scripts/map/config/.
# Провенанс — docs/DEMOGRAPHICS_1946_PROVENANCE.md.
CONFIG_DIR = Path(__file__).resolve().parent / "config"
GROUPS_CONFIG = CONFIG_DIR / "groups_1946.json"
DEMOGRAPHICS_CONFIG = CONFIG_DIR / "demographics_1946.json"
GOVERNMENT_CONFIG = CONFIG_DIR / "government_1946.json"

# Координаты идеологии стран живут в scripts/map/config/ideology_1946.json —
# авторский вход, а не таблица этого файла (см. шапку). Пообъектное обоснование,
# уверенность и источники — docs/IDEOLOGY_1946_PROVENANCE.md.


def build_groups() -> dict:
    """Каталог групп из входного конфига (см. GROUPS_CONFIG)."""
    return {"groups": load_json(GROUPS_CONFIG)["groups"]}


def build_demographics() -> dict:
    """
    Демо-состав регионов из входного конфига (см. DEMOGRAPHICS_CONFIG).

    Порядок по region_id — стабильный diff при перегенерации.
    """
    regions = load_json(DEMOGRAPHICS_CONFIG)["regions"]
    return {"regions": sorted(regions, key=lambda r: r["regionId"])}


def build_ideology(coordinates: dict) -> dict:
    return {
        "countries": [
            {"countryId": country_id, "economic": economic, "political": political}
            # Порядок по country_id — стабильный diff при перегенерации.
            for country_id, (economic, political) in sorted(coordinates.items())
        ]
    }


#: Поля записи government_1946.json, попадающие в игровое состояние. Остальное
#: (`confidence`, `note`) — провенанс: он нужен рецензенту входа, а не движку,
#: и в сценарий не переносится, чтобы не раздувать состояние тем, что никто не
#: читает (docs/GOVERNMENT_1946_PROVENANCE.md).
GOVERNMENT_GAMEPLAY_FIELDS = ("countryId", "powerStructure", "sovereigntyStatus", "overlordIds")


def build_government() -> dict:
    """Формы правления и юридический статус из входного конфига.

    Порядок по countryId — стабильный diff при перегенерации (как у ideology).
    """
    entries = load_json(GOVERNMENT_CONFIG)["countries"]
    return {
        "countries": [
            {field: entry[field] for field in GOVERNMENT_GAMEPLAY_FIELDS}
            for entry in sorted(entries, key=lambda e: e["countryId"])
        ]
    }


def write_json(path: Path, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    groups = build_groups()
    demographics = build_demographics()
    ideology = build_ideology(load_coordinates())
    government = build_government()

    region_ids = {r["id"] for r in load_json(REGIONS_CORE_PATH)}
    countries = load_json(COUNTRIES_PATH)

    # Валидируем ДО записи: битые данные не должны попадать на диск даже на
    # один прогон (тот же принцип, что у остальных валидаторов пайплайна).
    # Сюда же попадает сверка ярлыка politics.ideology с координатами — если
    # countries.json собран из более старой версии config/ideology_1946.json,
    # прогон падает вместо того, чтобы развести два файла по разным данным.
    violations = validate(groups, demographics, ideology, region_ids, countries, government)
    if violations:
        print(f"НЕ ЗАПИСАНО — нарушений: {len(violations)}")
        for v in violations:
            print(f"  - {v}")
        return 1

    write_json(GROUPS_PATH, groups)
    write_json(DEMOGRAPHICS_PATH, demographics)
    write_json(IDEOLOGY_PATH, ideology)
    write_json(GOVERNMENT_PATH, government)

    print(
        f"Записано: groups.json ({len(groups['groups'])} групп), "
        f"demographics.json ({len(demographics['regions'])} регионов), "
        f"ideology.json ({len(ideology['countries'])} стран), "
        f"government.json ({len(government['countries'])} стран)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
