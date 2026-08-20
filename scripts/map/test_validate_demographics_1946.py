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
    influence_violations,
    layer_sync_report,
    historical_spot_check_violations,
    spot_check_catalog_violations,
    plausibility_warnings,
    single_use_groups,
    diplomacy_thresholds,
    diplomacy_violations,
    diplomacy_warnings,
    diplomacy_spot_check_violations,
    diplomacy_spot_check_catalog_violations,
    DIPLOMACY_TS_PATH,
    MAX_GROUPS_PER_REGION,
    INFLUENCE_MIN_RECORDED,
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



class InfluenceLayerTest(unittest.TestCase):
    """Слой влияния (`influence.json`, 2026-07-29)."""

    def make_influence(self):
        return {"influence": [{"sourceCountryId": "AAA", "targets": {"BBB": 60}}]}

    def test_valid_influence_passes(self):
        self.assertEqual(influence_violations(self.make_influence(), {"AAA", "BBB"}), [])

    def test_catches_unknown_source_and_target(self):
        data = {"influence": [{"sourceCountryId": "ZZZ", "targets": {"YYY": 60}}]}
        violations = influence_violations(data, {"AAA", "BBB"})
        self.assertTrue(any("ZZZ" in v for v in violations), violations)
        self.assertTrue(any("YYY" in v for v in violations), violations)

    def test_catches_self_influence(self):
        data = {"influence": [{"sourceCountryId": "AAA", "targets": {"AAA": 60}}]}
        violations = influence_violations(data, {"AAA", "BBB"})
        self.assertTrue(any("сам на себя" in v for v in violations), violations)

    def test_catches_value_below_recorded_floor(self):
        # Связь слабее порога движок не отличает от её отсутствия: такая запись
        # существовала бы только чтобы никем не читаться.
        data = {"influence": [{"sourceCountryId": "AAA", "targets": {"BBB": INFLUENCE_MIN_RECORDED - 1}}]}
        violations = influence_violations(data, {"AAA", "BBB"})
        self.assertTrue(any("вне" in v for v in violations), violations)

    def test_catches_duplicate_source(self):
        data = {"influence": [
            {"sourceCountryId": "AAA", "targets": {"BBB": 60}},
            {"sourceCountryId": "AAA", "targets": {"BBB": 20}},
        ]}
        violations = influence_violations(data, {"AAA", "BBB"})
        self.assertTrue(any("дубль источника" in v for v in violations), violations)


class LayerSyncTest(unittest.TestCase):
    """
    Сверка слоёв с составом карты.

    Разница между «потерян» и «не размечен» — не косметика: первое роняет
    загрузку сценария, второе штатно. Тесты держат обе стороны, иначе сверка
    выродилась бы либо в шум, либо в молчание.
    """

    def layers(self):
        demographics = {"regions": [{"regionId": 1, "groups": []}]}
        ideology = {"countries": [{"countryId": "AAA"}]}
        government = {"countries": [{"countryId": "AAA", "overlordIds": []}]}
        influence = {"influence": [{"sourceCountryId": "AAA", "targets": {"BBB": 60}}]}
        return demographics, ideology, government, influence

    def test_region_gone_from_map_is_reported_as_lost(self):
        demographics, ideology, government, influence = self.layers()
        lost, _ = layer_sync_report(set(), {"AAA", "BBB"}, demographics, ideology, government, influence)
        self.assertTrue(any("регион 1 исчез" in v for v in lost), lost)

    def test_country_gone_from_roster_is_reported_for_every_layer(self):
        demographics, ideology, government, influence = self.layers()
        lost, _ = layer_sync_report({1}, set(), demographics, ideology, government, influence)
        self.assertTrue(any("ideology.json" in v for v in lost), lost)
        self.assertTrue(any("government.json" in v for v in lost), lost)
        self.assertTrue(any("influence.json" in v and "источник" in v for v in lost), lost)
        self.assertTrue(any("influence.json" in v and "цель" in v for v in lost), lost)

    def test_lost_overlord_is_reported(self):
        demographics, ideology, _, influence = self.layers()
        government = {"countries": [{"countryId": "AAA", "overlordIds": ["GONE"]}]}
        lost, _ = layer_sync_report({1}, {"AAA", "BBB"}, demographics, ideology, government, influence)
        self.assertTrue(any("сюзерен 'GONE'" in v for v in lost), lost)

    def test_new_map_object_is_unmarked_not_lost(self):
        # Регион, появившийся на карте, — не ошибка: слои покрывают частично.
        demographics, ideology, government, influence = self.layers()
        lost, unmarked = layer_sync_report(
            {1, 2}, {"AAA", "BBB"}, demographics, ideology, government, influence
        )
        self.assertEqual(lost, [])
        self.assertTrue(any("регион 2" in u for u in unmarked), unmarked)
        self.assertTrue(any("'BBB'" in u for u in unmarked), unmarked)

    def test_layers_in_sync_report_nothing_lost(self):
        demographics, ideology, government, influence = self.layers()
        lost, _ = layer_sync_report({1}, {"AAA", "BBB"}, demographics, ideology, government, influence)
        self.assertEqual(lost, [])



