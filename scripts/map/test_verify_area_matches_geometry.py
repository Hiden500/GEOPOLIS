#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_verify_area_matches_geometry.py — тесты сверки `area_km2` с геометрией.

Проверяется СВОЙСТВО, а не снимок: ни один тест не знает, сколько сегодня фич
в мастере, какие region_id живые и чему равна площадь конкретного региона.
Каждый тест строит полигон, объявляет площадь так-то и требует от проверки
названного результата.

Отдельно закреплены ОБА края допуска, потому что оба были решением, а не
умолчанием:

  - округление до 0,1 у мелкой фичи проходить ОБЯЗАНО (иначе гейт красный с
    первого дня: четыре островных региона мастера расходятся с геометрией на
    1–15% относительно, укладываясь в те же 0,05 км² абсолютно);
  - процентный сдвиг у КРУПНОЙ фичи падать ОБЯЗАН. Это тест против соблазна
    добавить относительное слагаемое: с порогом `max(0.06, 0.1% * S)` сдвиг в
    195 км² у области размером со Свердловскую прошёл бы молча.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))

from shapely.geometry import box, mapping  # noqa: E402

from geometry_cleanup import area_km2  # noqa: E402
from verify_area_matches_geometry import (  # noqa: E402
    TOLERANCE_KM2, check, measure,
)


def patch(west, south, size_deg):
    """Полигон-прямоугольник в градусах. Настоящая площадь считается той же
    геодезической функцией, что и в проверке, — тест не воспроизводит формулу."""
    return box(west, south, west + size_deg, south + size_deg)


def feature(geom, declared, region_id="EUR-0001", name="Testland"):
    props = {"region_id": region_id, "name": name}
    if declared is not None:
        props["area_km2"] = declared
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def rounded(geom):
    """Так площадь пишут билдеры: round(area_km2(g), 1)."""
    return round(area_km2(geom), 1)


def joined(errors):
    return " | ".join(errors) or "<ошибок нет>"


class AreaMatchesGeometry(unittest.TestCase):
    def test_declared_as_builders_write_it_passes(self):
        g = patch(10.0, 45.0, 1.0)          # ~8600 км²
        rows, read_errors = measure([feature(g, rounded(g))])
        self.assertEqual(read_errors, [])
        self.assertEqual(check(rows), [])

    def test_shifted_area_is_named_with_both_numbers(self):
        g = patch(10.0, 45.0, 1.0)
        declared = rounded(g) + 5.0
        rows, _ = measure([feature(g, declared, region_id="ASI-0042", name="Сдвинутый")])
        errors = check(rows)
        self.assertEqual(len(errors), 1, joined(errors))
        self.assertIn("ASI-0042", errors[0])
        self.assertIn("Сдвинутый", errors[0])
        self.assertIn(f"{declared:,.4f}", errors[0])          # заявленное
        self.assertIn(f"{area_km2(g):,.4f}", errors[0])       # пересчитанное

    def test_rounding_of_tiny_island_passes(self):
        """Мелкая фича: 0,05 км² округления — это проценты от площади.
        Абсолютный допуск обязан её пропустить."""
        g = patch(150.0, -16.0, 0.0035)     # ~0,15 км²
        actual = area_km2(g)
        declared = round(actual, 1)
        rows, _ = measure([feature(g, declared, region_id="OCE-0999", name="Островок")])
        self.assertGreater(rows[0]["rel"], 0.05,
                           "фикстура должна расходиться относительно, иначе тест пуст")
        self.assertLessEqual(rows[0]["diff"], TOLERANCE_KM2)
        self.assertEqual(check(rows), [])

    def test_percentage_shift_on_large_region_fails(self):
        """Негативный контроль решения «допуск только абсолютный»: 0,1% от
        крупной области — сотни км², и это обязано падать."""
        g = patch(60.0, 57.0, 1.5)          # ~19 000 км²
        actual = area_km2(g)
        self.assertGreater(actual * 0.001, TOLERANCE_KM2,
                           "фикстура должна быть достаточно крупной")
        rows, _ = measure([feature(g, round(actual * 1.001, 1))])
        self.assertTrue(check(rows), "процентный сдвиг у крупной фичи прошёл молча")

    def test_shift_just_over_tolerance_fails(self):
        g = patch(10.0, 45.0, 1.0)
        rows, _ = measure([feature(g, area_km2(g) + TOLERANCE_KM2 * 1.5)])
        self.assertTrue(check(rows), joined(check(rows)))

    def test_shift_within_rounding_half_step_passes(self):
        g = patch(10.0, 45.0, 1.0)
        rows, _ = measure([feature(g, area_km2(g) - 0.05)])
        self.assertEqual(check(rows), [])

    def test_missing_area_is_named(self):
        g = patch(10.0, 45.0, 1.0)
        rows, read_errors = measure([feature(g, None, region_id="EUR-0777")])
        self.assertEqual(rows, [])
        self.assertTrue(any("EUR-0777" in e and "area_km2" in e for e in read_errors),
                        joined(read_errors))

    def test_non_numeric_area_is_named(self):
        g = patch(10.0, 45.0, 1.0)
        rows, read_errors = measure([feature(g, "8600")])
        self.assertEqual(rows, [])
        self.assertTrue(any("не число" in e for e in read_errors), joined(read_errors))

    def test_boolean_is_not_accepted_as_number(self):
        g = patch(10.0, 45.0, 1.0)
        _, read_errors = measure([feature(g, True)])
        self.assertTrue(any("не число" in e for e in read_errors), joined(read_errors))

    def test_every_offender_is_listed_not_just_the_first(self):
        a = patch(10.0, 45.0, 1.0)
        b = patch(20.0, 45.0, 1.0)
        rows, _ = measure([feature(a, rounded(a) + 5.0, region_id="EUR-0001"),
                           feature(b, rounded(b) + 9.0, region_id="EUR-0002")])
        errors = check(rows)
        self.assertEqual(len(errors), 2, joined(errors))
        self.assertIn("EUR-0002", errors[0], "самое крупное расхождение печатается первым")


if __name__ == "__main__":
    unittest.main(verbosity=2)
