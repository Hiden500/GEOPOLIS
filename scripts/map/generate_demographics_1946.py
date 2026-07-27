#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерирует три новых слоя сценария 1946 — каталог демо-групп, демо-состав
регионов и координаты идеологии стран (docs/CONCEPT.md §4.1/§4.2,
docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A).

Выход (не редактировать вручную — правь ИСТОЧНИК и перегенерируй):
    server/data/scenarios/1946/groups.json        <- таблица GROUPS ниже
    server/data/scenarios/1946/demographics.json  <- таблица DEMOGRAPHICS ниже
    server/data/scenarios/1946/ideology.json      <- scripts/map/config/ideology_1946.json

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
REGIONS_CORE_PATH = SCENARIO_DIR / "regions.core.json"
COUNTRIES_PATH = SCENARIO_DIR / "countries.json"

# ---------------------------------------------------------------------------
# Каталог демо-групп: id -> (en, ru, желаемая позиция на спектре).
# Ось economic: -1 крайне лево .. +1 крайне право.
# Ось political: -1 тоталитарный авторитаризм .. +1 полная демократия.
# «Желаемая» — куда группа тянет, а не где она находится. Недовольство =
# дистанция между этой точкой и позицией власти (docs/CONCEPT.md §4.2).
# ---------------------------------------------------------------------------
GROUPS = [
    # Титульные нации присоединённых в 1940 республик: защита независимости и
    # частного крестьянского хозяйства → заметно правее и много
    # «демократичнее» советской власти.
    ("lithuanians", "Lithuanians", "Литовцы", 0.20, 0.45),
    ("latvians", "Latvians", "Латыши", 0.15, 0.35),
    ("estonians", "Estonians", "Эстонцы", 0.20, 0.45),
    # Государствообразующие для СССР группы: близки к позиции власти, но не
    # тождественны ей — дистанция мала, а не нулевая.
    ("russians", "Russians", "Русские", -0.70, -0.55),
    # Меньшинства без своей государственности в этих регионах.
    ("poles", "Poles", "Поляки", 0.25, 0.45),
    ("belarusians", "Belarusians", "Белорусы", -0.45, -0.25),
    ("ukrainians", "Ukrainians", "Украинцы", -0.35, -0.20),
    ("jews", "Jews", "Евреи", -0.15, 0.35),
    ("germans", "Germans", "Немцы", 0.35, 0.05),
]

# ---------------------------------------------------------------------------
# Демо-состав: region_id -> [(group_id, доля), ...]. Сумма = 1.0.
# id регионов — из server/data/scenarios/1946/regions.core.json.
# ---------------------------------------------------------------------------
DEMOGRAPHICS = {
    # --- Литовская ССР (SUN). Исторический якорь среза: вооружённое
    # сопротивление «лесных братьев» 1944-1953.
    185: [("lithuanians", 0.93), ("russians", 0.05), ("poles", 0.01), ("jews", 0.01)],   # Panevezys
    186: [("lithuanians", 0.92), ("poles", 0.04), ("russians", 0.03), ("belarusians", 0.01)],  # Alytus
    187: [("lithuanians", 0.94), ("russians", 0.04), ("latvians", 0.01), ("jews", 0.01)],  # Siauliai
    # --- Латвийская ССР (SUN). Рига и Латгалия заметно более смешанные.
    189: [("latvians", 0.94), ("russians", 0.05), ("estonians", 0.01)],      # Vidzeme
    190: [("latvians", 0.72), ("russians", 0.23), ("poles", 0.04), ("jews", 0.01)],  # Riga
    191: [("latvians", 0.63), ("russians", 0.32), ("poles", 0.03), ("belarusians", 0.02)],  # Latgale
    192: [("latvians", 0.91), ("russians", 0.06), ("lithuanians", 0.02), ("poles", 0.01)],  # Zemgale
    193: [("latvians", 0.90), ("russians", 0.08), ("lithuanians", 0.01), ("jews", 0.01)],  # Kurzeme
    # --- Эстонская ССР (SUN). Острова — почти моноэтничны.
    68: [("estonians", 0.99), ("russians", 0.01)],                           # Saare
    69: [("estonians", 0.99), ("russians", 0.01)],                           # Hiiu
    70: [("estonians", 0.95), ("russians", 0.05)],                           # Tartu
    # --- Славянские соседи и Восточная Пруссия. Роль «контрольной группы» за
    # ними НЕ закреплена: Гродно после репатриации сохраняет крупное польское
    # население, Калининград к концу 1946 всё ещё немецкий по большинству.
    # Тесты движка на эту расстановку не опираются (см. шапку файла).
    26: [("belarusians", 0.84), ("russians", 0.14), ("ukrainians", 0.01), ("jews", 0.01)],   # Vitebsk
    27: [("belarusians", 0.59), ("poles", 0.34), ("russians", 0.06), ("jews", 0.01)],        # Grodno
    274: [("germans", 0.65), ("russians", 0.25), ("belarusians", 0.06), ("ukrainians", 0.04)],  # Kaliningrad
}

# Координаты идеологии стран живут в scripts/map/config/ideology_1946.json —
# авторский вход, а не таблица этого файла (см. шапку). Пообъектное обоснование,
# уверенность и источники — docs/IDEOLOGY_1946_PROVENANCE.md.


def build_groups() -> dict:
    return {
        "groups": [
            {
                "id": gid,
                "names": {"en": en, "ru": ru},
                "desiredIdeology": {"economic": economic, "political": political},
            }
            for gid, en, ru, economic, political in GROUPS
        ]
    }


def build_demographics() -> dict:
    return {
        "regions": [
            {
                "regionId": region_id,
                "groups": [{"groupId": gid, "share": share} for gid, share in shares],
            }
            # Порядок по region_id — стабильный diff при перегенерации.
            for region_id, shares in sorted(DEMOGRAPHICS.items())
        ]
    }


def build_ideology(coordinates: dict) -> dict:
    return {
        "countries": [
            {"countryId": country_id, "economic": economic, "political": political}
            # Порядок по country_id — стабильный diff при перегенерации.
            for country_id, (economic, political) in sorted(coordinates.items())
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

    region_ids = {r["id"] for r in load_json(REGIONS_CORE_PATH)}
    countries = load_json(COUNTRIES_PATH)

    # Валидируем ДО записи: битые данные не должны попадать на диск даже на
    # один прогон (тот же принцип, что у остальных валидаторов пайплайна).
    # Сюда же попадает сверка ярлыка politics.ideology с координатами — если
    # countries.json собран из более старой версии config/ideology_1946.json,
    # прогон падает вместо того, чтобы развести два файла по разным данным.
    violations = validate(groups, demographics, ideology, region_ids, countries)
    if violations:
        print(f"НЕ ЗАПИСАНО — нарушений: {len(violations)}")
        for v in violations:
            print(f"  - {v}")
        return 1

    write_json(GROUPS_PATH, groups)
    write_json(DEMOGRAPHICS_PATH, demographics)
    write_json(IDEOLOGY_PATH, ideology)

    print(
        f"Записано: groups.json ({len(groups['groups'])} групп), "
        f"demographics.json ({len(demographics['regions'])} регионов), "
        f"ideology.json ({len(ideology['countries'])} стран)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