class HistoricalSpotCheckTest(unittest.TestCase):
    """
    Курируемые исторические факты (ERROR).

    Тесты здесь проверяют не «валидатор что-то вернул», а что КАЖДЫЙ предикат
    ловит свою поломку. Спот-чек, который проходит любые данные, — единственная
    проверка, чей отказ работать невидим: формальные инварианты хотя бы упадут
    на битой сумме, а этот молча пропустит выдуманный состав.
    """

    def demographics(self, groups):
        return {"regions": [{"regionId": 1, "groups": groups}]}

    def test_dominant_group_is_catches_wrong_dominant(self):
        checks = {"checks": [{
            "id": "x", "regions": [1], "assert": "dominantGroupIs", "group": "estonians",
            "why": "тест",
        }]}
        data = self.demographics([{"groupId": "russians", "share": 0.9},
                                  {"groupId": "estonians", "share": 0.1}])
        violations = historical_spot_check_violations(data, checks)
        self.assertTrue(any("russians" in v for v in violations), violations)

    def test_dominant_group_not_in_catches_forbidden_dominant(self):
        checks = {"checks": [{
            "id": "baltic", "regions": [1], "assert": "dominantGroupNotIn",
            "groups": ["russians"], "why": "титульная нация",
        }]}
        data = self.demographics([{"groupId": "russians", "share": 0.8},
                                  {"groupId": "estonians", "share": 0.2}])
        self.assertTrue(historical_spot_check_violations(data, checks))

    def test_dominant_group_not_in_passes_when_titular_dominates(self):
        checks = {"checks": [{
            "id": "baltic", "regions": [1], "assert": "dominantGroupNotIn",
            "groups": ["russians"], "why": "титульная нация",
        }]}
        data = self.demographics([{"groupId": "estonians", "share": 0.9},
                                  {"groupId": "russians", "share": 0.1}])
        self.assertEqual(historical_spot_check_violations(data, checks), [])

    def test_share_floor_catches_erased_minority(self):
        # Классический вид галлюцинации: группа, которой в регионе было
        # большинство, просто исчезает из состава.
        checks = {"checks": [{
            "id": "sakhalin", "regions": [1], "assert": "groupShareAtLeast",
            "groups": ["japanese"], "minShare": 0.3, "why": "до репатриации",
        }]}
        data = self.demographics([{"groupId": "russians", "share": 0.95},
                                  {"groupId": "japanese", "share": 0.05}])
        self.assertTrue(historical_spot_check_violations(data, checks))

    def test_share_ceiling_catches_inflated_group(self):
        checks = {"checks": [{
            "id": "gaza", "regions": [1], "assert": "groupShareAtMost",
            "groups": ["yishuv_jews"], "maxShare": 0.1, "why": "почти целиком арабский",
        }]}
        data = self.demographics([{"groupId": "yishuv_jews", "share": 0.5},
                                  {"groupId": "palestinian_muslims", "share": 0.5}])
        self.assertTrue(historical_spot_check_violations(data, checks))

    def test_group_present_catches_missing_community(self):
        checks = {"checks": [{
            "id": "mandate", "regions": [1], "assert": "groupPresent",
            "groups": ["yishuv_jews"], "why": "обе общины присутствовали",
        }]}
        data = self.demographics([{"groupId": "palestinian_muslims", "share": 1.0}])
        self.assertTrue(historical_spot_check_violations(data, checks))

    def test_unmarked_region_is_skipped_not_failed(self):
        # Покрытие слоя — предмет отдельной проверки. Падать здесь второй раз
        # значит удваивать один сигнал и мешать частичному наполнению.
        checks = {"checks": [{
            "id": "x", "regions": [999], "assert": "dominantGroupIs", "group": "estonians",
            "why": "тест",
        }]}
        self.assertEqual(historical_spot_check_violations(self.demographics([
            {"groupId": "estonians", "share": 1.0}]), checks), [])

    def test_unknown_predicate_is_reported(self):
        checks = {"checks": [{"id": "x", "regions": [1], "assert": "somethingNew"}]}
        data = self.demographics([{"groupId": "estonians", "share": 1.0}])
        self.assertTrue(historical_spot_check_violations(data, checks))

    def test_catalog_drift_is_reported(self):
        # Набор фактов, ссылающийся на исчезнувшую группу, перестаёт проверять
        # то, что заявляет, — и делает это молча.
        checks = {"checks": [{"id": "x", "regions": [1], "assert": "dominantGroupIs",
                              "group": "gone_group"}]}
        violations = spot_check_catalog_violations(checks, {"estonians"})
        self.assertTrue(any("gone_group" in v for v in violations), violations)

    def test_real_spot_check_file_is_consistent_with_catalog(self):
        # Проверка на реальных файлах репозитория: набор фактов и каталог групп
        # не разошлись.
        import json
        from pathlib import Path
        from validate_demographics_1946 import SPOT_CHECKS_PATH, GROUPS_PATH

        if not SPOT_CHECKS_PATH.exists() or not GROUPS_PATH.exists():
            self.skipTest("файлы сценария недоступны")
        checks = json.loads(Path(SPOT_CHECKS_PATH).read_text(encoding="utf-8"))
        groups = json.loads(Path(GROUPS_PATH).read_text(encoding="utf-8"))
        known = {g.get("id") for g in groups.get("groups", [])}
        self.assertEqual(spot_check_catalog_violations(checks, known), [])


