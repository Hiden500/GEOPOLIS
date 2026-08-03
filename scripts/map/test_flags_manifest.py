"""Проверки манифеста флагов 1946 — свойства конфига, без обращения к сети.

Существование файлов на Commons проверяет сам build_flags_manifest.py при
сетевом прогоне: это внешнее состояние, и тест, зависящий от чужого сервиса,
краснел бы от чужих проблем. Здесь проверяется то, что обязано быть верным
всегда: покрытие фактического состава сценария, отсутствие сирот и заполненность
полей, на которые опирается импорт.
"""
import json
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
