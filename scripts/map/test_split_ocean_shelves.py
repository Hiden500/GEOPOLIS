#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тесты инвариантов нарезки (`build/split_ocean_shelves.py`).

Синтетические фикстуры, не завязанные на данные 1946: проверяются СВОЙСТВА
разреза — покрытие без дыр и наложений, возврат крошек в ядро, сохранение
границы вдоль ±180, ограничение вылета зоны, — а не конкретные имена зон,
площади и число кусков, которые изменит следующая правка конфига.

Негативные контроли (каждый прогнан, вывод падения — в отчёте задачи):

1. `CrumbsTest` падает на прежнем порядке операций, где ядро вычиталось ДО
   выброса крошек: кусок, убранный из зоны, оказывался вычтен из ядра и не
   добавлен никуда — в слое появлялась дыра. Восстановить старое поведение:

       drop_crumbs -> lambda g, *a, **k: g   # тогда крошек не бывает вовсе
   а честный контроль — вернуть в `split_monolith` порядок
   «core = mono - carved; потом drop_crumbs(carved)».

2. `SeamTest` падает без `wrap`/`unwrap`: подмена `wrap` на тождество ломает
   непрерывность монолита у линии дат.

Запуск: python scripts/map/test_split_ocean_shelves.py
(stdlib unittest — без новых зависимостей)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))
from shapely.geometry import MultiPolygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

import split_ocean_shelves as sos
from geometry_cleanup import area_km2


def scenario(zone_spec, land, mono):
    """Прогнать разрез на синтетической фикстуре."""
    tree = STRtree(land)
    return sos.split_monolith(mono, zone_spec, land, tree)


def coverage(mono, carved, core):
    """(потеряно, лишнего, наложение) в км² — те же три величины, что в скрипте."""
    pieces = [g for _, _, g in carved if not g.is_empty] + [core]
    lost = area_km2(mono.difference(unary_union(pieces)))
    spill = max(area_km2(g.difference(mono)) for g in pieces)
    overlap = 0.0
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            overlap = max(overlap, area_km2(pieces[i].intersection(pieces[j])))
    return lost, spill, overlap


class CoverageTest(unittest.TestCase):
    """Куски покрывают монолит ровно: ни дыры, ни спилла, ни наложений."""

    def setUp(self):
        self.mono = box(0.0, 0.0, 20.0, 20.0)
        self.land = [box(-2.0, 0.0, 0.0, 20.0)]
        self.spec = {"zones": [
            {"name": "A", "anchors": [[1.0, 5.0]], "coast_reach_deg": 2.0,
             "anchor_reach_deg": 8.0},
            {"name": "B", "anchors": [[1.0, 15.0]], "coast_reach_deg": 2.0,
             "anchor_reach_deg": 8.0},
        ]}

    def test_pieces_tile_the_monolith(self):
        carved, core = scenario(self.spec, self.land, self.mono)
        lost, spill, overlap = coverage(self.mono, carved, core)
        self.assertAlmostEqual(lost, 0.0, places=3)
        self.assertAlmostEqual(spill, 0.0, places=3)
        self.assertAlmostEqual(overlap, 0.0, places=3)

    def test_core_keeps_the_open_water(self):
        """Ядро не исчезает: полоса у берега — не весь монолит."""
        carved, core = scenario(self.spec, self.land, self.mono)
        self.assertFalse(core.is_empty)
        self.assertGreater(area_km2(core), area_km2(self.mono) * 0.5)

    def test_zone_hugs_the_coast(self):
        """Зона не уходит в открытый океан дальше своего `coast_reach_deg`."""
        carved, _ = scenario(self.spec, self.land, self.mono)
        for _, z, g in carved:
            if g.is_empty:
                continue
            self.assertLessEqual(g.bounds[2], z["coast_reach_deg"] + 1e-9,
                                 "зона вышла за прибрежную полосу")


class AnchorReachTest(unittest.TestCase):
    """Далёкий берег в ячейку попадает, а в зону — нет.

    Правило существует из-за Сан-Томе: ячейка Вороного ближайшая, но берег
    лежит за 2000 км, и зона `Guinea Plateau` без ограничения дотягивалась бы
    до него.
    """

    def test_far_coast_stays_in_the_core(self):
        mono = box(0.0, 0.0, 40.0, 20.0)
        near = box(-2.0, 0.0, 0.0, 20.0)
        far = box(38.0, 9.0, 39.0, 11.0)      # островок у дальнего края
        mono = mono.difference(far)
        spec = {"zones": [{"name": "A", "anchors": [[1.0, 10.0]],
                           "coast_reach_deg": 2.0, "anchor_reach_deg": 6.0}]}
        carved, core = scenario(spec, [near, far], mono)
        zone = carved[0][2]
        self.assertFalse(zone.is_empty)
        self.assertTrue(core.intersects(far.buffer(0.5)),
                        "вода вокруг дальнего острова обязана остаться ядру")
        self.assertFalse(zone.intersects(far.buffer(0.5)),
                         "зона дотянулась до берега за пределами anchor_reach_deg")


