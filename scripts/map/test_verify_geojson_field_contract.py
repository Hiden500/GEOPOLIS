#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_verify_geojson_field_contract.py — тесты контракта полей geojson.

Проверяется СВОЙСТВО, а не снимок: ни один тест не знает, сколько сегодня фич,
какие region_id живые и какова доля атрибутированных морских зон. Каждый тест
строит минимальную пару «мастер + клиент», ломает ровно одно место и требует,
чтобы проверка это назвала.

Отдельно закреплена ОТЛОЖЕННОСТЬ `naval_terrain`/`ocean`: морская зона без них
обязана проходить. Без этого теста «отложено» держалось бы комментарием, а
комментарий не падает.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import verify_geojson_field_contract as vgfc  # noqa: E402
from verify_geojson_field_contract import (  # noqa: E402
    check_client, check_join, check_master,
)

GEOM = {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]}


def land(region_id="EUR-0001", **over):
    props = {
        "region_id": region_id,
        "continent": "Europe",
        "region_type": "land",
        "name": "Testland",
        "area_km2": 100.0,
        "iso_a2": "DE",
    }
    props.update(over)
    return {"type": "Feature", "properties": props, "geometry": GEOM}


def sea(region_id="SEA-0001", **over):
    props = {
        "region_id": region_id,
        "continent": "Ocean",
        "region_type": "sea",
        "name": "Test Sea",
        "area_km2": 500.0,
    }
    props.update(over)
    return {"type": "Feature", "properties": props, "geometry": GEOM}


def client_of(master_feature, numeric_id=1, **over):
    props = master_feature["properties"]
    out = {
        "region_id": props["region_id"],
        "type": "region" if props["region_type"] == "land" else "ocean",
        "name": props["name"],
    }
    out.update(over)
    return {"type": "Feature", "id": numeric_id, "properties": out, "geometry": GEOM}


def joined(*errors_sources):
    return " | ".join(errors_sources)


class MasterContract(unittest.TestCase):
    def test_clean_master_passes(self):
        self.assertEqual(check_master([land(), sea()]), [])

    def test_field_outside_contract_is_named(self):
        ft = land(state="Washington")
        errors = check_master([ft])
        self.assertTrue(any("'state'" in e and "EUR-0001" in e for e in errors),
                        joined(*errors))

    def test_missing_required_field_is_named(self):
        ft = land()
        del ft["properties"]["area_km2"]
        errors = check_master([ft])
        self.assertTrue(any("area_km2" in e for e in errors), joined(*errors))

    def test_iso_a2_only_on_land(self):
        errors = check_master([sea(iso_a2="DE")])
        self.assertTrue(any("iso_a2" in e for e in errors), joined(*errors))

    def test_land_without_iso_a2_fails(self):
        ft = land()
        del ft["properties"]["iso_a2"]
        self.assertTrue(any("iso_a2" in e for e in check_master([ft])))

    def test_iso_a2_format_is_enforced(self):
        errors = check_master([land(iso_a2="DE_KC")])
        self.assertTrue(any("ISO-3166" in e for e in errors), joined(*errors))

    def test_prefix_must_agree_with_region_type(self):
        errors = check_master([land(region_id="SEA-0007")])
        self.assertTrue(any("префикс" in e for e in errors), joined(*errors))

    def test_duplicate_region_id_is_caught(self):
        errors = check_master([land(), land()])
        self.assertTrue(any("повторяется" in e for e in errors), joined(*errors))

    def test_deferred_water_attribution_does_not_fail(self):
        """Новая морская зона без naval_terrain/ocean шаг не роняет — пока
        отложенность не снята (одной правкой в DEFERRED_BY_TYPE)."""
        self.assertEqual(check_master([sea(), sea("SEA-0002")]), [])

    def test_deferred_field_on_land_is_rejected(self):
        errors = check_master([land(naval_terrain="deep_ocean")])
        self.assertTrue(any("naval_terrain" in e for e in errors), joined(*errors))