class PlausibilityHeuristicsTest(unittest.TestCase):
    """
    Эвристики правдоподобия (WARNING).

    Обе стороны важны: эвристика обязана срабатывать на подозрительном И
    молчать на нормальном. Односторонняя проверка вырождается либо в шум, либо
    в бесполезное молчание.
    """

    def core(self, neighbours):
        return [{"id": rid, "landNeighboringRegionIds": nb} for rid, nb in neighbours.items()]

    def test_all_round_shares_warns(self):
        data = {"regions": [{"regionId": 1, "groups": [
            {"groupId": "a", "share": 0.6}, {"groupId": "b", "share": 0.4}]}]}
        warnings = plausibility_warnings(data, self.core({1: []}))
        self.assertTrue(any("кратны" in w for w in warnings), warnings)

    def test_uneven_shares_do_not_warn(self):
        data = {"regions": [{"regionId": 1, "groups": [
            {"groupId": "a", "share": 0.63}, {"groupId": "b", "share": 0.37}]}]}
        warnings = plausibility_warnings(data, self.core({1: []}))
        self.assertEqual([w for w in warnings if "кратны" in w], [])

    def test_single_group_warns(self):
        data = {"regions": [{"regionId": 1, "groups": [{"groupId": "a", "share": 1.0}]}]}
        warnings = plausibility_warnings(data, self.core({1: []}))
        self.assertTrue(any("единственная группа" in w for w in warnings), warnings)

    def test_dominant_absent_from_all_neighbours_warns(self):
        data = {"regions": [
            {"regionId": 1, "groups": [{"groupId": "island", "share": 0.99},
                                       {"groupId": "x", "share": 0.01}]},
            {"regionId": 2, "groups": [{"groupId": "mainland", "share": 0.99},
                                       {"groupId": "x", "share": 0.01}]},
        ]}
        warnings = plausibility_warnings(data, self.core({1: [2], 2: [1]}))
        self.assertTrue(any("island" in w and "соседей" in w for w in warnings), warnings)

    def test_dominant_shared_with_neighbour_does_not_warn(self):
        data = {"regions": [
            {"regionId": 1, "groups": [{"groupId": "same", "share": 0.99},
                                       {"groupId": "x", "share": 0.01}]},
            {"regionId": 2, "groups": [{"groupId": "same", "share": 0.99},
                                       {"groupId": "x", "share": 0.01}]},
        ]}
        warnings = plausibility_warnings(data, self.core({1: [2], 2: [1]}))
        self.assertEqual([w for w in warnings if "соседей" in w], [])

    def test_region_without_neighbours_does_not_warn_about_isolation(self):
        # Остров без размеченных соседей: сравнивать не с чем, и молчать здесь
        # правильнее, чем предупреждать обо всём побережье мира.
        data = {"regions": [{"regionId": 1, "groups": [
            {"groupId": "island", "share": 0.99}, {"groupId": "x", "share": 0.01}]}]}
        warnings = plausibility_warnings(data, self.core({1: []}))
        self.assertEqual([w for w in warnings if "соседей" in w], [])

    def test_single_use_groups_listed_separately(self):
        data = {"regions": [
            {"regionId": 1, "groups": [{"groupId": "common", "share": 0.99},
                                       {"groupId": "rare", "share": 0.01}]},
            {"regionId": 2, "groups": [{"groupId": "common", "share": 1.0}]},
        ]}
        self.assertEqual(single_use_groups(data), ["rare"])



