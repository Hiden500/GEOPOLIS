#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тест `classify()` из `build/audit_region_fragments.py`.

Синтетические кортежи `(idx, adm1_code, name, iso)`, не завязанные на
реальные данные. Проверяется свойство: единица сырья без имени — не спор
(замер 2026-08-30: 72 антарктических куска ложно уходили в «спорные», потому
что их доминирующая сырая единица не входит в `members` — прежний фикс
(members.add(main_owner[0])) закрывает только единицу под ГЛАВНЫМ телом
региона, а острова Антарктиды лежат под ДРУГИМИ безымянными полигонами).

Запуск: python scripts/map/test_audit_region_fragments.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))
from audit_region_fragments import classify  # noqa: E402


def owner(idx, name, iso="AA", code="AA.1"):
    return (idx, code, name, iso)


class ClassifyTest(unittest.TestCase):
    def test_unnamed_non_member_falls_through_to_island(self):
        """Безымянная единица, не входящая в members, своя страна, высокая
        доля воды по периметру -> остров, а не «спорный»."""
        part = owner(idx=99, name="")
        main = owner(idx=1, name="", iso="AA")
        group, reason = classify(part, main, members={1}, wfrac=0.98)
        self.assertEqual(group, "island")
        self.assertIn("входит в регион", reason)

    def test_unnamed_non_member_falls_through_to_enclave(self):
        """Та же безымянная единица, но периметр в основном по суше ->
        эксклав, не «спорный» — свойство держится независимо от wfrac."""
        part = owner(idx=99, name="")
        main = owner(idx=1, name="", iso="AA")
        group, _ = classify(part, main, members={1}, wfrac=0.10)
        self.assertEqual(group, "enclave")

    def test_named_non_member_still_flagged_foreign_adm1(self):
        """НЕГАТИВНЫЙ КОНТРОЛЬ: у единицы РЕАЛЬНОЕ имя (как у Michigan/
        Kalangala, 15 настоящих спорных) — фикс её не задевает, старое
        поведение держится."""
        part = owner(idx=99, name="Michigan", iso="US")
        main = owner(idx=1, name="Minnesota", iso="US")
        group, reason = classify(part, main, members={1}, wfrac=0.98)
        self.assertEqual(group, "foreign_adm1")
        self.assertIn("Michigan", reason)

    def test_unnamed_but_member_is_not_foreign_adm1_regardless(self):
        """Единица входит в members -> остров/эксклав и без имени: пустое
        имя ослабляет только members-проверку, не остальную классификацию."""
        part = owner(idx=1, name="")
        main = owner(idx=1, name="", iso="AA")
        group, _ = classify(part, main, members={1}, wfrac=0.98)
        self.assertEqual(group, "island")

    def test_iso_mismatch_still_wins_over_empty_name(self):
        """Чужая страна перебивает всё — пустое имя не открывает лазейку
        для настоящих сирот (`p_iso != m_iso` проверяется раньше)."""
        part = owner(idx=99, name="", iso="BB")
        main = owner(idx=1, name="", iso="AA")
        group, reason = classify(part, main, members=set(), wfrac=0.98)
        self.assertEqual(group, "orphan")
        self.assertIn("чужой страны", reason)


if __name__ == "__main__":
    unittest.main()
