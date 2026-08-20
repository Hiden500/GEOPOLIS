#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест structural-инвариантов validate_region_economy_1946.py (docs/plans/
05_DATA_LAYOUT.md, Срез 4) — синтетическая фикстура, не завязана на реальные
1366 регионов/полного реестра стран (те калибровочные проверки покрываются прогоном
validate_region_economy_1946.py на реальных данных в CI/при регенерации).

Запуск: python scripts/map/test_validate_region_economy_1946.py
(stdlib unittest — без новых зависимостей, см. STACK_PLAYBOOK.md)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_region_economy_1946 import (
    validate_structural_invariants,
    validate_capital_anchor_names,
    validate_capital_geography,
    validate_capital_override_applied,
)
from economy_1946.capital_geography import (
    parse_ts_capital_overrides,
    point_in_geometry,
    build_region_geometries,
    check_anchor_count,
    MIN_EXPECTED_REGIONS,
)

CATALOG = {"resources": {"food": {"category": "agricultural", "eraIntroduced": 1836}}}


def make_valid_fixture():
    regions = [
        {
            "id": 1, "geoJsonId": "AAA-0001", "ownerCountryId": "AAA",
            "landNeighboringRegionIds": [2], "deposits": {"food": 5}, "extraction": {"food": 10},
        },
        {
            "id": 2, "geoJsonId": "BBB-0001", "ownerCountryId": "BBB",
            "landNeighboringRegionIds": [1], "deposits": {}, "extraction": {},
        },
    ]
    countries = [
        {"id": "AAA", "capitalRegionId": 1},
        {"id": "BBB", "capitalRegionId": 2},
    ]
    names_en = {"AAA-0001": "Aland", "BBB-0001": "Bland"}
    names_ru = {"AAA-0001": "Аланд", "BBB-0001": "Бланд"}
    return regions, countries, names_en, names_ru


class ValidateStructuralInvariantsTest(unittest.TestCase):
    def test_valid_fixture_has_no_violations(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)
        self.assertEqual(violations, [])

    def test_catches_asymmetric_neighbor(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        # region 1 -> сосед 2, но 2 больше не ссылается обратно на 1.
        regions[1]["landNeighboringRegionIds"] = []

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("несимметричный сосед" in v for v in violations), violations)

    def test_catches_neighbor_pointing_at_nonexistent_region(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        regions[0]["landNeighboringRegionIds"] = [999]

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("999" in v and "не существует" in v for v in violations), violations)

    def test_catches_unknown_owner(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        regions[0]["ownerCountryId"] = "ZZZ"

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("ZZZ" in v and "не найден в countries.json" in v for v in violations), violations)

    def test_catches_capital_owned_by_another_country(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        countries[0]["capitalRegionId"] = 2  # регион 2 принадлежит BBB, не AAA

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("capitalRegionId" in v and "AAA" in v for v in violations), violations)

    def test_catches_capital_pointing_at_nonexistent_region(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        countries[0]["capitalRegionId"] = 999

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("999" in v and "не существует" in v for v in violations), violations)

    def test_catches_resource_outside_catalog(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        regions[0]["deposits"]["uranium"] = 1  # не в CATALOG (там только food)

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("uranium" in v and "вне каталога" in v for v in violations), violations)

    def test_catches_missing_localization(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        del names_ru["BBB-0001"]

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("BBB-0001" in v and "ru" in v for v in violations), violations)

    def test_mutation_does_not_leak_between_cases(self):
        # make_valid_fixture() строит новые объекты на каждый вызов — фикстура
        # одного теста не должна протухать в другом (deep-copy не нужен, но
        # явная проверка страхует от будущего рефакторинга на общий фикстур-модуль).
        regions_a, *_ = make_valid_fixture()
        regions_b, *_ = make_valid_fixture()
        regions_a[0]["ownerCountryId"] = "ZZZ"
        self.assertEqual(regions_b[0]["ownerCountryId"], "AAA")