#: Реальные константы из shared/src/defines/diplomacy.ts. Тесты дипломатии
#: используют ИХ, а не свои числа: захардкоженный порог сделал бы тесты
#: зелёными после правки калибровки, которая ломает данные.
DIPLOMACY_TS = DIPLOMACY_TS_PATH.read_text(encoding="utf-8")
ROSTER = {"AAA", "BBB", "CCC", "DDD"}


class DiplomacyLayerTest(unittest.TestCase):
    """
    Инварианты дипломатического слоя (ERROR).

    Главный проверяемый класс — «данные, которые движок отменяет на первом
    тике». Союз без отношений и соперничество при тёплых отношениях формально
    валидны, но `DiplomacyTick` снимает их немедленно: такая разметка описывает
    не мир, а собственное исчезновение.
    """

    def check(self, layer):
        return diplomacy_violations(layer, ROSTER, DIPLOMACY_TS)

    def test_unknown_country_is_reported(self):
        out = self.check({"relations": [{"pair": ["AAA", "ZZZ"], "value": 50}]})
        self.assertTrue(any("ZZZ" in v for v in out), out)

    def test_self_pair_is_reported(self):
        out = self.check({"relations": [{"pair": ["AAA", "AAA"], "value": 50}]})
        self.assertTrue(any("сама с собой" in v for v in out), out)

    def test_duplicate_pair_in_reverse_order_is_reported(self):
        # Направление у отношений не значимо (дрейф ведёт обе стороны к одной
        # цели), поэтому (A,B) и (B,A) — одна связь и дубль.
        out = self.check({"relations": [
            {"pair": ["AAA", "BBB"], "value": 50},
            {"pair": ["BBB", "AAA"], "value": 20},
        ]})
        self.assertTrue(any("дважды" in v for v in out), out)

    def test_value_out_of_scale_is_reported(self):
        out = self.check({"relations": [{"pair": ["AAA", "BBB"], "value": 150}]})
        self.assertTrue(any("вне шкалы" in v for v in out), out)

    def test_alliance_without_relations_is_reported(self):
        out = self.check({"alliances": [{"pair": ["AAA", "BBB"]}]})
        self.assertTrue(any("без записи в relations" in v for v in out), out)

    def test_alliance_below_break_floor_is_reported(self):
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        out = self.check({
            "relations": [{"pair": ["AAA", "BBB"], "value": thresholds["break_floor"] - 1}],
            "alliances": [{"pair": ["AAA", "BBB"]}],
        })
        self.assertTrue(any("не выживет" in v for v in out), out)

    def test_alliance_above_break_ceiling_is_clean(self):
        # Обратная сторона: союз, который переживёт любую идеологическую
        # дистанцию, не должен давать ни ошибки, ни предупреждения.
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        layer = {
            "relations": [{"pair": ["AAA", "BBB"], "value": thresholds["break_ceiling"] + 11}],
            "alliances": [{"pair": ["AAA", "BBB"]}],
        }
        self.assertEqual(self.check(layer), [])
        self.assertEqual(diplomacy_warnings(layer, DIPLOMACY_TS), [])

    def test_alliance_and_rivalry_on_same_pair_is_reported(self):
        out = self.check({
            "relations": [{"pair": ["AAA", "BBB"], "value": 60}],
            "alliances": [{"pair": ["AAA", "BBB"]}],
            "rivalries": [{"pair": ["AAA", "BBB"]}],
        })
        self.assertTrue(any("одновременно" in v for v in out), out)

    def test_rivalry_with_warm_relations_is_reported(self):
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        out = self.check({
            "relations": [{"pair": ["AAA", "BBB"], "value": thresholds["rival_reconcile"] + 1}],
            "rivalries": [{"pair": ["AAA", "BBB"]}],
        })
        self.assertTrue(any("порога примирения" in v for v in out), out)

    def test_rivalry_below_reconcile_threshold_is_clean(self):
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        out = self.check({
            "relations": [{"pair": ["AAA", "BBB"], "value": thresholds["rival_reconcile"] - 10}],
            "rivalries": [{"pair": ["AAA", "BBB"]}],
        })
        self.assertEqual(out, [])

    def test_guarantee_to_self_is_reported(self):
        out = self.check({"guarantees": [{"guarantor": "AAA", "protected": "AAA"}]})
        self.assertTrue(any("сама себе" in v for v in out), out)

    def test_unreadable_ts_constants_are_reported(self):
        # Самая опасная поломка: литерал переименован, границы не прочитались,
        # и проверки молча стали пустыми. Тогда отчёт «0 ошибок» ничего не
        # означает, поэтому непрочитанные константы — сами ошибка.
        out = diplomacy_violations({"relations": []}, ROSTER, "")
        self.assertTrue(any("не прочитаны константы" in v for v in out), out)


