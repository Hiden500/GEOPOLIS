#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест инварианта `build_seas_from_iho.py`: вода не лежит поверх суши.

Синтетическая фикстура, не завязанная на реальные данные 1946. Проверяется
свойство, а не снимок: конкретные площади вычисляются из самой фикстуры, а не
захардкожены, поэтому следующее наполнение данных тест не сломает.

Что держит тест. Исходник морей — IHO Sea Areas v3, делимитация морских
областей, а НЕ береговая линия: его полигоны накрывают сушу (на реальном
прогоне вычлось 830 902 км²). Инвариант «суша авторитетна, вода обрезается по
ней» — единственное, что отделяет новый слой от старого `seas_1946.geojson`,
где вода местами лежала на берегу (одна Аляска-Панхандл — 592.8 км²).

Запуск: python scripts/map/test_build_seas_from_iho.py
(stdlib unittest — без новых зависимостей)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))
from shapely.geometry import box
from shapely.strtree import STRtree

from build_seas_from_iho import subtract_local
from geometry_cleanup import area_km2


class SubtractLandTest(unittest.TestCase):
    def setUp(self):
        # «суша»: два острова внутри будущего моря + один заведомо вне его
        self.land = [box(1.0, 1.0, 2.0, 2.0),
                     box(3.0, 3.0, 3.5, 3.5),
                     box(50.0, 50.0, 51.0, 51.0)]
        self.tree = STRtree(self.land)

    def test_water_never_covers_land(self):
        """После обрезки пересечение воды с сушей — ноль."""
        sea = box(0.0, 0.0, 10.0, 10.0)
        water = subtract_local(sea, self.tree, self.land)
        for piece in self.land[:2]:
            self.assertAlmostEqual(water.intersection(piece).area, 0.0, places=12)

    def test_removed_area_equals_land_inside(self):
        """Убрано ровно столько, сколько суши лежало внутри, не больше."""
        sea = box(0.0, 0.0, 10.0, 10.0)
        expected = area_km2(self.land[0]) + area_km2(self.land[1])
        water = subtract_local(sea, self.tree, self.land)
        self.assertAlmostEqual(area_km2(sea) - area_km2(water), expected, places=3)

    def test_untouched_when_no_land_inside(self):
        """Море без суши внутри не меняется — обрезка не съедает лишнего."""
        sea = box(20.0, 20.0, 25.0, 25.0)
        water = subtract_local(sea, self.tree, self.land)
        self.assertAlmostEqual(area_km2(water), area_km2(sea), places=6)

    def test_island_becomes_hole_not_bite(self):
        """Остров внутри моря даёт дыру, а не вырез с края: море связно."""
        sea = box(0.0, 0.0, 10.0, 10.0)
        water = subtract_local(sea, self.tree, self.land)
        self.assertEqual(water.geom_type, "Polygon",
                         "море не должно разваливаться на части из-за острова")
        self.assertGreaterEqual(len(water.interiors), 2,
                                "оба острова внутри обязаны стать дырами")


if __name__ == "__main__":
    unittest.main()
