# -*- coding: utf-8 -*-
"""
CAPITAL_REGION_OVERRIDES — хардкод-таблица "страна -> позиционный region_id
столичного региона", читаемая generate_country_registry.py при сборке
countries.json. Вынесена из generate_country_registry.py в отдельный модуль
(2026-07-26, .agent/plans/capital-region-invariant.md), чтобы
validate_region_economy_1946.py мог импортировать ТУ ЖЕ таблицу вместо
повторного чтения/дублирования — единственный источник значений для обоих
потребителей.

region_id здесь ПОЗИЦИОННЫЙ (см. scripts/map/AGENTS.md, "Каскад region_id"):
присваивается порядком сборки геометрии, не привязан к географии. Любая
регенерация, меняющая ЧИСЛО регионов где-либо в build-порядке ДО записи,
сдвигает всё после неё — эта таблица НЕ пересчитывается пайплайном
автоматически и может протухнуть молча (уже случалось дважды: 46/61 записей
2026-07-23, см. capital-region-overrides-remap.md; ещё 8/61 обнаружены
2026-07-26 при аудите — see capital-region-invariant.md, включая находки,
не пойманные ремапом 07-23, потому что тот проверял только owner, не
конкретный регион).

CAPITAL_REGION_ANCHOR_NAMES — параллельная таблица "страна -> ожидаемое
английское имя региона" (из names.en.json на момент последней проверки).
Имя источника (ADM1-топоним) НЕ зависит от build-порядка (в отличие от
самого id) — используется validate_region_economy_1946.py как invariant,
устойчивый к перенумерации: если region_id сдвинется, имя РЕГИОНА,
оказавшегося на этом id, почти наверняка перестанет совпадать с ожидаемым,
и проверка провалится явно вместо молчаливого дрейфа. Не покрывает: (а)
случай, когда после сдвига на том же id ПО СЛУЧАЙНОСТИ оказывается регион с
похожим именем (не наблюдался, но теоретически возможен); (б) страны без
записи в этой таблице вообще (используют
best_region_by_owner-эвристику в generate_country_registry.py — эвристика
"регион максимальной площади", не привязана к реальной столице, заведомо
не всегда верна, но её замена шире текущей задачи, см.
capital-region-invariant.md, "Что осталось UNKNOWN").

Отдельный, более сильный (но охватывающий только 13 держав) якорь —
реальные географические координаты столиц в
server/src/scenarios/generateMapFeatures.ts::CAPITAL_OVERRIDES, читаются
validate_region_economy_1946.py через
economy_1946.capital_geography.load_ts_capital_anchors() (парсинг TS-файла,
не дублирование чисел в Python).
"""

