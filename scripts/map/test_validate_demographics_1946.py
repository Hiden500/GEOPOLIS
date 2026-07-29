#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест инвариантов validate_demographics_1946.py (docs/plans/
13_MILESTONE_0_VERTICAL_SLICE.md, сессия A) — синтетическая фикстура, не
завязанная на реальную разметку 1946. Реальные данные проверяются прогоном
самого валидатора; здесь проверяется, что валидатор действительно ЛОВИТ
нарушения, а не молча возвращает пустой список.

Тот же паттерн и тот же runner, что у соседа
test_validate_region_economy_1946.py.

Запуск: python scripts/map/test_validate_demographics_1946.py
(stdlib unittest — без новых зависимостей, см. STACK_PLAYBOOK.md)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_demographics_1946 import (
    validate,
    zone_anchor_parity_violations,
    MAX_GROUPS_PER_REGION,
)
from ideology_zones import ZONE_ANCHORS, zone_for

REGION_IDS = {1, 2}
# Страны фикстуры: ярлык обязан соответствовать координатам ниже, иначе сработает
# инвариант «ярлык — производное от координат» (AAA — зона Communism,
# BBB — зона Liberal Democracy).
COUNTRIES = [
    {"id": "AAA", "politics": {"ideology": "Communism"}},
    {"id": "BBB", "politics": {"ideology": "Liberal Democracy"}},
]


def make_valid_fixture():
    groups = {
        "groups": [
            {
                "id": "alphans",
                "names": {"en": "Alphans", "ru": "Альфанцы"},
                "desiredIdeology": {"economic": -0.1, "political": 0.45},
            },
            {
                "id": "betans",
                "names": {"en": "Betans", "ru": "Бетанцы"},
                "desiredIdeology": {"economic": -0.7, "political": -0.55},
            },
        ]
    }
    demographics = {
        "regions": [
            {"regionId": 1, "groups": [{"groupId": "alphans", "share": 0.88},
                                       {"groupId": "betans", "share": 0.12}]},
            {"regionId": 2, "groups": [{"groupId": "betans", "share": 1.0}]},
        ]
    }
    ideology = {
        "countries": [
            {"countryId": "AAA", "economic": -0.95, "political": -0.9},
            {"countryId": "BBB", "economic": 0.35, "political": 0.75},
        ]
    }
    return groups, demographics, ideology


def run(groups, demographics, ideology, countries=None):
    return validate(
        groups,
        demographics,
        ideology,
        REGION_IDS,
        [dict(c, politics=dict(c["politics"])) for c in (countries or COUNTRIES)],
    )


