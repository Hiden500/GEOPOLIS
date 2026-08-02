#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тесты общих правил смежности (`build/adjacency.py`).

Синтетические фикстуры, не завязанные на данные 1946: проверяется свойство —
«фигуры по разные стороны ±180 смежны, если физически касаются, и не смежны,
если между ними вода», — а не конкретный список рёбер, который изменит
следующая пересборка.

Негативный контроль. Тесты, утверждающие НАЛИЧИЕ шовной смежности, обязаны
падать на старом поведении, где особого случая ±180 не было вовсе. Тесты,
утверждающие её отсутствие, на заглушке проходят — это нормально: они стерегут
обратную ошибку («сдвиг соединил всё со всем»), и негативным контролем для них
служит не заглушка, а `test_open_water_...` против чрезмерного порога.

Восстановить старое поведение, не трогая файлов (из корня репозитория):

    python -c "import sys, unittest, importlib.util; from unittest import mock; \
        sys.path.insert(0, 'scripts/map/build'); import adjacency; \
        s=importlib.util.spec_from_file_location('t','scripts/map/test_adjacency.py'); \
        m=importlib.util.module_from_spec(s); s.loader.exec_module(m); \
        mock.patch.object(adjacency,'seam_pairs',lambda *a,**k: []).start(); \
        unittest.main(module=m, argv=['x'], exit=False)"

Запуск: python scripts/map/test_adjacency.py
(stdlib unittest — без новых зависимостей)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))
from shapely.geometry import box, MultiPolygon

import adjacency

BUFFER_DEG = 0.01  # тот же рабочий буфер, что у строителей графов


def buffered(*geoms):
    return [g.buffer(BUFFER_DEG) for g in geoms]


class SeamAdjacencyTest(unittest.TestCase):
    def test_plain_intersection_cannot_see_across_the_date_line(self):
        """Контрольный замер: без особого случая шва смежности НЕ видно.

        Это не проверка кода, а фиксация причины, по которой особый случай
        вообще нужен: буфер в 0.01° против разрыва в 359.98°.
        """
        west, east = buffered(box(-180.0, 0.0, -179.5, 1.0),
                              box(179.5, 0.0, 180.0, 1.0))
        self.assertFalse(west.intersects(east))

    def test_touching_pair_across_the_date_line_is_adjacent(self):
        """Две фигуры, сходящиеся НА линии дат, — соседи."""
        geoms = buffered(box(-180.0, 0.0, -179.5, 1.0),
                         box(179.5, 0.0, 180.0, 1.0))
        self.assertEqual(adjacency.seam_pairs(geoms), [(0, 1)])

    def test_open_water_across_the_date_line_is_not_adjacency(self):
        """Разрыв в градус остаётся разрывом — сдвиг не соединяет всё со всем.

        Ровно та ошибка, которой шовный случай мог бы обернуться: перенос
        фигуры на +360° не должен превращаться в «буфер шириной в океан».
        """
        geoms = buffered(box(-179.5, 0.0, -179.0, 1.0),
                         box(179.0, 0.0, 179.5, 1.0))
        self.assertEqual(adjacency.seam_pairs(geoms), [])

    def test_same_feature_on_both_sides_is_not_its_own_neighbour(self):
        """Фича из частей по обе стороны шва — одна фича, а не пара соседей."""
        both = MultiPolygon([box(-180.0, 0.0, -179.5, 1.0),
                             box(179.5, 0.0, 180.0, 1.0)])
        self.assertEqual(adjacency.seam_pairs(buffered(both)), [])

    def test_far_from_the_seam_pairs_are_ignored(self):
        """Смежные, но не у шва, — забота основного прохода, не шовного."""
        geoms = buffered(box(0.0, 0.0, 1.0, 1.0), box(1.0, 0.0, 2.0, 1.0))
        self.assertEqual(adjacency.seam_pairs(geoms), [])

    def test_pairs_are_index_ordered_and_deduplicated(self):
        """Пара отдаётся один раз и в возрастающем порядке индексов.

        Иначе одно и то же ребро приходило бы дважды и в разном порядке от
        запуска к запуску — счётчик рёбер стал бы недетерминированным.
        """
        geoms = buffered(box(179.5, 0.0, 180.0, 1.0),
                         box(-180.0, 0.0, -179.5, 1.0),
                         box(-180.0, 0.5, -179.5, 2.0))
        pairs = adjacency.seam_pairs(geoms)
        self.assertTrue(pairs, "фикстура обязана давать хотя бы одну пару")
        self.assertEqual(pairs, sorted(set(pairs)))
        for i, j in pairs:
            self.assertLess(i, j)


class RealTouchTest(unittest.TestCase):
    def test_shared_edge_is_a_border(self):
        a, b = box(0.0, 0.0, 1.0, 1.0), box(1.0, 0.0, 2.0, 1.0)
        self.assertTrue(adjacency.real_touch(a.intersection(b)))

    def test_single_point_contact_is_not_a_border(self):
        """Диагональное касание углом границей не считается."""
        a, b = box(0.0, 0.0, 1.0, 1.0), box(1.0, 1.0, 2.0, 2.0)
        self.assertFalse(adjacency.real_touch(a.intersection(b)))

    def test_empty_intersection_is_not_a_border(self):
        a, b = box(0.0, 0.0, 1.0, 1.0), box(5.0, 5.0, 6.0, 6.0)
        self.assertFalse(adjacency.real_touch(a.intersection(b)))


if __name__ == "__main__":
    unittest.main()
