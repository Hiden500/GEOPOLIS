#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест инварианта «линия раздела двух акваторий — линия, а не пила».

Держит две вещи, которые легко потерять по отдельности:

  1. `geo_partition.straighten_seams` действительно убирает лестницу с
     внутреннего шва и при этом НЕ двигает внешнюю границу области — на
     синтетической фикстуре, где известен правильный ответ;
  2. водный слой ЖИВОГО мастера этому инварианту удовлетворяет. Фикстура
     доказывает, что функция считает; что вход живой — только прогон на
     реальных данных.

НЕГАТИВНЫЙ КОНТРОЛЬ встроен: `test_lestnica_bez_vypryamleniya_padaet`
проверяет ту же фикстуру ДО выпрямления и требует, чтобы порог был превышен.
Замените `straighten_seams` на тождество — и тест на выпрямление упадёт, а
контроль останется зелёным; это и означает, что порог достижим не сам собой.

Ловушка метрики зафиксирована отдельным тестом: доля отрезков «по осям»
объявляет НАКЛОНЁННУЮ лестницу чистой, а доля поворотов ~90° — нет. Именно на
этом уже спотыкались (см. `crookedness` в `diagnose_seas_iho.py`).

Запуск: python scripts/map/test_straighten_sea_zone_seams.py
(stdlib unittest — без новых зависимостей)
"""
import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))

from shapely.geometry import LineString, Point, Polygon, box, shape  # noqa: E402
from shapely.ops import split  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from diagnose_seas_iho import (STAIR_ANGLE_HI, STAIR_ANGLE_LO, STAIR_WARN,
                               right_angle_share)  # noqa: E402
from geo_partition import ring_vertices, straighten_seams  # noqa: E402
from paths import world_geojson  # noqa: E402


def staircase_line(steps=40, start=(-3.5, -7.0), a=0.25, b=0.14):
    """НАКЛОНЁННАЯ лестница как ломаная.

    Наклон обязателен, и это не украшение фикстуры. Ступеньки реального
    прототипа нарезаны в проекции и перепроецированы в градусы, поэтому строго
    по осям не идут: замер на SEA-0099 — пары шагов `dx=0.047090 /
    dy=0.017054`, повторённые ровно 40 раз, и ни одна координата не ноль.
    Осевая фикстура проверяла бы задачу заведомо легче настоящей — и пропустила
    бы ту самую ложную метрику, которую этот файл держит контрпримером.

    Шаг задан парой ВЗАИМНО ПЕРПЕНДИКУЛЯРНЫХ векторов (a, b) и (-b, a): поворот
    между ними ровно 90°, а сумма (a-b, a+b) — направление настоящей линии
    раздела.
    """
    x, y = start
    pts = [(x, y)]
    for _ in range(steps):
        x, y = x + a, y + b
        pts.append((x, y))
        x, y = x - b, y + a
        pts.append((x, y))
    return LineString(pts)


def coast_disc(n=120, radius=5.0, wobble=0.02):
    """«Берег»: окружность с детерминированной неровностью.

    Ровный квадрат в роли области не годится: после выпрямления от полигона
    остаются одни его прямые углы, и доля поворотов ~90° равна единице на
    БЕЗУПРЕЧНОЙ геометрии. Это не придирка к фикстуре — ровно этим метрика
    ограничена и на живых данных (у зоны с 77 вершинами три угла линии
    делимитации дают 4%), и фикстура обязана воспроизводить условия, в которых
    метрика осмысленна: настоящая зона окружена берегом с сотнями мелких
    поворотов.
    """
    pts = []
    for i in range(n):
        t = 2.0 * math.pi * i / n
        r = radius * (1.0 + wobble * math.sin(7.0 * t))
        pts.append((r * math.cos(t), r * math.sin(t)))
    return Polygon(pts)


def staircase_pair():
    """Диск с берегом, разрезанный наклонённой лестницей на две части."""
    disc = coast_disc()
    seam = staircase_line()
    pieces = [p for p in split(disc, seam).geoms if p.area > 0]
    assert len(pieces) == 2, f"фикстура: разрез дал {len(pieces)} частей"
    return pieces[0], pieces[1]


def axis_parallel_share(line):
    """ЛОЖНАЯ метрика: доля отрезков ломаной строго по осям. Держится тестом
    как контрпример, чтобы её не завели заново."""
    pts = list(line.coords)
    n = hits = 0
    for a, b in zip(pts, pts[1:]):
        n += 1
        if a[0] == b[0] or a[1] == b[1]:
            hits += 1
    return hits / n if n else 0.0


class MetricTest(unittest.TestCase):
    def test_vershiny_na_pryamoy_ne_schitayutsya(self):
        """Вершина, лежащая на прямой, поворота не даёт — иначе метрика
        считала бы плотность оцифровки, а не форму линии."""
        dense = Polygon([(x / 10.0, 0.0) for x in range(101)]
                        + [(10.0, 1.0), (0.0, 1.0)])
        share, n = right_angle_share(dense)
        self.assertGreater(n, 100)
        self.assertLess(share, STAIR_WARN)

    def test_lozhnaya_metrika_ne_vidit_naklonyonnoy_lestnicy(self):
        """Доля отрезков «по осям» объявляет наклонённую лестницу чистой."""
        seam = staircase_line()
        self.assertEqual(axis_parallel_share(seam), 0.0,
                         "фикстура обязана быть наклонённой, иначе она не"
                         " воспроизводит настоящий дефект")
        left, _ = staircase_pair()
        share, _ = right_angle_share(left)
        self.assertGreater(share, STAIR_WARN,
                           "метрика поворотов обязана видеть то, чего не видит"
                           " метрика осей")

    def test_koridor_ugla_zadan_vokrug_90(self):
        self.assertLess(STAIR_ANGLE_LO, 90.0)
        self.assertGreater(STAIR_ANGLE_HI, 90.0)


class StraightenTest(unittest.TestCase):
    def setUp(self):
        self.left, self.right = staircase_pair()
        self.U = unary_union([self.left, self.right])

    def test_lestnica_bez_vypryamleniya_padaet(self):
        """НЕГАТИВНЫЙ КОНТРОЛЬ: до выпрямления порог заведомо превышен."""
        for g in (self.left, self.right):
            share, _ = right_angle_share(g)
            self.assertGreaterEqual(share, STAIR_WARN)

    def test_vypryamlenie_ubiraet_lestnicu(self):
        new = straighten_seams([self.left, self.right], U=self.U,
                               tol=0.5, log=lambda *a: None)
        for g in new:
            share, _ = right_angle_share(g)
            self.assertLess(share, STAIR_WARN)

    def test_vneshnyaya_granica_ne_sdvinulas(self):
        """Ни одной новой вершины на границе области — это и есть условие,
        при котором соседи сохраняют общие рёбра."""
        new = straighten_seams([self.left, self.right], U=self.U,
                               tol=0.5, log=lambda *a: None)
        known = ring_vertices(self.U)
        for g in new:
            on_boundary = {v for v in ring_vertices(g)
                           if self.U.boundary.distance(_point(v)) < 1e-12}
            self.assertTrue(on_boundary <= known,
                            f"новые вершины на границе: {on_boundary - known}")

    def test_ploshchad_sohranyaetsya(self):
        new = straighten_seams([self.left, self.right], U=self.U,
                               tol=0.5, log=lambda *a: None)
        self.assertAlmostEqual(sum(g.area for g in new), self.U.area, places=9)
        self.assertAlmostEqual(unary_union(new).difference(self.U).area, 0.0,
                               places=9)
        self.assertAlmostEqual(self.U.difference(unary_union(new)).area, 0.0,
                               places=9)

    def test_vershin_stalo_menshe(self):
        new = straighten_seams([self.left, self.right], U=self.U,
                               tol=0.5, log=lambda *a: None)
        before = sum(len(ring_vertices(g)) for g in (self.left, self.right))
        after = sum(len(ring_vertices(g)) for g in new)
        self.assertLess(after, before)

    def test_shov_ne_spryamlyaetsya_skvoz_ostrov(self):
        """Гарантия важнее косметики: упрощение, уводящее шов ЗА область
        (в дырку-остров), отвергается — область остаётся целой.

        Без этого правила выпрямление «улучшило» бы шов, проведя его прямо по
        суше, и остров перестал бы быть дыркой.
        """
        island = box(4.0, 4.0, 6.0, 6.0)
        U = box(0.0, 0.0, 10.0, 10.0).difference(island)
        # Шов идёт слева направо, ОБХОДЯ остров сверху, и обход — лестница.
        pts = [(0.0, 5.0), (3.0, 5.0)]
        x = 3.0
        for i in range(8):
            x += 0.5
            pts.append((x, 5.0 + 0.25 * (i + 1) if i < 4 else 7.0))
        pts += [(7.0, 7.0), (7.0, 5.0), (10.0, 5.0)]
        seam = LineString(pts)
        pieces = [p for p in split(U, seam).geoms if p.area > 0]
        self.assertEqual(len(pieces), 2, "фикстура: шов обязан рассечь область")

        new = straighten_seams(list(pieces), U=U, tol=5.0, log=lambda *a: None)
        self.assertAlmostEqual(unary_union(new).symmetric_difference(U).area,
                               0.0, places=9,
                               msg="выпрямление съело дырку-остров")
        self.assertAlmostEqual(island.intersection(unary_union(new)).area, 0.0,
                               places=9, msg="шов прошёл по острову")


class LiveMasterTest(unittest.TestCase):
    """Живые данные: тот же инвариант по мастеру.

    Порог `STAIR_WARN` берётся из кода, а не переписан числом: сдвинут порог —
    сдвинулся и тест. Зоны ищутся по свойству (`ocean` — признак партии,
    внедрённой `apply_sea_zones.py`), а не по списку `region_id`: список
    протух бы при первом же сдвиге нумерации.
    """

    @classmethod
    def setUpClass(cls):
        path = world_geojson()
        cls.feats = json.loads(path.read_text(encoding="utf-8"))["features"]

    def test_okeanskie_zony_ne_lestnichnye(self):
        bad = []
        for f in self.feats:
            p = f["properties"]
            if p.get("region_type") != "sea" or p.get("ocean") is None:
                continue
            share, n = right_angle_share(shape(f["geometry"]))
            if share >= STAIR_WARN:
                bad.append(f"{p['region_id']} {p.get('name')}: "
                           f"{share * 100:.1f}% из {n} вершин")
        self.assertEqual(bad, [], "лестничные зоны в мастере:\n  "
                                  + "\n  ".join(bad))

    def test_zony_v_mastere_voobshche_est(self):
        """Пустой отбор сделал бы предыдущий тест зелёным ни на чём."""
        zones = [f for f in self.feats
                 if f["properties"].get("region_type") == "sea"
                 and f["properties"].get("ocean") is not None]
        self.assertGreater(len(zones), 50)


def _point(xy):
    return Point(xy)


if __name__ == "__main__":
    unittest.main(verbosity=2)