# Курировано вручную; region_id ПОЗИЦИОННЫЙ — см. docstring модуля. Каждая
# запись — региональный ADM1-топоним из исходника (не всегда совпадает с
# именем столичного города: "Онтарио" содержит Оттаву, но сам называется
# иначе). Комментарий после каждой записи — историческое обоснование выбора
# (что содержит, откуда взято), не машинно проверяется, но объясняет решение
# человеку/агенту при следующей ревизии.
CAPITAL_REGION_OVERRIDES: dict[str, int] = {
    "SUN": 320,   # Москва (2026-07-26: было 318 "Chukotka AO" — не Москва,
                  # см. capital-region-invariant.md; owner-проверка ремапа
                  # 07-23 это не поймала, т.к. Chukotka тоже принадлежит SUN)
    "USA": 1015,  # Округ Колумбия/Вашингтон (2026-07-26: было 990 "Texas — Comanche")
    "GBR": 125,   # Большой Лондон (2026-07-26: было 124 "North Eastern")
    "FRA": 109,   # Иль-де-Франс/Париж (2026-07-26: было 108 "Centre-Val de Loire")
    "DNK": 67,    # Столичный регион (Копенгаген)
    "CAN": 810,   # Онтарио (Оттава)
    "BRA": 1078,  # Federal District — до Бразилиа (1960) Рио-де-Жанейро был
                  # отдельным федеральным округом, ОТДЕЛЬНЫМ от штата Рио-де-
                  # Жанейро (2026-07-26: было 1079 "Rio de Janeiro" — штат,
                  # не сам город/округ; географическая точка Рио содержится
                  # в 1078, не в 1079)
    "ITA": 178,   # Лацио (Рим) (2026-07-26: было 175 "Basilicata")
    "JPN": 573,   # Канто (Токио)
    "TWN": 420,   # Нанкин (2026-07-26: было 382 "Guangdong")
    "AFG": 449,   # Баглан (Кабул)
    "EGY": 1157,  # Каир
    "NFD": 804,   # Newfoundland, содержит St. John's
    "QWL": 847,   # Antigua, содержит St. John's — резиденцию Governor
    "QWW": 869,   # Grenada, содержит St. George's — резиденцию Governor
    "QND": 867,   # Curaçao, содержит Willemstad
    "MTQ": 797,   # Martinique, содержит Fort-de-France
    "GLP": 798,   # Guadeloupe, содержит Basse-Terre
    "QFW": 1302,  # Louga, содержит Dakar — столицу AOF
    "QFE": 1347,  # Pool, содержит Brazzaville — столицу AEF
    "QRU": 1349,  # Bujumbura Rural, содержит Usumbura — административный центр
    "QZN": 1235,  # AFR-0092 "Zanzibar South and Central", содержит Zanzibar Town/Stone Town
    "AGO": 1247,  # Cuando Cubango source polygon, содержащий Luanda —
                  # 2026-07-26: НЕ подтверждено координатами (см.
                  # capital-region-invariant.md, "что осталось UNKNOWN");
                  # Ангола смоделирована всего 5 укрупнёнными регионами,
                  # реальная точка Луанды (13.234E, -8.838S) по geometry
                  # попадает в "Lunda Norte" (1248), не в текущий id и не в
                  # реальную провинцию Луанда — похоже на огрубление формы
                  # регионов, не позиционный дрейф; оставлено как есть,
                  # чинить требует решения по геометрии/группировке Анголы,
                  # вне границ этой задачи.
    "MOZ": 1251,  # Gaza source polygon, содержит Lourenço Marques
    "MDG": 1234,  # Bongolava source polygon, содержащий Tananarive
    "GHA": 1272,  # Eastern source polygon, содержащий Accra
    "KEN": 1267,  # Rift Valley source polygon, содержащий Nairobi
    "NGA": 1219,  # Benue source polygon, содержащий Lagos
    "SLE": 1336,  # AFR-0193 "Northern" — единственный Sierra Leone polygon, содержит Freetown
    "ZMB": 1296,  # Southern source polygon, содержащий Lusaka
    "ZWE": 1299,  # Mashonaland West source polygon, содержащий Salisbury
    "QTB": 418,   # Xizang polygon, содержит Lhasa
    "QSI": 501,   # Sikkim, содержит Gangtok
    "QJK": 514,   # Jammu and Kashmir, содержит Srinagar
    "QPI": 521,   # Goa, административный центр Portuguese India
    "QFI": 524,   # Puducherry
    "HKG": 478,   # Hong Kong
    "IND": 529,   # Delhi
    "LKA": 637,   # Ceylon, содержит Colombo
    "MMR": 639,   # Bago source polygon, содержащий Rangoon
    "MYS": 658,   # Perak source polygon, содержащий Kuala Lumpur
    "SGP": 699,   # Singapore
    "QNB": 654,   # Sabah, содержит Jesselton
    "QSR": 655,   # Sarawak, содержит Kuching
    "QLB": 657,   # Labuan
    "QDV": 772,   # Hà Nội
    "VNM": 774,   # Hồ Chí Minh city / Saigon
    "QRI": 498,   # ASI-0121 "Jawa Barat" (dist=0 до Yogyakarta) — Java polygon, содержит Yogyakarta
    "IDN": 495,   # Sulawesi Selatan, Dutch eastern-administration anchor
                  # (2026-07-26: было 479 "Kalimantan Timur" — не Sulawesi
                  # Selatan; найдено систематической сверкой комментарий-vs-
                  # текущее-имя, см. capital-region-invariant.md)
    "MAC": 652,   # Macau
    "QAD": 795,   # Lahij source polygon, содержащий Aden
    "QPS": 1359,  # Northern Mariana Islands, Saipan administration anchor
    "COK": 1360,  # Cook Islands, Rarotonga
    "NFK": 1362,  # Norfolk Island, Kingston
    "CHN": 397,   # Шэньси — Яньань (столица КПК/пограничного района Шэньси-
                  # Ганьсу-Нинся в гражданскую войну 1946) физически в
                  # Шэньси; (2026-07-26: раньше записи не было вообще,
                  # capitalRegionId брался эвристикой "регион максимальной
                  # площади" (best_region_by_owner в
                  # generate_country_registry.py) — попадал в Suiyuan,
                  # никак не связанный с реальной столицей)
}

