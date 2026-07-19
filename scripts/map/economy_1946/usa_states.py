"""
Реальные относительные веса населения штатов США (перепись 1940, широко
известные цифры — не индивидуальный веб-поиск, но низкий риск галлюцинации
для переписи такого уровня известности). США — самый заметный кейс из
прошлого аудита (Монтана 5.35М/реально ~560К, Невада 4.03М/реально ~110К) —
здесь заменяем tier×area эвристику точным реальным весом штата, оставляя
tier×area только для распределения ВНУТРИ штата между его 1-4 регионами
(там, где несколько регионов на один штат).

Абсолютные числа не нужны (нормализуется на COUNTRY_POPULATION_1946["USA"]) —
только соотношения между штатами, поэтому подходит перепись 1940, а не 1946.
"""

# Ключ — токен до " — " в names.en региона, ИЛИ полное имя для односложных штатов.
STATE_WEIGHT_1940: dict[str, int] = {
    "washington": 1_736_191,
    "idaho": 524_873,
    "montana": 559_456,
    "north dakota": 641_935,
    "minnesota": 2_792_300,
    "michigan": 5_256_106,
    "ohio": 6_907_612,
    "pennsylvania": 9_900_180,
    "new york": 13_479_142,
    "vermont": 359_231,
    "new hampshire": 491_524,
    "maine": 847_226,
    "arizona": 499_261,
    "california": 6_907_387,
    "new mexico": 531_818,
    "texas": 6_414_824,
    "alaska": 72_524,
    "louisiana": 2_363_880,
    "mississippi": 2_183_796,
    "alabama": 2_832_961,
    "florida": 1_897_414,
    "georgia": 3_123_723,
    "south carolina": 1_899_804,
    "north carolina": 3_571_623,
    "virginia": 2_677_773,
    "district of columbia": 663_091,
    "maryland": 1_821_244,
    "delaware": 266_505,
    "new jersey": 4_160_165,
    "connecticut": 1_709_242,
    "rhode island": 713_346,
    "massachusetts": 4_316_721,
    "oregon": 1_089_684,
    "hawaii": 423_330,
    "utah": 550_310,
    "wyoming": 250_742,
    "nevada": 110_247,
    "colorado": 1_123_296,
    "south dakota": 642_961,
    "nebraska": 1_315_834,
    "kansas": 1_801_028,
    "oklahoma": 2_336_434,
    "iowa": 2_538_268,
    "missouri": 3_784_664,
    "wisconsin": 3_137_587,
    "illinois": 7_897_241,
    "kentucky": 2_845_627,
    "arkansas": 1_949_387,
    "tennessee": 2_915_841,
    "west virginia": 1_901_974,
    "indiana": 3_427_796,
    "guantanamo bay": 10_000,  # военная база, не штат — почти без гражд. населения
    "panama canal zone": 51_827,
    # 2026-07-19-j: Пуэрто-Рико/Виргинские о-ва (США) отсутствовали здесь —
    # без реального веса попадали в fallback raw tier×area, который на
    # порядки меньше масштаба реальных весов штатов (миллионы) в этой же
    # сумме total_w, обнуляя их долю до округления (было 157/27 человек
    # вместо ~1.9М/~25К). Перепись 1940.
    "puerto rico": 1_869_255,
    "united states virgin islands": 24_889,
}


def usa_state_key(region_name: str) -> str:
    """'Ohio — Fairfield' -> 'ohio'; 'Montana' -> 'montana'; 'District of Columbia' -> 'district of columbia'."""
    base = region_name.split(" — ")[0].strip().lower()
    return base
