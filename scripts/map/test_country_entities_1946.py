"""Targeted checks for curated 1946 country/dependent-territory ownership."""
import unittest

from generate_country_registry import (
    OUT_DIR,
    build_merge_map,
    load_entity_config,
    load_json,
)
from economy_1946.anchors import COUNTRY_POPULATION_1946


class CountryEntities1946Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_json(OUT_DIR / "countries_1946.json")
        cls.preserve, cls.owner_overrides = load_entity_config(cls.catalog)
        cls.merge_map = build_merge_map(cls.catalog, cls.preserve, cls.owner_overrides)

    def test_south_america_entities_are_not_legacy_merged(self):
        self.assertTrue({"GUY", "SUR", "GUF", "FLK"}.issubset(self.preserve))
        for code in ("GUY", "SUR", "GUF", "FLK"):
            self.assertNotIn(code, self.merge_map)

    def test_falkland_dependencies_use_falkland_owner(self):
        self.assertEqual(self.owner_overrides["SGS"], "FLK")
        self.assertEqual(self.merge_map["SGS"], "FLK")

    def test_all_curated_codes_exist_in_catalog(self):
        for code in self.preserve:
            self.assertIn(code, self.catalog)
        for source, target in self.owner_overrides.items():
            self.assertIn(source, self.catalog)
            self.assertIn(target, self.catalog)

    def test_every_preserved_entity_has_population_anchor(self):
        for code in self.preserve:
            self.assertIn(code, COUNTRY_POPULATION_1946)


if __name__ == "__main__":
    unittest.main()
