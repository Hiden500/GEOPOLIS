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
автоматически и может протухнуть молча (уже случалось трижды: 46/61 записей
2026-07-23, см. capital-region-overrides-remap.md; ещё 8/61 обнаружены
2026-07-26 при аудите — see capital-region-invariant.md, включая находки,
не пойманные ремапом 07-23, потому что тот проверял только owner, не
конкретный регион; ещё 26/68 сдвинулись 2026-07-29 суммарно из-за
рекластеризации Океании (+22 фичи), разделения Филиппин/Японии (+25) и слияния
безымянного MX-обрывка в Юкатан (-1) в рамках работы над Панамским каналом —
см. docs/DECISIONS.md 2026-07-29 "Панама"; починено тем же протоколом:
сверка CAPITAL_REGION_ANCHOR_NAMES против текущего имени, resync по
owner+name, без ручного угадывания).

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
    "SUN": 319,   # Москва (2026-07-26: было 318 "Chukotka AO" — не Москва,
                  # см. capital-region-invariant.md; owner-проверка ремапа
                  # 07-23 это не поймала, т.к. Chukotka тоже принадлежит SUN)
    "USA": 1008,  # Округ Колумбия/Вашингтон (2026-07-29: было 1015 — см.
                  # ремап ниже, "resync 2026-07-29")
    "GBR": 124,   # Большой Лондон (2026-07-26: было 124 "North Eastern")
    "FRA": 108,   # Иль-де-Франс/Париж (2026-07-26: было 108 "Centre-Val de Loire")
    "DNK": 66,    # Столичный регион (Копенгаген)
    "CAN": 818,   # Онтарио (Оттава) (2026-07-29: было 810)
    "BRA": 1069,  # Federal District — до Бразилиа (1960) Рио-де-Жанейро был
                  # отдельным федеральным округом, ОТДЕЛЬНЫМ от штата Рио-де-
                  # Жанейро (2026-07-29: было 1078, до этого 1079 "Rio de
                  # Janeiro" — штат, не сам город/округ; географическая точка
                  # Рио содержится в текущем id, не в id штата)
    "ITA": 177,   # Лацио (Рим) (2026-07-26: было 175 "Basilicata")
    "JPN": 571,   # Канто (Токио)
    "TWN": 417,   # Нанкин (2026-07-26: было 382 "Guangdong")
    "AFG": 446,   # Баглан (Кабул)
    "EGY": 1146,  # Каир (2026-07-29: было 1157)
    "NFD": 812,   # Newfoundland, содержит St. John's (2026-07-29: было 804)
    "QWL": 855,   # Antigua, содержит St. John's — резиденцию Governor
                  # (2026-07-29: было 847)
    "QWW": 872,   # Grenada, содержит St. George's — резиденцию Governor
                  # (2026-07-29: было 869)
    "QND": 808,   # Curaçao, содержит Willemstad (2026-07-29: было 867)
    "MTQ": 806,   # Martinique, содержит Fort-de-France (2026-07-29: было 797)
    "GLP": 807,   # Guadeloupe, содержит Basse-Terre (2026-07-29: было 798)
    "QFW": 1290,  # Louga, содержит Dakar — столицу AOF (2026-07-29: было 1302)
    "QFE": 1324,  # Pool, содержит Brazzaville — столицу AEF (2026-07-29: было 1347)
    "QRU": 1326,  # Bujumbura Rural, содержит Usumbura — административный
                  # центр (2026-07-29: было 1349)
    "QZN": 1224,  # AFR-0092 "Zanzibar South and Central", содержит Zanzibar
                  # Town/Stone Town (2026-07-29: было 1235)
    "AGO": 1235,  # Cuando Cubango source polygon, содержащий Luanda —
                  # (2026-07-29: было 1247)
                  # 2026-07-26: НЕ подтверждено координатами (см.
                  # capital-region-invariant.md, "что осталось UNKNOWN");
                  # Ангола смоделирована всего 5 укрупнёнными регионами,
                  # реальная точка Луанды (13.234E, -8.838S) по geometry
                  # попадает в "Lunda Norte" (1248), не в текущий id и не в
                  # реальную провинцию Луанда — похоже на огрубление формы
                  # регионов, не позиционный дрейф; оставлено как есть,
                  # чинить требует решения по геометрии/группировке Анголы,
                  # вне границ этой задачи.
    "MOZ": 1239,  # Gaza source polygon, содержит Lourenço Marques (2026-07-29: было 1251)
    "MDG": 1223,  # Bongolava source polygon, содержащий Tananarive (2026-07-29: было 1234)
    "GHA": 1260,  # Eastern source polygon, содержащий Accra (2026-07-29: было 1272)
    "KEN": 1255,  # Rift Valley source polygon, содержащий Nairobi (2026-07-29: было 1267)
    "NGA": 1208,  # Benue source polygon, содержащий Lagos (2026-07-29: было 1219)
    "SLE": 1314,  # AFR-0193 "Northern" — единственный Sierra Leone polygon,
                  # содержит Freetown (2026-07-29: было 1336)
    "ZMB": 1284,  # Southern source polygon, содержащий Lusaka (2026-07-29: было 1296)
    "ZWE": 1287,  # Mashonaland West source polygon, содержащий Salisbury (2026-07-29: было 1299)
    "QTB": 415,   # Xizang polygon, содержит Lhasa
    "QSI": 499,   # Sikkim, содержит Gangtok
    "QJK": 512,   # Jammu and Kashmir, содержит Srinagar
    "QPI": 519,   # Goa, административный центр Portuguese India
    "QFI": 522,   # Puducherry
    "HKG": 475,   # Hong Kong
    "IND": 527,   # Delhi
    "LKA": 634,   # Ceylon, содержит Colombo
    "MMR": 636,   # Bago source polygon, содержащий Rangoon
    "MYS": 655,   # Perak source polygon, содержащий Kuala Lumpur
    "SGP": 708,   # Singapore
    "QNB": 651,   # Sabah, содержит Jesselton
    "QSR": 652,   # Sarawak, содержит Kuching
    "QLB": 654,   # Labuan
    "QDV": 781,   # Hà Nội
    "VNM": 783,   # Hồ Chí Minh city / Saigon
    "QRI": 496,   # ASI-0121 "Jawa Barat" (dist=0 до Yogyakarta) — Java polygon, содержит Yogyakarta
    "IDN": 493,   # Sulawesi Selatan, Dutch eastern-administration anchor
                  # (2026-07-26: было 479 "Kalimantan Timur" — не Sulawesi
                  # Selatan; найдено систематической сверкой комментарий-vs-
                  # текущее-имя, см. capital-region-invariant.md)
    "MAC": 649,   # Macau
    "QAD": 804,   # Lahij source polygon, содержащий Aden
    "QPS": 1336,  # Northern Mariana Islands, Saipan administration anchor (2026-07-29: было 1359)
    "COK": 1337,  # Cook Islands, Rarotonga (2026-07-29: было 1360)
    "NFK": 1339,  # Norfolk Island, Kingston (2026-07-29: было 1362)
    "CHN": 394,   # Шэньси — Яньань (столица КПК/пограничного района Шэньси-
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
    # 2026-08-02: регион переименован «Distrito Federal (Rio de Janeiro)» ->
    # «Rio de Janeiro» (скобок в игровых именах больше нет). Id 1101 прежний и
    # указывает на тот же город-округ; штат рядом называется «Rio de Janeiro
    # State», поэтому якорь по-прежнему однозначен.
    "BRA": "Rio de Janeiro",
    "ITA": "Lazio",
    "JPN": "Kanto",
    "TWN": "Nanjing",
    "AFG": "Baghlan",
    "EGY": "Cairo",
    "NFD": "Newfoundland",
    # 2026-08-08: якорный регион поглощён островной записью
    # (out/region_edits_islands.json, решения пользователя 2026-08-02),
    # якорь переставлен на регион-преемник — сама столица не менялась.
    "QWL": "Leeward Islands",
    "QWW": "Windward Islands",
    "QND": "Leeward Antilles",
    "MTQ": "Martinique",
    "GLP": "Guadeloupe",
    "QFW": "Louga",
    "QFE": "Pool",
    "QRU": "Bujumbura Rural",
    "QZN": "Zanzibar",
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
    # 2026-08-08: регион переименован REN-JAVA (Jawa Barat -> Java),
    # он же по-прежнему содержит Джокьякарту — столицу Республики.
    "QRI": "Java",
    "IDN": "Sulawesi Selatan",
    "MAC": "Macau",
    "QAD": "Lahij",
    "QPS": "Northern Mariana Islands",
    "COK": "Cook Islands",
    "NFK": "Norfolk Island",
    "CHN": "Shaanxi",
}