# Регресс-покрытие .agent/plans/capital-region-invariant.md (2026-07-26):
# capitalRegionId дрейфовал на РЕГИОН ТОЙ ЖЕ СТРАНЫ (SUN 318 "Chukotka AO"
# вместо 320 "Moscow" — Chukotka тоже принадлежит SUN), поэтому старый
# invariant 11 (capital принадлежит региону страны, см. класс выше) проходил
# чисто. Ниже — два независимых, не-позиционных якоря: имя источника
# (validate_capital_anchor_names) и реальная географическая точка
# (validate_capital_geography).
def make_capital_name_fixture():
    # region 3 -- та же ловушка, что реальные "Northern"/"Southern"/"Eastern"
    # (18/11/10 совпадений по имени по всему миру, см. .agent/plans/capital-
    # region-invariant.md): регион с ПОДХОДЯЩИМ ИМЕНЕМ, но у ДРУГОЙ страны.
    # Substring-only проверка (до 2026-07-26) прошла бы это молча.
    regions = [
        {"id": 1, "ownerCountryId": "AAA", "names": {"en": "Capital City", "ru": "Столица"}},
        {"id": 2, "ownerCountryId": "AAA", "names": {"en": "Other Province", "ru": "Другая провинция"}},
        {"id": 3, "ownerCountryId": "ZZZ", "names": {"en": "Capital City East", "ru": "Восточная Столица"}},
    ]
    overrides = {"AAA": 1}
    anchor_names = {"AAA": "Capital City"}
    return regions, overrides, anchor_names


class ValidateCapitalAnchorNamesTest(unittest.TestCase):
    def test_no_violation_when_current_name_and_owner_match_anchor(self):
        regions, overrides, anchor_names = make_capital_name_fixture()

        violations = validate_capital_anchor_names(regions, overrides, anchor_names)

        self.assertEqual(violations, [])

    def test_catches_id_drifted_to_another_region_of_the_same_country(self):
        regions, overrides, anchor_names = make_capital_name_fixture()
        overrides["AAA"] = 2  # id теперь указывает на "Other Province", не "Capital City"

        violations = validate_capital_anchor_names(regions, overrides, anchor_names)

        self.assertTrue(
            any("AAA" in v and "Other Province" in v and "Capital City" in v for v in violations), violations
        )

    def test_catches_id_drifted_to_a_different_countrys_region_with_a_matching_name(self):
        # Сердце находки 1 независимого ревью: имя совпадает (region 3
        # содержит "Capital City"), но регион принадлежит ZZZ, не AAA --
        # это ДОЛЖНО провалиться, даже при substring-совпадении имени.
        regions, overrides, anchor_names = make_capital_name_fixture()
        overrides["AAA"] = 3

        violations = validate_capital_anchor_names(regions, overrides, anchor_names)

        self.assertTrue(
            any("AAA" in v and "ZZZ" in v and "владелец" in v for v in violations), violations
        )

    def test_catches_missing_override_entry_for_known_anchor(self):
        regions, overrides, anchor_names = make_capital_name_fixture()
        del overrides["AAA"]  # таблицы рассинхронизированы

        violations = validate_capital_anchor_names(regions, overrides, anchor_names)

        self.assertTrue(any("AAA" in v and "рассинхронизированы" in v for v in violations), violations)

    def test_does_not_duplicate_nonexistent_region_violation(self):
        # capitalRegionId, не существующий среди регионов, уже ловит invariant
        # 11 (validate_structural_invariants) -- эта функция должна молча
        # пропустить, не падать и не дублировать сообщение по-своему.
        regions, overrides, anchor_names = make_capital_name_fixture()
        overrides["AAA"] = 999

        violations = validate_capital_anchor_names(regions, overrides, anchor_names)

        self.assertEqual(violations, [])


SQUARE_LOW = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}
SQUARE_HIGH = {"type": "Polygon", "coordinates": [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]}