class ClosedExceptionLists(unittest.TestCase):
    """Три списка исключений закрыты: названное проходит, НОВОЕ роняет шаг.
    Без этих тестов «закрытый список» держался бы только намерением."""

    def test_named_non_iso_code_passes(self):
        code = next(iter(vgfc.NON_ISO_SOURCE_CODES))
        self.assertEqual(check_master([land(iso_a2=code)]), [])

    def test_unnamed_non_iso_code_fails(self):
        errors = check_master([land(iso_a2="XX_YY")])
        self.assertTrue(any("NON_ISO_SOURCE_CODES" in e for e in errors),
                        joined(*errors))

    def test_named_empty_name_passes(self):
        # Не читает production-словарь (docstring файла: "ни один тест не
        # знает... какие region_id живые") — список сегодня пуст (2026-08-30,
        # SAM-0040/SAM-0055 закрыты), а свойство «названное исключение
        # проходит» обязано проверяться независимо от того, есть ли сейчас
        # хоть одна живая запись.
        with patch.dict(vgfc.KNOWN_EMPTY_NAMES, {"SAM-9999": "тестовая запись"}):
            self.assertEqual(
                check_master([land(region_id="SAM-9999", name="", iso_a2="CO")]), [])

    def test_new_empty_name_fails(self):
        errors = check_master([land(name="  ")])
        self.assertTrue(any("KNOWN_EMPTY_NAMES" in e for e in errors), joined(*errors))

    def test_named_zero_area_passes(self):
        rid = next(iter(vgfc.KNOWN_ZERO_AREA))
        self.assertEqual(check_master([land(region_id=rid, area_km2=0.0)]), [])

    def test_new_zero_area_fails(self):
        errors = check_master([land(area_km2=0.0)])
        self.assertTrue(any("KNOWN_ZERO_AREA" in e for e in errors), joined(*errors))


class ClientContract(unittest.TestCase):
    def setUp(self):
        self.master = [land(), sea()]
        self.client = [client_of(self.master[0], 1), client_of(self.master[1], 2)]

    def test_clean_client_passes(self):
        self.assertEqual(check_client(self.client, self.master), [])

    def test_property_outside_contract_is_named(self):
        self.client[0]["properties"]["iso_a2"] = "DE"
        errors = check_client(self.client, self.master)
        self.assertTrue(any("'iso_a2'" in e for e in errors), joined(*errors))

    def test_missing_property_is_named(self):
        del self.client[1]["properties"]["name"]
        errors = check_client(self.client, self.master)
        self.assertTrue(any("name" in e for e in errors), joined(*errors))

    def test_feature_id_must_be_positive_int(self):
        self.client[0]["id"] = "1"
        errors = check_client(self.client, self.master)
        self.assertTrue(any("id фичи" in e for e in errors), joined(*errors))

    def test_feature_id_must_be_unique(self):
        self.client[1]["id"] = self.client[0]["id"]
        errors = check_client(self.client, self.master)
        self.assertTrue(any("занят" in e for e in errors), joined(*errors))

    def test_type_must_match_master_region_type(self):
        self.client[1]["properties"]["type"] = "region"
        errors = check_client(self.client, self.master)
        self.assertTrue(any("region_type" in e for e in errors), joined(*errors))

    def test_unknown_region_id_is_caught(self):
        self.client[0]["properties"]["region_id"] = "EUR-9999"
        errors = check_client(self.client, self.master)
        self.assertTrue(any("отсутствует в мастере" in e for e in errors),
                        joined(*errors))


class JoinContract(unittest.TestCase):
    def setUp(self):
        self.master = [land(), sea()]
        self.client = [client_of(self.master[0], 1), client_of(self.master[1], 2)]
        self.dir = tempfile.TemporaryDirectory()
        self.scenario = Path(self.dir.name)
        self.write("regions.core.json", [{"id": 1, "geoJsonId": "EUR-0001"}])
        self.write("waters.json", [{"id": 2, "geoJsonId": "SEA-0001",
                                    "waterType": "sea"}])

    def tearDown(self):
        self.dir.cleanup()

    def write(self, name, payload):
        (self.scenario / name).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_matching_ids_pass(self):
        self.assertEqual(check_join(self.client, self.scenario), [])

    def test_numeric_id_drift_is_caught(self):
        self.write("regions.core.json", [{"id": 42, "geoJsonId": "EUR-0001"}])
        errors = check_join(self.client, self.scenario)
        self.assertTrue(any("42" in e for e in errors), joined(*errors))

    def test_water_missing_from_waters_json_is_caught(self):
        self.write("waters.json", [])
        errors = check_join(self.client, self.scenario)
        self.assertTrue(any("SEA-0001" in e for e in errors), joined(*errors))

    def test_absent_waters_file_is_caught(self):
        (self.scenario / "waters.json").unlink()
        errors = check_join(self.client, self.scenario)
        self.assertTrue(any("waters.json" in e for e in errors), joined(*errors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