# 2026-07-18 (docs/DECISIONS.md): семь эмиратов Trucial Coast (QSH/Sharjah,
# QRK/Ras Al Khaimah, QAB/Abu Dhabi, QUQ/Umm Al Quwain, QAJ/Ajman,
# QFU/Fujairah, QDU/Dubai) объединены в одну страну под нативным кодом MAP
# `ARE` ("Договорной Оман") — CUSTOM_COUNTRIES-записи были убраны тогда же,
# но эти 7 CAPITAL_REGION_OVERRIDES-записей остались (отдельный словарь,
# решение их не упомянуло явно) и с тех пор молча резолвились в чужие
# страны (Palestine/China regions, никак не используясь — ARE не ищет их по
# своему коду). Удалены здесь как мёртвый код (2026-07-26, см.
# capital-region-invariant.md). `ARE` пока без записи в этой таблице —
# использует best_region_by_owner-эвристику; выбор реальной резиденции
# British Political Resident (историч. Шарджа до 1953, затем Дубай) не
# определён этой задачей, см. "что осталось UNKNOWN".

# Ожидаемое английское имя (names.en.json) региона на CAPITAL_REGION_OVERRIDES[code]
# на момент последней проверки (2026-07-26 для всех записей ниже) — не
# позиционно, читается по факту содержимого региона, а не по его месту в
# build-порядке. validate_region_economy_1946.py сравнивает его с ТЕКУЩИМ
# именем по этому id при каждом прогоне: расхождение = region_id сместился
# после регенерации геометрии и таблицу пора пересинхронизировать (см.
# generate_country_registry.py::CAPITAL_REGION_OVERRIDES). Заведено для
# ВСЕХ 55 действующих записей выше — не только 13 держав с географическими
# координатами (validate_region_economy_1946.py::validate_capital_geography) —
# чтобы вся таблица, а не только державы, была защищена от повторного
# протухания.
CAPITAL_REGION_ANCHOR_NAMES: dict[str, str] = {
    "SUN": "Moscow",
    "USA": "District of Columbia",
    "GBR": "Greater London",
    "FRA": "Île-de-France",
    "DNK": "Hovedstaden",
    "CAN": "Ontario",
    "BRA": "Distrito Federal",
    "ITA": "Lazio",
    "JPN": "Kanto",
    "TWN": "Nanjing",
    "AFG": "Baghlan",
    "EGY": "Cairo",
    "NFD": "Newfoundland",
    "QWL": "Antigua and Barbuda",
    "QWW": "Grenada",
    "QND": "Curaçao",
    "MTQ": "Martinique",
    "GLP": "Guadeloupe",
    "QFW": "Louga",
    "QFE": "Pool",
    "QRU": "Bujumbura Rural",
    "QZN": "Zanzibar South and Central",
    "AGO": "Cuando Cubango",
    "MOZ": "Gaza",
    "MDG": "Bongolava",
    "GHA": "Eastern",
    "KEN": "Rift Valley",
    "NGA": "Benue",
    "SLE": "Northern",
    "ZMB": "Southern",
    "ZWE": "Mashonaland West",
    "QTB": "Xizang",
    "QSI": "Sikkim",
    "QJK": "Jammu and Kashmir",
    "QPI": "Goa",
    "QFI": "Puducherry",
    "HKG": "Hong Kong",
    "IND": "Delhi",
    "LKA": "Ceylon",
    "MMR": "Bago",
    "MYS": "Perak",
    "SGP": "Singapore",
    "QNB": "Sabah",
    "QSR": "Sarawak",
    "QLB": "Labuan",
    "QDV": "Hà Nội",
    "VNM": "Hồ Chí Minh city",
    "QRI": "Jawa Barat",
    "IDN": "Sulawesi Selatan",
    "MAC": "Macau",
    "QAD": "Lahij",
    "QPS": "Northern Mariana Islands",
    "COK": "Cook Islands",
    "NFK": "Norfolk Island",
    "CHN": "Shaanxi",
}
