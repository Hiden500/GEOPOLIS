"""Проверки манифеста флагов 1946 — свойства конфига, без обращения к сети.

Существование файлов на Commons проверяет сам build_flags_manifest.py при
сетевом прогоне: это внешнее состояние, и тест, зависящий от чужого сервиса,
краснел бы от чужих проблем. Здесь проверяется то, что обязано быть верным
всегда: покрытие фактического состава сценария, отсутствие сирот и заполненность
полей, на которые опирается импорт.
"""
import json
import unittest
import xml.etree.ElementTree as ElementTree
from pathlib import Path

from fetch_flags import BOX_H, BOX_W, normalize, sanitize, unsafe_reason

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "flags_1946.json"
COUNTRIES = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "countries.json"

CONFIDENCE_LEVELS = {"high", "medium", "low"}


def load_json(path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


class FlagsManifest1946Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = load_json(CONFIG)
        cls.flags = cls.config["flags"]
        cls.custom = cls.config["custom"]
        cls.codes = {c["id"] for c in load_json(COUNTRIES)}

    def test_every_scenario_country_has_an_entry(self):
        """Страна без записи о флаге — дыра в HUD, которую видно только в игре.

        Список кодов берётся из состава сценария, а не из константы: пайплайн
        меняет состав, и манифест обязан следовать за ним.
        """
        missing = sorted(self.codes - set(self.flags) - set(self.custom))
        self.assertEqual(missing, [], f"страны без записи о флаге: {missing}")

    def test_no_entries_for_countries_outside_the_scenario(self):
        """Сирота молча переживает удаление страны и выглядит как покрытие."""
        orphans = sorted((set(self.flags) | set(self.custom)) - self.codes)
        self.assertEqual(orphans, [], f"записи без страны в сценарии: {orphans}")

    def test_file_and_custom_are_mutually_exclusive(self):
        """Код в обеих секциях означает два разных ответа на один вопрос."""
        both = sorted(set(self.flags) & set(self.custom))
        self.assertEqual(both, [], f"код и с файлом, и в custom: {both}")

    def test_every_flag_entry_carries_file_source_and_confidence(self):
        """Запись без source неотличима от догадки (scripts/map/AGENTS.md)."""
        for code, entry in sorted(self.flags.items()):
            with self.subTest(code=code):
                self.assertTrue(entry.get("file", "").endswith(".svg"))
                self.assertTrue(entry.get("source"))
                self.assertIn(entry.get("confidence"), CONFIDENCE_LEVELS)

    def test_every_custom_entry_explains_itself_and_names_a_basis(self):
        """custom — это заказ на работу художника: без причины и исторической
        основы он превращается в «нарисуй что-нибудь»."""
        for code, entry in sorted(self.custom.items()):
            with self.subTest(code=code):
                self.assertTrue(entry.get("reason"))
                self.assertTrue(entry.get("basis", "").endswith(".svg"))
                self.assertIn("territory", entry)

    def test_occupation_zones_of_one_territory_do_not_share_a_flag_silently(self):
        """Зоны одной территории обязаны различаться в интерфейсе.

        Историческая правда в том, что своих флагов у зон не было, и basis у
        четырёх зон Германии общий — поэтому каждая зона обязана называть
        державу-администратора: именно она различает их в дизайне. Молча
        одинаковые записи дали бы четыре неотличимых флага в HUD.
        """
        by_territory = {}
        for code, entry in self.custom.items():
            if entry.get("occupier"):
                by_territory.setdefault(entry["territory"], []).append(entry["occupier"])
        for territory, occupiers in sorted(by_territory.items()):
            with self.subTest(territory=territory):
                self.assertEqual(len(occupiers), len(set(occupiers)),
                                 f"{territory}: у зон совпадает держава-администратор")


class FlagNormalizationTest(unittest.TestCase):
    """Проверки нормализатора из fetch_flags.py.

    Каждая из них закрывает дефект, который РЕАЛЬНО случился на живом наборе и
    которого не видел ни один формальный признак: файл записывался, был
    валидным и весил сколько положено.
    """

    def test_root_presentation_attributes_reach_the_content(self):
        """Заливка, объявленная один раз на корне, наследуется фигурами.

        Флаг Гондураса задаёт `fill` на корневом теге; отбросив корень, набор
        получил чёрно-белый флаг вместо синего — валидный и правильного веса.
        """
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="36" '
               'viewBox="0 0 72 36" fill="#0d3b99"><rect width="72" height="12"/></svg>')
        out, _ = normalize(svg)
        self.assertIn('fill="#0d3b99"', out)

    def test_namespace_declarations_reach_the_content(self):
        """Префикс, объявленный на корне и использованный в теле, обязан выжить.

        Иначе документ перестаёт быть валидным XML и браузер показывает пустоту
        — так первый прогон потерял 26 флагов из 145.
        """
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" '
               'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/s.dtd" '
               'width="60" height="40" viewBox="0 0 60 40">'
               '<rect sodipodi:role="line" width="60" height="40"/></svg>')
        out, _ = normalize(svg)
        ElementTree.fromstring(out)  # разбор и есть проверка

    def test_scientific_notation_in_dimensions(self):
        """`width="1e3"` — законная запись; наивный парсер читает её как «1».

        На флаге Коста-Рики это дало пропорцию 0,0017 вместо 1,67.
        """
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1e3" height="600"><rect/></svg>'
        _, ratio = normalize(svg)
        self.assertAlmostEqual(ratio, 1.6667, places=3)

    def test_ratio_disagreeing_with_independent_source_is_rejected(self):
        """Расхождение с метаданными Commons — отказ, а не тихая запись."""
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect/></svg>'
        with self.assertRaises(ValueError):
            normalize(svg, expected_ratio=1.0)

    def test_frame_not_viewbox_defines_flag_shape(self):
        """Форму задаёт кадр width/height, а не viewBox.

        У лаосского флага кадр 3:2 при квадратном viewBox — если считать по
        viewBox, флаг получает поля, которых у него нет.
        """
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" '
               'viewBox="0 0 250 250"><rect/></svg>')
        _, ratio = normalize(svg)
        self.assertAlmostEqual(ratio, 1.5, places=3)

    def test_output_always_carries_the_common_box(self):
        for width, height in ((1000, 500), (300, 200), (100, 125)):
            with self.subTest(size=(width, height)):
                svg = (f'<svg xmlns="http://www.w3.org/2000/svg" '
                       f'width="{width}" height="{height}"><rect/></svg>')
                out, _ = normalize(svg)
                root = ElementTree.fromstring(out)
                self.assertEqual(root.get("viewBox"), f"0 0 {BOX_W} {BOX_H}")

    def test_empty_illustrator_stub_passes_but_real_foreign_object_does_not(self):
        """Граница санитайзера — обе половины сразу.

        Пустая самозакрывающаяся заглушка Illustrator исполнить нечего, и она
        удаляется. foreignObject С ТЕЛОМ — чужая разметка внутри картинки — и
        дальше приводит к отказу; иначе это было бы ослаблением проверки.
        """
        stub = '<svg xmlns="http://www.w3.org/2000/svg"><defs><foreignObject id="x" /></defs></svg>'
        self.assertIsNone(unsafe_reason(sanitize(stub)))

        real = ('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>'
                '<body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject></svg>')
        self.assertIsNotNone(unsafe_reason(sanitize(real)))

    def test_active_content_is_rejected(self):
        for hostile in ('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                        '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="x()"/></svg>',
                        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://e.com/a.png"/></svg>'):
            with self.subTest(svg=hostile[:60]):
                self.assertIsNotNone(unsafe_reason(sanitize(hostile)))


if __name__ == "__main__":
    unittest.main()