class CrumbsTest(unittest.TestCase):
    """Крошка, выброшенная из зоны, обязана вернуться в ядро, а не пропасть."""

    def test_dropped_crumb_does_not_leave_a_hole(self):
        mono = box(0.0, 0.0, 20.0, 20.0)
        land = [box(-2.0, 0.0, 0.0, 12.0), box(-2.0, 19.0, 0.0, 20.0)]
        spec = {"zones": [{"name": "A", "anchors": [[1.0, 6.0], [1.0, 19.5]],
                           "coast_reach_deg": 1.5, "anchor_reach_deg": 20.0}]}

        carved, _ = scenario(spec, land, mono)
        raw = carved[0][2]
        self.assertGreater(len(getattr(raw, "geoms", [raw])), 1,
                           "фикстура обязана давать зону из нескольких частей")

        # порог между большой и малой частью — берётся из самой фикстуры,
        # а не хардкодится: изменится фикстура, изменится и порог
        sizes = sorted(area_km2(p) for p in raw.geoms)
        original = sos.MIN_PIECE_KM2
        sos.MIN_PIECE_KM2 = (sizes[0] + sizes[-1]) / 2.0
        try:
            carved, core = scenario(spec, land, mono)
            kept = carved[0][2]
            self.assertLess(area_km2(kept), area_km2(raw), "крошка обязана быть выброшена")
            lost, spill, overlap = coverage(mono, carved, core)
            self.assertAlmostEqual(lost, 0.0, places=3)
            self.assertAlmostEqual(overlap, 0.0, places=3)
        finally:
            sos.MIN_PIECE_KM2 = original


class SeamTest(unittest.TestCase):
    """Работа у линии перемены дат."""

    def setUp(self):
        self.mono = MultiPolygon([box(176.0, -5.0, 180.0, 5.0),
                                  box(-180.0, -5.0, -176.0, 5.0)])

    def test_wrap_makes_the_monolith_contiguous(self):
        wrapped = sos.wrap(self.mono, 20.0)
        self.assertEqual(wrapped.geom_type, "Polygon",
                         "в сдвинутой системе монолит обязан стать одним куском")

    def test_wrap_unwrap_returns_the_geometry(self):
        back = sos.unwrap(sos.wrap(self.mono, 20.0), 20.0)
        self.assertAlmostEqual(area_km2(back), area_km2(self.mono), places=3)
        self.assertGreaterEqual(back.bounds[0], -180.0)
        self.assertLessEqual(back.bounds[2], 180.0)

    def test_zone_across_the_date_line_is_one_feature_of_parts(self):
        land = [box(176.0, 5.0, 180.0, 6.0), box(-180.0, 5.0, -176.0, 6.0)]
        spec = {"wrap_lon": 20.0, "zones": [
            {"name": "A", "anchors": [[179.0, 4.0], [-179.0, 4.0]],
             "coast_reach_deg": 2.0, "anchor_reach_deg": 10.0}]}
        carved, _ = scenario(spec, land, self.mono)
        zone = carved[0][2]
        self.assertFalse(zone.is_empty)
        parts = list(getattr(zone, "geoms", [zone]))
        self.assertGreater(len(parts), 1, "зона у шва обязана быть из нескольких частей")
        self.assertTrue(any(p.bounds[0] < -170.0 for p in parts))
        self.assertTrue(any(p.bounds[2] > 170.0 for p in parts))

    def test_split_adds_no_boundary_along_the_date_line(self):
        """Разрез не имеет права провести НОВУЮ границу вдоль ±180."""
        land = [box(176.0, 5.0, 180.0, 6.0), box(-180.0, 5.0, -176.0, 6.0)]
        spec = {"wrap_lon": 20.0, "zones": [
            {"name": "A", "anchors": [[179.0, 4.0], [-179.0, 4.0]],
             "coast_reach_deg": 2.0, "anchor_reach_deg": 10.0}]}
        carved, core = scenario(spec, land, self.mono)
        before = sos.seam_boundary_length(self.mono)
        after = sum(sos.seam_boundary_length(g) for _, _, g in carved if not g.is_empty)
        after += sos.seam_boundary_length(core)
        self.assertAlmostEqual(after, before, places=6)


class IceFlagTest(unittest.TestCase):
    def test_polar_water_is_ice(self):
        self.assertTrue(sos.ice_flag(box(-20.0, 70.0, 20.0, 80.0)))
        self.assertTrue(sos.ice_flag(box(-20.0, -75.0, 20.0, -65.0)))

    def test_tropical_water_is_not_ice(self):
        self.assertFalse(sos.ice_flag(box(-20.0, -10.0, 20.0, 10.0)))

    def test_threshold_is_a_share_not_a_touch(self):
        """Зона, лишь краем заходящая за круг, ледовой не считается."""
        self.assertFalse(sos.ice_flag(box(-20.0, 40.0, 20.0, 68.0)))


class ZoneTypeTest(unittest.TestCase):
    def test_declared_type_wins(self):
        self.assertEqual(sos.zone_type("Grand Banks", "shelf"), "shelf")

    def test_ocean_by_name_when_not_declared(self):
        self.assertEqual(sos.zone_type("North Atlantic Ocean", None), "open_ocean")

    def test_everything_else_is_enclosed(self):
        self.assertEqual(sos.zone_type("Baltic Sea", None), "enclosed")


if __name__ == "__main__":
    unittest.main()