def make_capital_geometry_fixture():
    region_geometries = {
        1: {"geometry": SQUARE_LOW, "bbox": (0, 0, 10, 10)},
        2: {"geometry": SQUARE_HIGH, "bbox": (20, 20, 30, 30)},
    }
    countries = [{"id": "AAA", "capitalRegionId": 1}]
    capital_anchors = {"AAA": (5.0, 5.0)}  # реальная точка внутри региона 1
    return countries, capital_anchors, region_geometries


class ValidateCapitalGeographyTest(unittest.TestCase):
    def test_no_violation_or_warning_when_anchor_point_inside_capital_region(self):
        countries, capital_anchors, region_geometries = make_capital_geometry_fixture()

        violations, warnings, checked = validate_capital_geography(countries, capital_anchors, region_geometries)

        self.assertEqual(violations, [])
        self.assertEqual(warnings, [])
        self.assertEqual(checked, 1)

    def test_catches_capital_region_not_containing_the_real_point(self):
        countries, capital_anchors, region_geometries = make_capital_geometry_fixture()
        countries[0]["capitalRegionId"] = 2  # столица страны на самом деле в регионе 1, не 2

        violations, warnings, checked = validate_capital_geography(countries, capital_anchors, region_geometries)

        self.assertTrue(any("AAA" in v and "[1]" in v for v in violations), violations)
        self.assertEqual(warnings, [])
        self.assertEqual(checked, 1)

    def test_produces_warning_not_violation_when_point_inside_no_known_region(self):
        # Не решаемо однозначно (огрубление геометрии на границе региона,
        # см. DNK/Копенгаген в docstring validate_capital_geography) --
        # не violation (страну всё ещё защищает validate_capital_anchor_names),
        # но и не тишина (2026-07-26, независимое ревью, находка 4) --
        # деградация покрытия должна быть видна в warnings, не молчать.
        countries, capital_anchors, region_geometries = make_capital_geometry_fixture()
        capital_anchors["AAA"] = (100.0, 100.0)  # далеко от обоих квадратов

        violations, warnings, checked = validate_capital_geography(countries, capital_anchors, region_geometries)

        self.assertEqual(violations, [])
        self.assertTrue(any("AAA" in w for w in warnings), warnings)
        self.assertEqual(checked, 1)  # страна найдена и проверена, просто исход "неопределимо"

    def test_skips_anchor_for_country_absent_from_countries_json(self):
        countries, capital_anchors, region_geometries = make_capital_geometry_fixture()
        countries.clear()

        violations, warnings, checked = validate_capital_geography(countries, capital_anchors, region_geometries)

        self.assertEqual(violations, [])
        self.assertEqual(warnings, [])
        self.assertEqual(checked, 0)

    def test_checked_excludes_absent_countries_so_coverage_ratio_cannot_lie(self):
        # Находка 1 независимого ревью (2026-07-26): main() раньше считал
        # покрытие как len(capital_anchors) - len(warnings) -- страна,
        # отсутствующая в countries.json, не даёт ни violation, ни warning,
        # поэтому такой якорь молча засчитывался бы в "covered". Воспроизведено
        # на реальных данных: убрать TWN/DNK/EGY из countries.json -> печатает
        # "13/13", хотя реально проверено 10. checked -- явный счётчик, ratio
        # должен считаться как checked - len(warnings), а не через total.
        countries = [
            {"id": "AAA", "capitalRegionId": 1},
            {"id": "BBB", "capitalRegionId": 999},  # BBB есть, но всё равно ничего не найдёт (999 не в геометрии)
        ]
        capital_anchors = {
            "AAA": (5.0, 5.0),  # верно, в регионе 1
            "BBB": (25.0, 25.0),  # у BBB нет геометрии на этот id -- но проверка всё равно ПРОШЛА, просто не совпала
            "CCC": (5.0, 5.0),  # страны CCC вообще нет в countries.json
        }
        region_geometries = {1: {"geometry": SQUARE_LOW, "bbox": (0, 0, 10, 10)}}

        violations, warnings, checked = validate_capital_geography(countries, capital_anchors, region_geometries)

        # CCC не проверялась вообще -- не должна попадать ни в checked, ни
        # маскироваться под "covered" при len(capital_anchors)=3.
        self.assertEqual(checked, 2)
        self.assertTrue(any("BBB" in w for w in warnings), warnings)  # 25,25 не в известном полигоне
        covered = checked - len(warnings)
        self.assertEqual(covered, 1)  # только AAA реально подтверждён
        self.assertNotEqual(covered, len(capital_anchors) - len(warnings))  # старая (неверная) формула дала бы 2