class ValidateDemographicsTest(unittest.TestCase):
    def test_valid_fixture_has_no_violations(self):
        self.assertEqual(run(*make_valid_fixture()), [])

    def test_catches_duplicate_group_id(self):
        groups, demographics, ideology = make_valid_fixture()
        groups["groups"].append(dict(groups["groups"][0]))

        violations = run(groups, demographics, ideology)

        self.assertTrue(
            any("groups.json" in v and "дубль группы" in v for v in violations),
            violations,
        )

    def test_catches_group_without_english_name(self):
        groups, demographics, ideology = make_valid_fixture()
        groups["groups"][0]["names"] = {"ru": "Альфанцы"}

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("без английского имени" in v for v in violations), violations)

    def test_catches_axis_out_of_range(self):
        groups, demographics, ideology = make_valid_fixture()
        ideology["countries"][0]["economic"] = -1.5

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("вне диапазона" in v for v in violations), violations)

    def test_catches_axis_with_too_many_decimals(self):
        groups, demographics, ideology = make_valid_fixture()
        groups["groups"][0]["desiredIdeology"]["political"] = 0.4567

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("знаков после запятой" in v for v in violations), violations)

    def test_catches_shares_not_summing_to_one(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"][0]["groups"][1]["share"] = 0.5  # 0.88 + 0.50

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("сумма долей" in v for v in violations), violations)

    def test_catches_share_outside_open_unit_interval(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"][1]["groups"][0]["share"] = 0

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("вне (0, 1]" in v for v in violations), violations)

    def test_catches_unknown_group_reference(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"][1]["groups"][0]["groupId"] = "gammans"

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("неизвестную группу" in v for v in violations), violations)

    def test_catches_duplicate_group_inside_region(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"][0]["groups"] = [
            {"groupId": "alphans", "share": 0.5},
            {"groupId": "alphans", "share": 0.5},
        ]

        violations = run(groups, demographics, ideology)

        self.assertTrue(
            any("demographics.json" in v and "дубль группы" in v for v in violations),
            violations,
        )

    def test_catches_too_many_groups_per_region(self):
        groups, demographics, ideology = make_valid_fixture()
        extra_ids = [f"group{i}" for i in range(MAX_GROUPS_PER_REGION + 1)]
        groups["groups"] = [
            {"id": gid, "names": {"en": gid}, "desiredIdeology": {"economic": 0.0, "political": 0.0}}
            for gid in extra_ids
        ]
        share = round(1.0 / len(extra_ids), 4)
        entries = [{"groupId": gid, "share": share} for gid in extra_ids]
        entries[0]["share"] = round(1.0 - share * (len(extra_ids) - 1), 4)
        demographics["regions"] = [{"regionId": 1, "groups": entries}]

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("максимум" in v for v in violations), violations)

    def test_catches_region_missing_from_scenario(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"][0]["regionId"] = 999

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("999" in v and "не существует" in v for v in violations), violations)

    def test_catches_country_missing_from_scenario(self):
        groups, demographics, ideology = make_valid_fixture()
        ideology["countries"][0]["countryId"] = "ZZZ"

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("ZZZ" in v and "не существует" in v for v in violations), violations)

    def test_catches_duplicate_region_entry(self):
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"].append(dict(demographics["regions"][1]))

        violations = run(groups, demographics, ideology)

        self.assertTrue(any("дубль региона" in v for v in violations), violations)

    def test_partial_region_coverage_is_not_a_violation(self):
        # Свойство слоя РЕГИОНОВ: размечать все 1399 не требуется. Регион 2
        # просто отсутствует — валидатор обязан молчать, иначе частичное
        # покрытие (штатное состояние) выглядело бы как поломка данных.
        groups, demographics, ideology = make_valid_fixture()
        demographics["regions"] = demographics["regions"][:1]

        self.assertEqual(run(groups, demographics, ideology), [])

    def test_catches_country_without_coordinates(self):
        # Страны — наоборот: покрытие обязано быть полным (2026-07-27), иначе
        # страна молча уезжает на фолбэк по ярлыку и оказывается в точке
        # каталога вместо своей исторической позиции.
        groups, demographics, ideology = make_valid_fixture()
        ideology["countries"] = ideology["countries"][:1]

        violations = run(groups, demographics, ideology)

        self.assertTrue(
            any("BBB" in v and "нет координат" in v for v in violations), violations
        )

    def test_catches_label_diverged_from_coordinates(self):
        # Инвариант «ярлык — производное от координат». Ровно этот случай
        # (координаты описывают диктатуру, ярлык говорит «демократия») и был
        # причиной перевода ярлыка в производные.
        groups, demographics, ideology = make_valid_fixture()
        countries = [
            {"id": "AAA", "politics": {"ideology": "Liberal Democracy"}},
            {"id": "BBB", "politics": {"ideology": "Liberal Democracy"}},
        ]

        violations = run(groups, demographics, ideology, countries)

        self.assertTrue(
            any("AAA" in v and "Communism" in v for v in violations), violations
        )

    def test_every_zone_anchor_lands_in_its_own_zone(self):
        # Round-trip каталога: прямой ход (ярлык -> координаты, фолбэк движка) и
        # обратный (координаты -> ярлык, генераторы) обязаны быть согласованы,
        # иначе перегенерация реестра переименовывала бы страну, стоящую ровно
        # в точке своей же зоны.
        for label, (economic, political) in ZONE_ANCHORS.items():
            with self.subTest(label=label):
                self.assertEqual(zone_for(economic, political), label)

    def test_zone_catalog_matches_typescript_table(self):
        # Каталог продублирован в TS (движок) и Python (генераторы) намеренно;
        # эта проверка держит их одинаковыми на реальных файлах репозитория.
        self.assertEqual(zone_anchor_parity_violations(), [])

    def test_mutation_does_not_leak_between_cases(self):
        groups_a, *_ = make_valid_fixture()
        groups_b, *_ = make_valid_fixture()
        groups_a["groups"][0]["id"] = "changed"
        self.assertEqual(groups_b["groups"][0]["id"], "alphans")


if __name__ == "__main__":
    unittest.main()