class DiplomacyWarningsTest(unittest.TestCase):
    """Правдоподобие дипломатического слоя (WARNING) — обе стороны."""

    def test_coordinate_dependent_alliance_warns(self):
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        middle = (thresholds["break_floor"] + thresholds["break_ceiling"]) / 2
        out = diplomacy_warnings({
            "relations": [{"pair": ["AAA", "BBB"], "value": middle}],
            "alliances": [{"pair": ["AAA", "BBB"]}],
        }, DIPLOMACY_TS)
        self.assertTrue(any("идеологически близких" in w for w in out), out)

    def test_scale_edge_warns(self):
        thresholds, _ = diplomacy_thresholds(DIPLOMACY_TS)
        out = diplomacy_warnings(
            {"relations": [{"pair": ["AAA", "BBB"], "value": thresholds["scale_max"]}]},
            DIPLOMACY_TS,
        )
        self.assertTrue(any("краю шкалы" in w for w in out), out)

    def test_all_multiples_of_five_warn(self):
        out = diplomacy_warnings({"relations": [
            {"pair": ["AAA", "BBB"], "value": 60},
            {"pair": ["CCC", "DDD"], "value": 25},
        ]}, DIPLOMACY_TS)
        self.assertTrue(any("кратны 5" in w for w in out), out)

    def test_uneven_values_do_not_warn(self):
        out = diplomacy_warnings({"relations": [
            {"pair": ["AAA", "BBB"], "value": 63},
            {"pair": ["CCC", "DDD"], "value": 22},
        ]}, DIPLOMACY_TS)
        self.assertEqual([w for w in out if "кратны 5" in w], [])


