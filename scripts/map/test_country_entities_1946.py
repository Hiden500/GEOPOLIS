"""Targeted checks for curated 1946 country/dependent-territory ownership."""
import unittest

from generate_country_registry import (
    CONFIG_DIR,
    CUSTOM_COUNTRIES,
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
        cls.preserve, cls.owner_overrides, cls.subject_overrides = load_entity_config(cls.catalog)
        cls.merge_map = build_merge_map(cls.catalog, cls.preserve, cls.owner_overrides)

    def test_south_america_entities_are_not_legacy_merged(self):
        self.assertTrue({"GUY", "SUR", "GUF", "FLK"}.issubset(self.preserve))
        for code in ("GUY", "SUR", "GUF", "FLK"):
            self.assertNotIn(code, self.merge_map)

    def test_falkland_dependencies_use_falkland_owner(self):
        self.assertEqual(self.owner_overrides["SGS"], "FLK")
        self.assertEqual(self.merge_map["SGS"], "FLK")

    def test_north_american_entities_use_1946_administrations(self):
        separate = {"BHS", "BLZ", "BMU", "BRB", "JAM", "NFD", "PRI", "SPM", "TTO", "VIR"}
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        expected_overrides = {
            "ATG": "QWL", "AIA": "QWL", "KNA": "QWL", "MSR": "QWL", "VGB": "QWL",
            "DMA": "QWW", "GRD": "QWW", "LCA": "QWW", "VCT": "QWW",
            "CYM": "JAM", "TCA": "JAM",
            "ABW": "QND", "CUW": "QND", "SXM": "QND",
        }
        for source, target in expected_overrides.items():
            self.assertEqual(self.owner_overrides[source], target)
            self.assertEqual(self.merge_map[source], target)

        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_overrides = {
            entry["regionId"]: entry["to"]
            for entry in config["continents"]["north_america_caribbean"]["regionOwnerOverrides"]
        }
        self.assertEqual(region_overrides["NAM-0001"], "MTQ")
        self.assertEqual(region_overrides["NAM-0002"], "GLP")
        for region_id in ("NAM-0003", "NAM-0004", "NAM-0005"):
            self.assertEqual(region_overrides[region_id], "QND")

    def test_all_curated_codes_exist_in_catalog(self):
        for code in self.preserve:
            self.assertIn(code, self.catalog)
        for source, target in self.owner_overrides.items():
            self.assertIn(source, self.catalog)
            self.assertTrue(target in self.catalog or target in CUSTOM_COUNTRIES)

    def test_every_curated_owner_has_population_anchor(self):
        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_targets = {
            entry["to"]
            for section in config["continents"].values()
            for entry in section.get("regionOwnerOverrides", [])
        }
        for code in self.preserve | set(self.owner_overrides.values()) | region_targets:
            self.assertIn(code, COUNTRY_POPULATION_1946)

    def test_norfolk_island_does_not_share_newfoundland_code(self):
        overlay = load_json(CONFIG_DIR / "occupation_overlay.json")
        self.assertEqual(overlay["OCE-0008"], "AUS")

    def test_european_territories_are_not_legacy_merged(self):
        for code in ("CYP", "GIB", "MLT"):
            self.assertIn(code, self.preserve)
            self.assertNotIn(code, self.merge_map)

    def test_african_entities_use_1946_administrations(self):
        separate = {
            "GHA", "GMB", "KEN", "MUS", "NGA", "SHN", "SLE", "SYC", "ZMB", "ZWE",
            "AGO", "CPV", "GNB", "MOZ", "STP", "ESH", "GNQ", "DZA", "DJI", "MDG",
        }
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        expected = {
            "BEN": "QFW", "BFA": "QFW", "CIV": "QFW", "GIN": "QFW",
            "MLI": "QFW", "MRT": "QFW", "NER": "QFW", "SEN": "QFW",
            "CAF": "QFE", "COG": "QFE", "GAB": "QFE", "TCD": "QFE",
            "COM": "MDG", "IOT": "MUS", "RWA": "QRU", "BDI": "QRU",
        }
        for source, target in expected.items():
            self.assertEqual(self.owner_overrides[source], target)
            self.assertEqual(self.merge_map[source], target)

        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_overrides = {
            entry["regionId"]: entry["to"]
            for entry in config["continents"]["africa"]["regionOwnerOverrides"]
        }
        self.assertEqual(region_overrides, {"AFR-0001": "REU", "AFR-0002": "MDG"})
        self.assertIn("REU", COUNTRY_POPULATION_1946)

    def test_asian_entities_use_1946_administrations(self):
        separate = {"HKG", "IND", "LKA", "MMR", "MYS", "SGP", "VNM", "IDN", "MAC", "TLS"}
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        self.assertEqual(self.owner_overrides["ARE"], "QAB")
        self.assertEqual(self.subject_overrides, {"JOR": "GBR", "PHL": "USA"})

        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_overrides = {
            entry["regionId"]: entry["to"]
            for entry in config["continents"]["asia"]["regionOwnerOverrides"]
        }
        expected = {
            "ASI-0041": "QTB", "ASI-0119": "QSI", "ASI-0139": "QPI",
            "ASI-0142": "QFI", "ASI-0263": "QNB", "ASI-0264": "QSR",
            "ASI-0266": "QLB", "ASI-0377": "QDV", "ASI-0110": "QRI",
            "ASI-0051": "QSH", "ASI-0052": "QRK", "ASI-0054": "QUQ",
            "ASI-0055": "QAJ", "ASI-0056": "QFU", "ASI-0057": "QDU",
            "ASI-0400": "QAD", "ASI-0196": "THA", "ASI-0197": "THA",
            "ASI-0050": "VNM",
        }
        for region_id, target in expected.items():
            self.assertEqual(region_overrides[region_id], target)
        for region_id in ("ASI-0049", "ASI-0117", "ASI-0132", "ASI-0291", "ASI-0297"):
            self.assertEqual(region_overrides[region_id], "QJK")


if __name__ == "__main__":
    unittest.main()
