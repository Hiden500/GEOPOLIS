#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест измерения роста морей в fix_sea_coastline_gaps.py — синтетическая
фикстура, не завязанная на реальный seas_1946.geojson.

Дефект, который держит этот тест (найден 2026-07-23, причина установлена
2026-07-31): `to_polygonal` намеренно выбрасывает части меньше
DEGENERATE_AREA_DEG2 (1e-4 deg2 — до ~1.2 км² у экватора, это НЕ машинный
шум), а сторона `before` через ту же нормализацию не проходила. Из-за
асимметрии удаление печаталось как отрицательный рост — в живом выводе
буквально «+-0.0 km2», потому что знак «+» зашит в формат.

Проверяется свойство, а не снимок: конкретные площади фикстуры вычисляются,
а не захардкожены, и от наполнения данными 1946 тест не зависит.

Запуск: python scripts/map/test_fix_sea_coastline_gaps.py
(stdlib unittest — без новых зависимостей)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))
from shapely.geometry import box
from shapely.ops import unary_union

from fix_sea_coastline_gaps import measure_growth
from geometry_cleanup import area_km2, to_polygonal, DEGENERATE_AREA_DEG2


def _sub_threshold_part():
    """Часть заведомо ниже порога нормализации, но физически не нулевая."""
    side = (DEGENERATE_AREA_DEG2 * 0.81) ** 0.5
    part = box(5.0, 0.0, 5.0 + side, side)
    assert part.area < DEGENERATE_AREA_DEG2, "фикстура должна быть ниже порога"
    assert area_km2(part) > 0.1, "фикстура не должна быть вырожденной"
    return part


class MeasureGrowthTest(unittest.TestCase):
    def test_normalization_is_not_reported_as_negative_growth(self):
        """Рост не считается отрицательным из-за нормализации before."""
        big = box(0.0, 0.0, 1.0, 1.0)
        before = unary_union([big, _sub_threshold_part()])

        _, added, dropped = measure_growth(before, unary_union([before, big]))

        self.assertGreaterEqual(added, 0.0, "рост не происходил — минуса быть не может")
        self.assertAlmostEqual(added, 0.0, places=6)
        self.assertGreater(dropped, 0.0, "срезанное нормализацией должно быть названо")

    def test_dropped_area_matches_what_normalization_removes(self):
        """`dropped` равен именно тому, что убирает to_polygonal, а не оценке."""
        before = unary_union([box(0.0, 0.0, 1.0, 1.0), _sub_threshold_part()])
        expected = area_km2(before) - area_km2(to_polygonal(before))

        _, _, dropped = measure_growth(before, unary_union([before]))

        self.assertAlmostEqual(dropped, expected, places=6)

    def test_real_growth_is_still_reported(self):
        """Настоящий рост не съедается симметричной нормализацией."""
        before = box(0.0, 0.0, 1.0, 1.0)
        grown = box(0.0, 0.0, 1.0, 2.0)
        expected = area_km2(grown) - area_km2(before)

        _, added, dropped = measure_growth(before, unary_union([before, grown]))

        self.assertAlmostEqual(added, expected, places=6)
        self.assertEqual(dropped, 0.0)


if __name__ == "__main__":
    unittest.main()
