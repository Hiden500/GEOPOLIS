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
from shapely.ops import unary_union
from shapely.strtree import STRtree

from build_seas_from_iho import (subtract_local, nearest_source_idx,
                                  assign_adaptive, keep_real_water, world_tiles)
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


class NearestSourceTest(unittest.TestCase):
    """Правило «остаток достаётся ближайшей ИСХОДНОЙ акватории».

    Держит то, ради чего правило и вводилось: линия раздела двух акваторий
    продолжается ПРЯМОЙ через заполненный остаток, а не обходит остров зубцом.
    Раньше остаток раздавался по «самой длинной общей границе» с уже выросшим
    соседом — исход решала форма острова.
    """

    def setUp(self):
        # два моря, сходящиеся по прямой x = 0
        self.west = box(-10.0, -5.0, 0.0, 5.0)
        self.east = box(0.0, -5.0, 10.0, 5.0)
        self.cands = [(0, self.west), (1, self.east)]

    def test_side_of_line_decides(self):
        """Точка достаётся морю со своей стороны прямой, а не по форме соседа."""
        self.assertEqual(nearest_source_idx(box(-3.0, 6.0, -2.0, 7.0), self.cands), 0)
        self.assertEqual(nearest_source_idx(box(2.0, 6.0, 3.0, 7.0), self.cands), 1)

    def test_divide_continues_straight(self):
        """Заполненный остаток делится ровно по продолжению прямой x = 0."""
        gap = box(-4.0, 5.0, 4.0, 9.0)          # полоса над обоими морями
        out = {}
        assign_adaptive(gap, self.cands, out)
        west_part = unary_union(out.get(0, []))
        east_part = unary_union(out.get(1, []))
        self.assertFalse(west_part.is_empty)
        self.assertFalse(east_part.is_empty)
        # ни одна доля не перелезла на чужую сторону дальше допуска дробления
        self.assertLess(west_part.bounds[2], 1e-3, "западная доля перешла прямую")
        self.assertGreater(east_part.bounds[0], -1e-3, "восточная доля перешла прямую")
        # и вместе они покрывают весь остаток
        self.assertAlmostEqual(west_part.area + east_part.area, gap.area, places=6)


class KeepRealWaterTest(unittest.TestCase):
    """Фильтр по ФОРМЕ, а не по размеру."""

    def test_small_compact_survives(self):
        """Залив между островами в ~1 км² — настоящая вода, не шум."""
        from shapely.geometry import MultiPolygon
        big = box(0.0, 0.0, 1.0, 1.0)
        small = box(5.0, 0.0, 5.009, 0.009)     # ниже DEGENERATE_AREA_DEG2
        kept = keep_real_water(MultiPolygon([big, small]))
        self.assertAlmostEqual(kept.area, big.area + small.area, places=12)

    def test_thread_dropped(self):
        """Длинная нить нулевой ширины — шум, выбрасывается."""
        from shapely.geometry import MultiPolygon
        big = box(0.0, 0.0, 1.0, 1.0)
        thread = box(5.0, 0.0, 15.0, 5e-5)      # полуширина много ниже порога
        kept = keep_real_water(MultiPolygon([big, thread]))
        self.assertAlmostEqual(kept.area, big.area, places=12)


class WorldTilesTest(unittest.TestCase):
    def test_tiles_cover_the_whole_world(self):
        """Обход обязан покрывать мир целиком.

        Негативный контроль этого теста — исходный `TILES` из
        `fix_sea_coastline_gaps.py`: он покрывает 79.4%, и Кергелен с
        Гренландией остались с разрывами именно поэтому.
        """
        world = box(-180.0, -90.0, 180.0, 90.0)
        covered = unary_union([box(*t) for _, t in world_tiles()])
        self.assertAlmostEqual(covered.area, world.area, places=6)
        self.assertTrue(covered.contains(box(67.5, -50.5, 71.5, -47.5)),
                        "Кергелен обязан попадать в обход")


if __name__ == "__main__":
    unittest.main()
