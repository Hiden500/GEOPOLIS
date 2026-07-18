"""Targeted checks for curated 1946 country/dependent-territory ownership."""
import unittest

from generate_country_registry import (
    CONFIG_DIR,
    CUSTOM_COUNTRIES,
    OUT_DIR,
    build_merge_map,
    build_puppets_by_suzerain,
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

    def test_south_america_small_territories_folded_to_direct_control(self):
        """2026-07-18 (пользователь): Гайана/Суринам/Фр.Гвиана/Фолкленды —
        небольшое население, без сохранившейся отдельной государственности —
        свёрнуты в прямое владение метрополии (игровое упрощение) вместо
        отдельных стран."""
        for code in ("GUY", "SUR", "GUF", "FLK"):
            self.assertNotIn(code, self.preserve)
        self.assertEqual(self.owner_overrides["GUY"], "GBR")
        self.assertEqual(self.owner_overrides["SUR"], "NLD")
        self.assertEqual(self.owner_overrides["GUF"], "FRA")
        self.assertEqual(self.owner_overrides["FLK"], "GBR")

    def test_falkland_dependencies_resolve_transitively_to_final_owner(self):
        """SGS -> FLK -> GBR: FLK сам теперь ownerOverride, а не отдельная
        страна — merge_map должен разрешать цепочку до конечного владельца
        (build_merge_map's transitive closure), иначе South Georgia осталась
        бы приписана к несуществующему промежуточному коду."""
        self.assertEqual(self.owner_overrides["SGS"], "FLK")
        self.assertEqual(self.merge_map["SGS"], "GBR")

    def test_north_american_entities_use_1946_administrations(self):
        """Newfoundland — единственная Caribbean/N.America-запись, оставшаяся
        отдельной страной (Dominion-track); весь остальной Карибский бассейн
        свёрнут в прямое владение метрополий 2026-07-18 (игровое упрощение)."""
        self.assertIn("NFD", self.preserve)
        self.assertNotIn("NFD", self.merge_map)
        for code in ("BHS", "BLZ", "BMU", "BRB", "JAM", "SPM", "TTO"):
            self.assertNotIn(code, self.preserve)
            self.assertEqual(self.owner_overrides[code], "GBR" if code != "SPM" else "FRA")
        self.assertEqual(self.owner_overrides["PRI"], "USA")
        self.assertEqual(self.owner_overrides["VIR"], "USA")

        expected_overrides = {
            "ATG": "QWL", "AIA": "QWL", "KNA": "QWL", "MSR": "QWL", "VGB": "QWL",
            "DMA": "QWW", "GRD": "QWW", "LCA": "QWW", "VCT": "QWW",
            "ABW": "QND", "CUW": "QND", "SXM": "QND",
        }
        for source, target in expected_overrides.items():
            self.assertEqual(self.owner_overrides[source], target)
            self.assertEqual(self.merge_map[source], target)

        # CYM/TCA были зависимостями Jamaica; Jamaica сама теперь ownerOverride
        # (-> GBR), поэтому итоговый владелец после транзитивного разрешения — GBR.
        self.assertEqual(self.owner_overrides["CYM"], "JAM")
        self.assertEqual(self.merge_map["CYM"], "GBR")
        self.assertEqual(self.owner_overrides["TCA"], "JAM")
        self.assertEqual(self.merge_map["TCA"], "GBR")

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
        """Проверяем по merge_map (уже разрешённые до конечного владельца
        цепочки), не по сырым owner_overrides.values() — некоторые raw-таргеты
        сами являются промежуточным звеном цепочки (напр. FLK/JAM/MUS/KIR,
        свёрнутые в прямое владение 2026-07-18) и больше не обязаны иметь
        собственный anchor, раз у них самих есть переопределение."""
        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_targets = {
            entry["to"]
            for section in config["continents"].values()
            for entry in section.get("regionOwnerOverrides", [])
        }
        for code in self.preserve | set(self.merge_map.values()) | region_targets:
            self.assertIn(code, COUNTRY_POPULATION_1946)

    def test_norfolk_island_does_not_share_newfoundland_code(self):
        overlay = load_json(CONFIG_DIR / "occupation_overlay.json")
        self.assertEqual(overlay["OCE-0008"], "AUS")

    def test_european_naval_bases_folded_to_direct_control(self):
        """2026-07-18 (пользователь): Мальта/Гибралтар/Кипр — морские базы/
        крепости без сохранившейся отдельной государственности — свёрнуты в
        прямое владение Британии (игровое упрощение)."""
        for code in ("CYP", "GIB", "MLT"):
            self.assertNotIn(code, self.preserve)
            self.assertEqual(self.owner_overrides[code], "GBR")

    def test_african_entities_use_1946_administrations(self):
        # Значимые администрации (население > ~1М или уже отдельный статус) —
        # остаются отдельными странами.
        separate = {"GHA", "KEN", "NGA", "SLE", "ZMB", "ZWE", "AGO", "MOZ", "MDG",
                    "UGA", "MWI", "MAR", "TUN", "SDN"}
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        # 2026-07-18 (пользователь): небольшие колонии без сохранившейся
        # отдельной государственности — прямое владение метрополии.
        folded = {
            "GMB": "GBR", "MUS": "GBR", "SHN": "GBR", "SYC": "GBR",
            "CPV": "PRT", "GNB": "PRT", "STP": "PRT",
            "ESH": "ESP", "GNQ": "ESP",
            "DJI": "FRA", "LSO": "GBR", "BWA": "GBR", "SWZ": "GBR",
        }
        for code, target in folded.items():
            self.assertNotIn(code, self.preserve)
            self.assertEqual(self.owner_overrides[code], target)

        expected = {
            "BEN": "QFW", "BFA": "QFW", "CIV": "QFW", "GIN": "QFW",
            "MLI": "QFW", "MRT": "QFW", "NER": "QFW", "SEN": "QFW",
            "CAF": "QFE", "COG": "QFE", "GAB": "QFE", "TCD": "QFE",
            "COM": "MDG", "RWA": "QRU", "BDI": "QRU",
            "DZA": "FRA",
        }
        for source, target in expected.items():
            self.assertEqual(self.owner_overrides[source], target)
            self.assertEqual(self.merge_map[source], target)

        # IOT (Chagos) была зависимостью Mauritius; Mauritius сама теперь
        # ownerOverride (-> GBR) — итоговый владелец после транзитивного
        # разрешения тоже GBR.
        self.assertEqual(self.owner_overrides["IOT"], "MUS")
        self.assertEqual(self.merge_map["IOT"], "GBR")

        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_overrides = {
            entry["regionId"]: entry["to"]
            for entry in config["continents"]["africa"]["regionOwnerOverrides"]
        }
        self.assertEqual(
            region_overrides,
            {"AFR-0001": "FRA", "AFR-0002": "MDG", "AFR-0089": "QZN", "AFR-0090": "QZN"},
        )
        self.assertIn("QZN", COUNTRY_POPULATION_1946)
        self.assertIn("QZN", CUSTOM_COUNTRIES)
        self.assertNotIn("REU", CUSTOM_COUNTRIES)

    def test_asian_entities_use_1946_administrations(self):
        separate = {
            "HKG", "IND", "LKA", "MMR", "MYS", "SGP", "VNM", "IDN", "MAC",
            "KWT", "BHR", "QAT", "BRN",
        }
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        # 2026-07-18 (пользователь): Portuguese Timor — население < 1М, нет
        # отдельной государственности — прямое владение Португалии.
        self.assertNotIn("TLS", self.preserve)
        self.assertEqual(self.owner_overrides["TLS"], "PRT")

        self.assertEqual(self.owner_overrides["ARE"], "QAB")
        self.assertEqual(self.subject_overrides["JOR"], "GBR")
        self.assertEqual(self.subject_overrides["PHL"], "USA")

    def test_gulf_and_tonga_are_protected_states_not_protectorates(self):
        for code in ("KWT", "BHR", "QAT", "BRN"):
            self.assertEqual(self.subject_overrides[code], "GBR")
            self.assertEqual(self.catalog[code]["subject_type"], "protected_state")
        self.assertEqual(self.subject_overrides["TON"], "GBR")
        self.assertEqual(self.catalog["TON"]["subject_type"], "protected_state")

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

    def test_oceanian_entities_use_1946_administrations(self):
        # Крупные администрации/установленное самоуправление/монархия —
        # остаются отдельными странами.
        separate = {"COK", "PNG", "SLB", "TON", "VUT", "WSM"}
        self.assertTrue(separate.issubset(self.preserve))
        for code in separate:
            self.assertNotIn(code, self.merge_map)

        # 2026-07-18 (пользователь): большинство Океании — небольшие колонии
        # без сохранившейся отдельной государственности — прямое владение метрополии.
        folded = {
            "NCL": "FRA", "PYF": "FRA", "WLF": "FRA",
            "ASM": "USA", "GUM": "USA", "FJI": "GBR", "KIR": "GBR", "NIU": "NZL",
        }
        for code, target in folded.items():
            self.assertNotIn(code, self.preserve)
            self.assertEqual(self.owner_overrides[code], target)

        expected = {
            "UMI": "USA",
            "FSM": "QPS", "MHL": "QPS", "MNP": "QPS", "PLW": "QPS",
            "PCN": "GBR", "TKL": "NZL",
        }
        for source, target in expected.items():
            self.assertEqual(self.owner_overrides[source], target)
            self.assertEqual(self.merge_map[source], target)

        # TUV (Ellice Islands) была зависимостью KIR; KIR сама теперь
        # ownerOverride (-> GBR) — итоговый владелец после транзитивного
        # разрешения тоже GBR.
        self.assertEqual(self.owner_overrides["TUV"], "KIR")
        self.assertEqual(self.merge_map["TUV"], "GBR")

        self.assertEqual(self.subject_overrides["NRU"], "AUS")
        config = load_json(CONFIG_DIR / "country_entities_1946.json")
        region_overrides = {
            entry["regionId"]: entry["to"]
            for entry in config["continents"]["oceania"]["regionOwnerOverrides"]
        }
        self.assertEqual(region_overrides, {"OCE-0008": "NFK"})
        self.assertTrue({"NFK", "QPS"}.issubset(CUSTOM_COUNTRIES))

    def test_dual_suzerain_condominiums_are_puppets_of_both(self):
        self.assertEqual(self.catalog["VUT"]["subject_of"], ["GBR", "FRA"])
        self.assertEqual(self.catalog["SDN"]["subject_of"], ["GBR", "EGY"])
        puppets_by_suzerain = build_puppets_by_suzerain(self.catalog, self.merge_map)
        self.assertIn("VUT", puppets_by_suzerain["GBR"])
        self.assertIn("VUT", puppets_by_suzerain["FRA"])
        self.assertIn("SDN", puppets_by_suzerain["GBR"])
        self.assertIn("SDN", puppets_by_suzerain["EGY"])


if __name__ == "__main__":
    unittest.main()
