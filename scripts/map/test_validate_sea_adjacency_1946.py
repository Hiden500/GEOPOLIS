#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест инвариантов морской смежности (К-6) — validate_sea_adjacency_1946.py.

Запуск: python scripts/map/test_validate_sea_adjacency_1946.py
(stdlib unittest — без новых зависимостей, см. STACK_PLAYBOOK.md)

Фикстура синтетическая и НАМЕРЕННО не повторяет живой мир: на живых данных
проверить «инвариант умеет падать» нельзя, не сломав сценарий. Каждый инвариант
здесь ломается по одному, и тест требует не просто падения, а падения С ИМЕНЕМ
УЗЛА: «сосед 999 не существует» не говорит, где искать.

Отдельно — ребро lake<->sea. Форма его разрешает (Волго-Дон соединяет
Каспий-озеро с Азовом-морем), но на сегодняшних данных таких рёбер НОЛЬ: из 395
рёбер вода<->вода все 395 — sea<->sea, Каспий не касается ни одной морской зоны.
Поэтому проверять «lake<->sea не отвергается» можно только на фикстуре, и
обратная проверка («на живых данных их ноль») не заводится сознательно: это
состояние мира, которое обязано измениться, когда появится канал.
"""
import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_sea_adjacency_1946 import (
    check_against_neighbor_graph,
    check_coast_of_landlocked_graph,
    check_id_spaces,
    check_no_self_loop,
    check_resolvable,
    check_water_symmetry,
    validate_scenario_invariants,
)


def make_valid_fixture():
    """Мир из трёх кусков суши и двух акваторий:

    AAA-0001 — берег (сосед по суше + море), AAA-0002 — внутренний регион без
    воды (законно: сухопутный сосед у него есть), ISL-0001 — остров без
    сухопутных соседей, который держится в мире ТОЛЬКО морской смежностью;
    SEA-0001 <-> LAK-0001 — то самое ребро lake<->sea.
    """
    regions = [
        {"id": 1, "geoJsonId": "AAA-0001", "landNeighboringRegionIds": [2], "adjacentWaterIds": [11]},
        {"id": 2, "geoJsonId": "AAA-0002", "landNeighboringRegionIds": [1], "adjacentWaterIds": []},
        {"id": 3, "geoJsonId": "ISL-0001", "landNeighboringRegionIds": [], "adjacentWaterIds": [11]},
    ]
    waters = [
        {"id": 11, "geoJsonId": "SEA-0001", "waterType": "sea", "neighboringIds": [12]},
        {"id": 12, "geoJsonId": "LAK-0001", "waterType": "lake", "neighboringIds": [11]},
    ]
    # Источник. XXX-0001 — суша, которой в сценарии нет (в живых данных это семь
    # антарктических регионов без владельца): её рёбра доехать не могут и
    # нарушением не считаются.
    neighbors = {
        "AAA-0001": ["AAA-0002", "SEA-0001"],
        "AAA-0002": ["AAA-0001"],
        "ISL-0001": ["SEA-0001"],
        "SEA-0001": ["AAA-0001", "ISL-0001", "LAK-0001"],
        "LAK-0001": ["SEA-0001"],
        "XXX-0001": ["SEA-0001"],
    }
    return regions, waters, neighbors


class SeaAdjacencyInvariants(unittest.TestCase):
    def setUp(self):
        self.regions, self.waters, self.neighbors = make_valid_fixture()

    def assert_names(self, violations, *expected_names):
        """Падение обязано называть узел, а не только число."""
        self.assertTrue(violations, "инвариант не сработал — проверка не умеет падать")
        joined = " | ".join(violations)
        for name in expected_names:
            self.assertIn(name, joined, f"нарушение не называет узел {name}: {joined}")

    # --- положительный контроль ---

    def test_valid_fixture_is_clean(self):
        self.assertEqual(validate_scenario_invariants(self.regions, self.waters), [])
        violations, dropped = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assertEqual(violations, [])
        self.assertEqual(dropped, [("XXX-0001", "SEA-0001")])

    def test_lake_sea_edge_is_allowed(self):
        """Ребро озеро<->море форма разрешает. На живых данных таких рёбер
        сегодня ноль, и это ожидаемо — проверяется поэтому здесь."""
        lake = next(w for w in self.waters if w["waterType"] == "lake")
        sea = next(w for w in self.waters if w["waterType"] == "sea")
        self.assertIn(sea["id"], lake["neighboringIds"])
        self.assertEqual(validate_scenario_invariants(self.regions, self.waters), [])
        self.assertEqual(check_water_symmetry(self.waters), [])
        violations, _ = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assertEqual(violations, [])

    # --- негативный контроль: по одному инварианту за раз ---

    def test_broken_water_symmetry_fails(self):
        self.waters[1]["neighboringIds"] = []
        self.assert_names(check_water_symmetry(self.waters), "SEA-0001", "LAK-0001")
        self.assertTrue(validate_scenario_invariants(self.regions, self.waters))

    def test_dangling_water_id_fails(self):
        self.regions[0]["adjacentWaterIds"] = [999]
        self.assert_names(check_resolvable(self.regions, self.waters), "AAA-0001")
        self.assertIn("999", " | ".join(check_resolvable(self.regions, self.waters)))

    def test_dangling_land_id_fails(self):
        self.regions[0]["landNeighboringRegionIds"] = [777]
        self.assert_names(check_resolvable(self.regions, self.waters), "AAA-0001")

    def test_water_id_in_land_list_fails(self):
        """Существующий узел ЧУЖОГО пространства — тоже нарушение: море,
        записанное сухопутным соседом, разрешается, но лжёт."""
        self.regions[0]["landNeighboringRegionIds"] = [11]
        violations = check_resolvable(self.regions, self.waters)
        self.assert_names(violations, "AAA-0001", "SEA-0001")
        self.assertIn("не то пространство", " | ".join(violations))

    def test_land_id_in_water_list_fails(self):
        self.waters[0]["neighboringIds"] = [1, 12]
        self.assert_names(check_resolvable(self.regions, self.waters), "SEA-0001", "AAA-0001")

    def test_overlapping_id_spaces_fails(self):
        self.waters[0]["id"] = 1
        self.assert_names(check_id_spaces(self.regions, self.waters), "AAA-0001", "SEA-0001")

    def test_self_loop_in_water_fails(self):
        self.waters[0]["neighboringIds"].append(11)
        self.assert_names(check_no_self_loop(self.regions, self.waters), "SEA-0001")

    def test_self_loop_in_land_fails(self):
        self.regions[0]["landNeighboringRegionIds"].append(1)
        self.assert_names(check_no_self_loop(self.regions, self.waters), "AAA-0001")

    def test_island_without_coast_fails(self):
        """Головной инвариант: регион без сухопутных соседей и без воды выпадает
        из мира. Именно этот случай — 133 живых региона — и есть причина К-6."""
        self.regions[2]["adjacentWaterIds"] = []
        self.assert_names(check_coast_of_landlocked_graph(self.regions), "ISL-0001")

    def test_inland_region_without_coast_is_not_a_violation(self):
        """Обратный контроль к предыдущему: внутренний регион с сухопутным
        соседом воды иметь не обязан, и проверка не должна срабатывать на нём —
        иначе она ловит не то, ради чего написана."""
        self.assertEqual(check_coast_of_landlocked_graph([self.regions[1]]), [])

    # --- негативный контроль сверки с источником ---

    def test_lost_land_water_edge_fails(self):
        """Симметрия ребра суша<->вода: хранится оно с одной стороны, поэтому
        потеря направления видна только против neighbor_graph.json."""
        self.regions[2]["adjacentWaterIds"] = []
        violations, _ = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assert_names(violations, "ISL-0001", "SEA-0001")
        self.assertIn("потеряно", " | ".join(violations))

    def test_invented_land_water_edge_fails(self):
        self.regions[1]["adjacentWaterIds"] = [12]
        violations, _ = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assert_names(violations, "AAA-0002", "LAK-0001")
        self.assertIn("выдумано", " | ".join(violations))

    def test_lost_water_water_edge_fails(self):
        for w in self.waters:
            w["neighboringIds"] = []
        violations, _ = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assert_names(violations, "SEA-0001", "LAK-0001")
        self.assertIn("потеряно", " | ".join(violations))

    def test_invented_water_water_edge_fails(self):
        self.waters.append({"id": 13, "geoJsonId": "SEA-0002", "waterType": "sea", "neighboringIds": [11]})
        self.waters[0]["neighboringIds"] = [12, 13]
        violations, _ = check_against_neighbor_graph(self.regions, self.waters, self.neighbors)
        self.assert_names(violations, "SEA-0002")
        self.assertIn("выдумано", " | ".join(violations))

    def test_edge_of_region_outside_scenario_is_not_a_violation(self):
        """Ребро суши, которой в сценарии нет, — не нарушение экспорта, а
        следствие выброса региона без владельца этажом выше. Если однажды это
        станет нарушением, тест покажет разницу явно."""
        regions, waters, neighbors = make_valid_fixture()
        violations, dropped = check_against_neighbor_graph(regions, waters, neighbors)
        self.assertEqual(violations, [])
        self.assertEqual([land for land, _ in dropped], ["XXX-0001"])

    def test_fixture_mutations_do_not_leak(self):
        """setUp обязан давать чистую фикстуру каждому тесту — иначе негативные
        контроли начнут проходить по чужой поломке."""
        pristine = make_valid_fixture()[0]
        self.assertEqual(self.regions, pristine)
        self.assertEqual(deepcopy(self.regions), pristine)


if __name__ == "__main__":
    unittest.main()
