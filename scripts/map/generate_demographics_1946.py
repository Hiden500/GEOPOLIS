#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерирует три новых слоя сценария 1946 — каталог демо-групп, демо-состав
регионов и координаты идеологии стран (docs/CONCEPT.md §4.1/§4.2,
docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A).

Выход (не редактировать вручную — правь таблицы ниже и перегенерируй):
    server/data/scenarios/1946/groups.json
    server/data/scenarios/1946/demographics.json
    server/data/scenarios/1946/ideology.json

Запуск из корня: python scripts/map/generate_demographics_1946.py
После записи прогоняет scripts/map/validate_demographics_1946.py.

------------------------------------------------------------------------------
ИСТОЧНИКИ И ДОСТОВЕРНОСТЬ (docs/HISTORICAL_ACCURACY.md)
------------------------------------------------------------------------------
Долям — confidence LOW-MEDIUM. Переписи населения СССР 1946 года не было:
ближайшие опорные точки — довоенные национальные переписи Литвы/Латвии/Эстонии
(1935-1939) и советская перепись 1959 года, между которыми лежат Холокост,
депортации 1941 и 1945-49, эвакуация, репатриация поляков 1944-1946 и приток
славянских переселенцев. Цифры ниже — интерполяция между этими точками с
поправкой на известное направление процессов, а НЕ измеренные значения.

Осознанные исторические поправки к «наивной» разметке:
  * доля евреев в Литве и Латвии в 1946 — доли процента, а не довоенные 7-9%:
    еврейское население этих республик было почти полностью уничтожено в
    1941-1944. Поэтому группа `jews` присутствует только в Риге, Витебске и
    Гродно (уцелевшие/вернувшиеся общины) и там ~1-2%;
  * поляки в литовских уездах даны низкой долей: основной польский массив
    приходился на Виленский край, которого в датасете нет (отдельных регионов
    Вильнюса и Каунаса не существует), плюс репатриация 1944-1946;
  * Калининградская область в начале 1946 — переходное состояние: немецкое
    население ещё не выселено полностью (депортации завершились в 1947-1948),
    советские переселенцы уже прибывают. Отсюда сосуществование `germans` и
    `russians` в одном регионе.

Координатам идеологии — confidence LOW: это дизайнерская оценка позиции
режима на двух осях (см. docs/CONCEPT.md §4.2), а не измеримая величина.
Проверяемость обеспечивают именованные зоны, а не точность до сотых.

Покрытие СОЗНАТЕЛЬНО частичное: 14 регионов (Прибалтика + контрольная группа
славянских соседей) и 3 страны. Регион без записи трактуется движком как
неразмеченный, страна без координат — фолбэк по ярлыку politics.ideology.
Расширение покрытия — отдельная задача наполнения данными, схему менять не
нужно.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import SCENARIO_DIR, load_json
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
    # Титульные нации присоединённых в 1940 республик: национальная
    # независимость + парламентская традиция межвоенного периода → заметно
    # правее и много «демократичнее» советской власти.
    ("lithuanians", "Lithuanians", "Литовцы", -0.10, 0.45),
    ("latvians", "Latvians", "Латыши", -0.05, 0.50),
    ("estonians", "Estonians", "Эстонцы", -0.05, 0.55),
    # Государствообразующие для СССР группы: близки к позиции власти, но не
    # тождественны ей — дистанция мала, а не нулевая.
    ("russians", "Russians", "Русские", -0.70, -0.55),
    ("belarusians", "Belarusians", "Белорусы", -0.65, -0.45),
    # Меньшинства без своей государственности в этих регионах.
    ("poles", "Poles", "Поляки", -0.20, 0.20),
    ("jews", "Jews", "Евреи", -0.30, 0.30),
    ("germans", "Germans", "Немцы", -0.15, 0.15),
]

# ---------------------------------------------------------------------------
# Демо-состав: region_id -> [(group_id, доля), ...]. Сумма = 1.0.
# id регионов — из server/data/scenarios/1946/regions.core.json.
# ---------------------------------------------------------------------------
DEMOGRAPHICS = {
    # --- Литовская ССР (SUN). Исторический якорь среза: вооружённое
    # сопротивление «лесных братьев» 1944-1953.
    185: [("lithuanians", 0.90), ("russians", 0.08), ("poles", 0.02)],       # Panevezio
    186: [("lithuanians", 0.87), ("poles", 0.08), ("russians", 0.05)],       # Alytaus
    187: [("lithuanians", 0.88), ("russians", 0.09), ("poles", 0.03)],       # Siauliai
    # --- Латвийская ССР (SUN). Рига и Латгалия заметно более смешанные.
    189: [("latvians", 0.85), ("russians", 0.13), ("poles", 0.02)],          # Vidzeme
    190: [("latvians", 0.64), ("russians", 0.30), ("poles", 0.04), ("jews", 0.02)],  # Riga
    191: [("latvians", 0.56), ("russians", 0.35), ("poles", 0.07), ("belarusians", 0.02)],  # Latgale
    192: [("latvians", 0.86), ("russians", 0.12), ("poles", 0.02)],          # Zemgale
    193: [("latvians", 0.88), ("russians", 0.10), ("poles", 0.02)],          # Kurzeme
    # --- Эстонская ССР (SUN). Острова — почти моноэтничны.
    68: [("estonians", 0.97), ("russians", 0.03)],                           # Saare
    69: [("estonians", 0.98), ("russians", 0.02)],                           # Hiiu
    70: [("estonians", 0.89), ("russians", 0.11)],                           # Tartu
    # --- Контрольная группа: славянское большинство, малая дистанция до
    # советской власти. Нужна, чтобы «высокое недовольство» было свойством
    # конкретных регионов, а не всей страны.
    26: [("belarusians", 0.80), ("russians", 0.16), ("poles", 0.03), ("jews", 0.01)],   # Vitebsk
    27: [("belarusians", 0.63), ("poles", 0.24), ("russians", 0.12), ("jews", 0.01)],   # Grodno
    274: [("russians", 0.60), ("germans", 0.28), ("belarusians", 0.07), ("poles", 0.05)],  # Kaliningrad
}

# ---------------------------------------------------------------------------
# Координаты идеологии стран: country_id -> (economic, political).
# ---------------------------------------------------------------------------
IDEOLOGY = {
    # Сталинский СССР 1946: плановая экономика без частного сектора +
    # однопартийный режим на пике послевоенной централизации.
    "SUN": (-0.95, -0.90),
    # ПНР 1946: режим, установленный при советской поддержке; чуть менее
    # крайний, чем метрополия (частный сектор и оппозиция ещё не добиты).
    "POL": (-0.80, -0.75),
    # США 1946: рыночная экономика с наследием New Deal + устойчивая
    # электоральная демократия. Контрольная точка на другом конце спектра.
    "USA": (0.55, 0.75),
}


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


def build_ideology() -> dict:
    return {
        "countries": [
            {"countryId": country_id, "economic": economic, "political": political}
            for country_id, (economic, political) in sorted(IDEOLOGY.items())
        ]
    }


def write_json(path: Path, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    groups = build_groups()
    demographics = build_demographics()
    ideology = build_ideology()

    region_ids = {r["id"] for r in load_json(REGIONS_CORE_PATH)}
    country_ids = {c["id"] for c in load_json(COUNTRIES_PATH)}

    # Валидируем ДО записи: битые данные не должны попадать на диск даже на
    # один прогон (тот же принцип, что у остальных валидаторов пайплайна).
    violations = validate(groups, demographics, ideology, region_ids, country_ids)
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