class DiplomacySpotCheckTest(unittest.TestCase):
    """
    Курируемые дипломатические факты (ERROR).

    Отличие от демографии: отсутствие пары — не пробел разметки, а утверждение
    «связи нет». Страны существуют все 157, поэтому пропускать нечего.
    """

    def check(self, layer, checks):
        return diplomacy_spot_check_violations(layer, checks, ROSTER)

    def test_allied_pair_missing_is_reported(self):
        out = self.check({"alliances": []}, {"checks": [
            {"id": "x", "assert": "alliedPair", "pair": ["AAA", "BBB"], "why": "договор"},
        ]})
        self.assertTrue(any("отсутствует в данных" in v for v in out), out)

    def test_allied_pair_present_passes_in_either_order(self):
        out = self.check({"alliances": [{"pair": ["BBB", "AAA"]}]}, {"checks": [
            {"id": "x", "assert": "alliedPair", "pair": ["AAA", "BBB"], "why": "договор"},
        ]})
        self.assertEqual(out, [])

    def test_invented_alliance_is_reported(self):
        out = self.check({"alliances": [{"pair": ["AAA", "BBB"]}]}, {"checks": [
            {"id": "x", "assert": "notAlliedPair", "pair": ["AAA", "BBB"], "why": "договора не было"},
        ]})
        self.assertTrue(any("хотя его не было" in v for v in out), out)

    def test_relation_floor_catches_low_value(self):
        out = self.check({"relations": [{"pair": ["AAA", "BBB"], "value": 10}]}, {"checks": [
            {"id": "x", "assert": "relationAtLeast", "pair": ["AAA", "BBB"], "minValue": 60},
        ]})
        self.assertTrue(out)

    def test_relation_floor_catches_absent_pair(self):
        # Отсутствие связи — утверждение о её отсутствии, а не пропуск.
        out = self.check({"relations": []}, {"checks": [
            {"id": "x", "assert": "relationAtLeast", "pair": ["AAA", "BBB"], "minValue": 60},
        ]})
        self.assertTrue(any("нет отношений" in v for v in out), out)

    def test_relation_ceiling_catches_high_value(self):
        out = self.check({"relations": [{"pair": ["AAA", "BBB"], "value": 80}]}, {"checks": [
            {"id": "x", "assert": "relationAtMost", "pair": ["AAA", "BBB"], "maxValue": 0},
        ]})
        self.assertTrue(out)

    def test_mutually_positive_catches_hostile_pair(self):
        out = self.check({"relations": [{"pair": ["AAA", "CCC"], "value": -20}]}, {"checks": [
            {"id": "x", "assert": "mutuallyPositive", "group": ["AAA", "BBB", "CCC"]},
        ]})
        self.assertTrue(any("отрицательны" in v for v in out), out)

    def test_unknown_predicate_is_reported(self):
        out = self.check({}, {"checks": [{"id": "x", "assert": "somethingNew"}]})
        self.assertTrue(out)

    def test_catalog_drift_is_reported(self):
        out = diplomacy_spot_check_catalog_violations(
            {"checks": [{"id": "x", "assert": "alliedPair", "pair": ["AAA", "GONE"]}]}, ROSTER
        )
        self.assertTrue(any("GONE" in v for v in out), out)

    def test_real_spot_check_file_matches_real_roster(self):
        # Проверка на живых файлах: набор фактов и ростер стран не разошлись.
        import json
        from pathlib import Path
        from validate_demographics_1946 import DIPLOMACY_SPOT_CHECKS_PATH, COUNTRIES_PATH

        if not DIPLOMACY_SPOT_CHECKS_PATH.exists() or not COUNTRIES_PATH.exists():
            self.skipTest("файлы сценария недоступны")
        checks = json.loads(Path(DIPLOMACY_SPOT_CHECKS_PATH).read_text(encoding="utf-8"))
        countries = json.loads(Path(COUNTRIES_PATH).read_text(encoding="utf-8"))
        entries = countries["countries"] if isinstance(countries, dict) else countries
        roster = {c.get("id") for c in entries}
        self.assertEqual(diplomacy_spot_check_catalog_violations(checks, roster), [])
        self.assertTrue(checks.get("checks"), "набор фактов пуст — проверять нечего")


if __name__ == "__main__":
    unittest.main()