def make_capital_override_sync_fixture():
    countries = [{"id": "AAA", "capitalRegionId": 1}, {"id": "BBB", "capitalRegionId": 2}]
    overrides = {"AAA": 1, "BBB": 2}
    return countries, overrides


class ValidateCapitalOverrideAppliedTest(unittest.TestCase):
    def test_no_violation_when_countries_json_matches_overrides_table(self):
        countries, overrides = make_capital_override_sync_fixture()

        violations = validate_capital_override_applied(countries, overrides)

        self.assertEqual(violations, [])

    def test_catches_countries_json_out_of_sync_with_overrides_table(self):
        # Сердце находки 3 независимого ревью: таблица уже поправлена (BBB
        # ожидает id 2), но countries.json не пересобран (всё ещё хранит
        # старое значение 999) -- ни validate_capital_anchor_names (читает
        # только таблицу), ни validate_capital_geography (только 13 стран
        # с координатами) сам по себе такое не поймает.
        countries, overrides = make_capital_override_sync_fixture()
        countries[1]["capitalRegionId"] = 999  # не пересобрано после правки таблицы

        violations = validate_capital_override_applied(countries, overrides)

        self.assertTrue(any("BBB" in v and "999" in v and "2" in v for v in violations), violations)

    def test_skips_override_entry_for_country_absent_from_countries_json(self):
        countries, overrides = make_capital_override_sync_fixture()
        countries.clear()

        violations = validate_capital_override_applied(countries, overrides)

        self.assertEqual(violations, [])


