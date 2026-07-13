#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест structural-инвариантов validate_region_economy_1946.py (docs/plans/
05_DATA_LAYOUT.md, Срез 4) — синтетическая фикстура, не завязана на реальные
1366 регионов/128 стран (те калибровочные проверки покрываются прогоном
validate_region_economy_1946.py на реальных данных в CI/при регенерации).

Запуск: python scripts/map/test_validate_region_economy_1946.py
(stdlib unittest — без новых зависимостей, см. STACK_PLAYBOOK.md)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_region_economy_1946 import validate_structural_invariants

CATALOG = {"resources": {"food": {"category": "agricultural", "eraIntroduced": 1836}}}


def make_valid_fixture():
    regions = [
        {
            "id": 1, "geoJsonId": "AAA-0001", "ownerCountryId": "AAA",
            "neighboringRegionIds": [2], "deposits": {"food": 5}, "extraction": {"food": 10},
        },
        {
            "id": 2, "geoJsonId": "BBB-0001", "ownerCountryId": "BBB",
            "neighboringRegionIds": [1], "deposits": {}, "extraction": {},
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
        regions[1]["neighboringRegionIds"] = []

        violations = validate_structural_invariants(regions, countries, CATALOG, names_en, names_ru)

        self.assertTrue(any("несимметричный сосед" in v for v in violations), violations)

    def test_catches_neighbor_pointing_at_nonexistent_region(self):
        regions, countries, names_en, names_ru = make_valid_fixture()
        regions[0]["neighboringRegionIds"] = [999]

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


if __name__ == "__main__":
    unittest.main()