class CapitalGeographyHelpersTest(unittest.TestCase):
    def test_point_in_geometry_polygon_inside_and_outside(self):
        self.assertTrue(point_in_geometry((5, 5), SQUARE_LOW))
        self.assertFalse(point_in_geometry((15, 15), SQUARE_LOW))

    def test_point_in_geometry_respects_holes(self):
        donut = {
            "type": "Polygon",
            "coordinates": [
                [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],  # внешнее кольцо
                [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],  # дырка
            ],
        }
        self.assertTrue(point_in_geometry((1, 1), donut))
        self.assertFalse(point_in_geometry((5, 5), donut))  # внутри дырки

    def test_point_in_geometry_multipolygon(self):
        multi = {
            "type": "MultiPolygon",
            "coordinates": [SQUARE_LOW["coordinates"], SQUARE_HIGH["coordinates"]],
        }
        self.assertTrue(point_in_geometry((25, 25), multi))
        self.assertFalse(point_in_geometry((15, 15), multi))

    def test_point_in_geometry_survives_geometry_without_coordinates(self):
        # Фича без ключа coordinates — битые данные, а не «точка внутри»:
        # раньше обход колец падал TypeError на None посреди проверки столиц.
        self.assertFalse(point_in_geometry((5, 5), {"type": "Polygon"}))
        self.assertFalse(point_in_geometry((5, 5), {"type": "MultiPolygon"}))

    def test_parse_ts_capital_overrides_extracts_code_lon_lat(self):
        ts_source = """
        const CAPITAL_OVERRIDES: Record<string, { name: string; coordinates?: [number, number] }> = {
            SUN: { name: "Москва", coordinates: [37.6173, 55.7558] },
            USA: { name: "Вашингтон", coordinates: [-77.0369, 38.8951] },
        };
        """

        anchors = parse_ts_capital_overrides(ts_source)

        self.assertEqual(anchors, {"SUN": (37.6173, 55.7558), "USA": (-77.0369, 38.8951)})

    def test_parse_ts_capital_overrides_raises_loudly_if_block_not_found(self):
        # Формат TS-файла изменился несовместимо с регэкспом -- должно упасть
        # громко, не молча вернуть пустой словарь (тихо отключив invariant 15).
        with self.assertRaises(ValueError):
            parse_ts_capital_overrides("const SOMETHING_ELSE = {};")

    def test_check_anchor_count_accepts_exact_match(self):
        check_anchor_count(13, 13)  # не должно бросить исключение

    def test_check_anchor_count_raises_when_fewer_than_expected(self):
        # Регэксп потерял запись (или формат файла подрос неожиданно) --
        # находка 6 независимого ревью: раньше порог был "не меньше 10" при
        # 13 реальных, пропуская потерю 3 молча. Теперь сравнение точное.
        with self.assertRaises(ValueError) as ctx:
            check_anchor_count(10, 13)
        self.assertIn("меньше", str(ctx.exception))

    def test_check_anchor_count_raises_when_more_than_expected(self):
        # Находка 2 (второй раунд независимого ревью, 2026-07-26): сравнение
        # "< expected" пропустило бы ПОЯВЛЕНИЕ нового легитимного якоря молча,
        # оставляя константу устаревшей навсегда. С "!=" это тоже громкая
        # ошибка -- сообщение должно объяснять, что делать (обновить константу
        # на актуальное число), не только "меньше -- чини регэксп".
        with self.assertRaises(ValueError) as ctx:
            check_anchor_count(14, 13)
        message = str(ctx.exception)
        self.assertIn("больше", message)
        self.assertIn("MIN_EXPECTED_TS_ANCHORS", message)
        self.assertIn("14", message)  # подсказывает конкретное новое значение

    def _make_region_feature(self, region_id: int) -> dict:
        # Числовой id — на уровне фичи, как в world_1946.geojson (контракт
        # полей geojson, 2026-08-09): `properties.id` был его дубликатом.
        return {
            "id": region_id,
            "properties": {"type": "region"},
            "geometry": SQUARE_LOW,
        }

    def test_build_region_geometries_extracts_only_region_type_features(self):
        features = [
            self._make_region_feature(i) for i in range(MIN_EXPECTED_REGIONS + 5)
        ] + [
            {"id": 99999, "properties": {"type": "ocean"}, "geometry": SQUARE_HIGH},
        ]

        geometries = build_region_geometries(features)

        self.assertEqual(len(geometries), MIN_EXPECTED_REGIONS + 5)
        self.assertNotIn(99999, geometries)

    def test_build_region_geometries_raises_loudly_when_almost_nothing_survives_the_filter(self):
        # Находка 2 независимого ревью (2026-07-26): если properties.type
        # переименуют/переструктурируют в world_1946.geojson, этот фильтр
        # тихо вернул бы {} (или почти пусто) -- find_containing_regions()
        # молчал бы для КАЖДОГО якоря, а validate_capital_geography() читал
        # бы это как "точка не в полигоне" (warning, не violation) для
        # каждой из 13 держав -- invariant 15 отключился бы целиком, а
        # "Все проверки пройдены чисто" осталось бы на экране. Должно
        # падать громко вместо этого.
        features = [self._make_region_feature(i) for i in range(5)]

        with self.assertRaises(ValueError):
            build_region_geometries(features)

    def test_build_region_geometries_raises_on_completely_empty_input(self):
        with self.assertRaises(ValueError):
            build_region_geometries([])


if __name__ == "__main__":
    unittest.main()
