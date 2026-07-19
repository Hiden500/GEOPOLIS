# -*- coding: utf-8 -*-
"""
translate_world.py
Чистит world_1946.geojson: убирает debug-атрибуты (merge_method,
source_adm1, source_count, note - остаются только в файлах континентов),
переводит все названия на английский, упрощает названия земель Германии
(зона уже в отдельном occupation_zone_1946, не нужно дублировать в name).
"""
from paths import out
import json

TRANSLATE = {
    "Андорра": "Andorra", "Албания": "Albania",
    "Аландские острова (отдельный iso_a2='AX', автономия Финляндии)": "Åland Islands",
    "Гибралтар (отдельный iso_a2='GI', не входил в список стран)": "Gibraltar",
    "Исландия": "Iceland",
    "Лихтенштейн (отдельный iso_a2='LI', не входил в список стран)": "Liechtenstein",
    "Монако (отдельный iso_a2='MC', не входил в список стран)": "Monaco",
    "Молдавская ССР": "Moldavian SSR", "Черногория": "Montenegro",
    "Северная Македония": "North Macedonia",
    "Словения": "Slovenia",
    "Сан-Марино (отдельный iso_a2='SM', не входил в список стран)": "San Marino",
    "Косово (отдельный iso_a2='XK' в данных, не входил в список стран)": "Kosovo",
    # РСФСР
    "Башкирская АССР": "Bashkir ASSR", "Бурятская АССР": "Buryat ASSR",
    "Дагестанская АССР": "Dagestan ASSR", "Кабардино-Балкарская АССР": "Kabardino-Balkar ASSR",
    "Калмыцкая АССР": "Kalmyk ASSR", "Карельская АССР": "Karelian ASSR",
    "Коми АССР": "Komi ASSR", "Марийская АССР": "Mari ASSR",
    "Мордовская АССР": "Mordovian ASSR", "Северо-Осетинская АССР": "North Ossetian ASSR",
    "Татарская АССР": "Tatar ASSR", "Тувинская АССР": "Tuvan ASSR",
    "Удмуртская АССР": "Udmurt ASSR", "Чечено-Ингушская АССР": "Chechen-Ingush ASSR",
    "Чувашская АССР": "Chuvash ASSR", "Якутская АССР": "Yakut ASSR",
    "Алтайский край": "Altai Krai", "Краснодарский край": "Krasnodar Krai",
    "Красноярский край": "Krasnoyarsk Krai", "Приморский край": "Primorsky Krai",
    "Ставропольский край": "Stavropol Krai", "Хабаровский край": "Khabarovsk Krai",
    "Амурская область": "Amur Oblast", "Архангельская область": "Arkhangelsk Oblast",
    "Астраханская область": "Astrakhan Oblast", "Белгородская область": "Belgorod Oblast",
    "Брянская область": "Bryansk Oblast", "Владимирская область": "Vladimir Oblast",
    "Волгоградская область": "Stalingrad Oblast",  # 1946 название (до 1961)
    "Вологодская область": "Vologda Oblast", "Воронежская область": "Voronezh Oblast",
    "Горьковская область": "Gorky Oblast", "Ивановская область": "Ivanovo Oblast",
    "Иркутская область": "Irkutsk Oblast", "Калининградская область": "Kaliningrad Oblast",
    "Калининская область": "Kalinin Oblast", "Калужская область": "Kaluga Oblast",
    "Камчатская область": "Kamchatka Oblast", "Кемеровская область": "Kemerovo Oblast",
    "Кировская область": "Kirov Oblast", "Костромская область": "Kostroma Oblast",
    "Куйбышевская область": "Kuybyshev Oblast", "Курганская область": "Kurgan Oblast",
    "Курская область": "Kursk Oblast", "Ленинградская область": "Leningrad Oblast",
    "Липецкая область": "Lipetsk Oblast", "Магаданская область": "Magadan Oblast",
    "Московская область": "Moscow Oblast", "Мурманская область": "Murmansk Oblast",
    "Новгородская область": "Novgorod Oblast", "Новосибирская область": "Novosibirsk Oblast",
    "Омская область": "Omsk Oblast", "Оренбургская область": "Chkalov Oblast",  # 1946 (до 1957)
    "Орловская область": "Oryol Oblast", "Пензенская область": "Penza Oblast",
    "Пермская область": "Molotov Oblast",  # 1946 название (1940-1957)
    "Псковская область": "Pskov Oblast", "Ростовская область": "Rostov Oblast",
    "Рязанская область": "Ryazan Oblast", "Саратовская область": "Saratov Oblast",
    "Сахалинская область": "Sakhalin Oblast", "Свердловская область": "Sverdlovsk Oblast",
    "Смоленская область": "Smolensk Oblast", "Тамбовская область": "Tambov Oblast",
    "Томская область": "Tomsk Oblast", "Тульская область": "Tula Oblast",
    "Тюменская область": "Tyumen Oblast", "Ульяновская область": "Ulyanovsk Oblast",
    "Челябинская область": "Chelyabinsk Oblast", "Читинская область": "Chita Oblast",
    "Ярославская область": "Yaroslavl Oblast",
    "Адыгейская АО": "Adyghe AO", "Горно-Алтайская АО": "Gorno-Altai AO",
    "Еврейская АО": "Jewish AO", "Карачаево-Черкесская АО": "Karachay-Cherkess AO",
    "Хакасская АО": "Khakass AO", "Ненецкий АО": "Nenets AO",
    "Ханты-Мансийский АО": "Khanty-Mansi AO", "Чукотский АО": "Chukotka AO",
    "Ямало-Ненецкий АО": "Yamalo-Nenets AO",
    "Москва": "Moscow", "Ленинград": "Leningrad", "Крым": "Crimea", "Севастополь": "Sevastopol",
    # Каналы / Берлин
    "Зона Кильского канала": "Kiel Canal Zone",
    "Зона Панамского канала": "Panama Canal Zone",
    "Зона Суэцкого канала": "Suez Canal Zone",
    "Берлин — Советский сектор": "Berlin — Soviet Sector",
    "Берлин — Американский сектор": "Berlin — American Sector",
    "Берлин — Британский сектор": "Berlin — British Sector",
    "Берлин — Французский сектор": "Berlin — French Sector",
    # Азия
    "Порт-Артур (Квантунская обл.)": "Port Arthur (Kwantung Leased Territory)",
    "Туратам": "Tyuratam", "Кашмир": "Kashmir", "Спратли": "Spratly Islands",
    "Бахрейн": "Bahrain", "Бруней": "Brunei",
    "Бутан (план: 'каждый в отдельный регион')": "Bhutan",
    "Гонконг (отдельный iso_a2='HK', не входил в список стран)": "Hong Kong",
    "Цейлон (план: 'каждый в отдельный регион')": "Ceylon",
    "Макао (отдельный iso_a2='MO', не входил в список стран)": "Macau",
    "Непал (план: 'каждый в отдельный регион')": "Nepal",
    "Катар": "Qatar", "Сингапур": "Singapore",
    "Восточный Тимор (Португальский Тимор)": "Portuguese Timor",
    # Северная Америка
    "Гуантанамо (военная база США)": "Guantanamo Bay (US Naval Base)",
    "Клипертон (Франция)": "Clipperton Island",
    "Антигуа и Барбуда": "Antigua and Barbuda", "Ангилья": "Anguilla", "Аруба": "Aruba",
    "Барбадос": "Barbados", "Бермуды": "Bermuda", "Багамы": "Bahamas",
    "Кюрасао": "Curaçao", "Доминика": "Dominica", "Гренада": "Grenada",
    "Гренландия": "Greenland", "Ямайка": "Jamaica", "Каймановы о-ва": "Cayman Islands",
    "Сент-Люсия": "Saint Lucia", "Монтсеррат": "Montserrat",
    "Сен-Пьер и Микелон": "Saint Pierre and Miquelon", "Пуэрто-Рико": "Puerto Rico",
    "Синт-Мартен": "Sint Maarten", "Тёркс и Кайкос": "Turks and Caicos Islands",
    "Сент-Винсент и Гренадины": "Saint Vincent and the Grenadines",
    "Виргинские о-ва (Брит.)": "British Virgin Islands",
    "Виргинские о-ва (США)": "United States Virgin Islands",
    # Африка
    "Сомалиленд": "Somaliland", "Коморы": "Comoros",
    "Западная Сахара (Испанская Сахара)": "Western Sahara (Spanish Sahara)",
    "Св. Елена, Вознесения и Тристан-да-Кунья": "Saint Helena, Ascension and Tristan da Cunha",
    "Брит. территория в Индийском океане (Чагос)": "British Indian Ocean Territory (Chagos)",
    "Уганда": "Uganda", "Гамбия": "Gambia",
    "Каир (Большой Каир)": "Cairo (Greater Cairo)", "Александрия": "Alexandria",
    "Дельта Нила (Нижний Египет)": "Nile Delta (Lower Egypt)",
    "Долина Нила (Верхний Египет)": "Nile Valley (Upper Egypt)",
    "Синай": "Sinai", "Матрух": "Matrouh", "Красное море": "Red Sea Governorate",
    "Новая Долина (Зап. пустыня)": "New Valley (Western Desert)",
    "Триполитания": "Tripolitania", "Киренаика": "Cyrenaica", "Феццан": "Fezzan",
    "Territoires du Sud (Сахара)": "Territoires du Sud (Deep Sahara)",
    "Territoires du Sud (кайма)": "Territoires du Sud (Saharan fringe)",
    # Океания
    "Новая Каледония": "New Caledonia", "Французская Полинезия": "French Polynesia",
    "Американское Самоа": "American Samoa", "Гуам": "Guam",
    "Северные Марианские о-ва": "Northern Mariana Islands", "О-ва Кука": "Cook Islands",
    "Ниуэ": "Niue", "О. Норфолк": "Norfolk Island", "О-ва Питкерн": "Pitcairn Islands",
    "Малые отдалённые о-ва США (Уэйк/Мидуэй/Джонстон)": "United States Minor Outlying Islands (Wake/Midway/Johnston)",
    "Уоллис и Футуна": "Wallis and Futuna", "Токелау": "Tokelau", "Науру": "Nauru",
    "Тувалу": "Tuvalu", "Кирибати": "Kiribati", "Маршалловы Острова": "Marshall Islands",
    "Тонга": "Tonga",
    # Антарктида
    "Земля Мэри Бэрд (незаявленный сектор)": "Marie Byrd Land (unclaimed sector)",
    "Антарктический полуостров (споры Брит./Чили/Арг.)": "Antarctic Peninsula (UK/Chile/Argentina overlapping claims)",
    "Земля Королевы Мод (Норвегия)": "Queen Maud Land (Norway)",
    "Австралийский сектор (запад)": "Australian Sector (West)",
    "Земля Адели (Франция)": "Adélie Land (France)",
    "Австралийский сектор (восток)": "Australian Sector (East)",
    "Зависимость Росса (Новая Зеландия)": "Ross Dependency (New Zealand)",
    # Моря
    "Юж. Атлантика — Американский сектор": "South Atlantic — American Sector",
    "Юж. Атлантика — Африканский сектор": "South Atlantic — African Sector",
    "Юж. Пасифика — Австралийский сектор": "South Pacific — Australian Sector",
    "Юж. Пасифика — Центрально-Западный сектор": "South Pacific — Central-Western Sector",
    "Юж. Пасифика — Полинезийский сектор": "South Pacific — Polynesian Sector",
    "Юж. Пасифика — Американский сектор": "South Pacific — American Sector",
    "Индийский океан — Африканский сектор": "Indian Ocean — African Sector",
    "Индийский океан — Центральный сектор": "Indian Ocean — Central Sector",
    "Индийский океан — Австрало-Азиатский сектор": "Indian Ocean — Australo-Asian Sector",
    "Сев. Пасифика — Азиатский сектор": "North Pacific — Asian Sector",
    "Сев. Пасифика — Центрально-Западный сектор": "North Pacific — Central-Western Sector",
    "Сев. Пасифика — Гавайский сектор": "North Pacific — Hawaiian Sector",
    "Сев. Пасифика — Американский сектор": "North Pacific — American Sector",
    "Сев. Атлантика — Американский сектор": "North Atlantic — American Sector",
    "Сев. Атлантика — Центральный сектор": "North Atlantic — Central Sector",
    "Сев. Атлантика — Европейский сектор": "North Atlantic — European Sector",
    "Арктика — Американо-Тихоокеанский сектор": "Arctic — American-Pacific Sector",
    "Арктика — Евро-Атлантический сектор": "Arctic — Euro-Atlantic Sector",
    # Озёра
    "Каспийское море": "Caspian Sea", "Озеро Верхнее": "Lake Superior",
    "Озеро Мичиган-Гурон": "Lake Michigan-Huron", "Озеро Эри": "Lake Erie",
    "Озеро Онтарио": "Lake Ontario", "Байкал": "Lake Baikal", "Ладога": "Lake Ladoga",
    "Виктория": "Lake Victoria", "Танганьика": "Lake Tanganyika", "Мёртвое море": "Dead Sea",
    "Аральское море (1946, полный размер)": "Aral Sea (1946, full historical extent)",
    "Кинерет (Галилейское море)": "Sea of Galilee",
}

ZONE_TRANSLATE = {"СССР": "USSR", "США": "USA", "Великобритания": "UK", "Франция": "France"}

DEBUG_FIELDS = ["merge_method", "source_adm1", "source_count", "note"]

with open(out("world_1946.geojson"), encoding='utf-8') as f:
    fc = json.load(f)

not_translated = []
for ft in fc['features']:
    props = ft['properties']
    name = props.get('name', '')

    # упрощаем названия земель Германии: убираем дублирующую зону из name
    # (она уже есть в occupation_zone_1946)
    if props.get('occupation_zone_1946') and ' (' in name:
        name = name.split(' (')[0]
        props['name'] = name

    if name in TRANSLATE:
        props['name'] = TRANSLATE[name]
        name = props['name']
    else:
        import re
        if re.search('[а-яА-ЯёЁ]', name):
            not_translated.append((props.get('region_id'), name))

    if 'occupation_zone_1946' in props:
        props['occupation_zone_1946'] = ZONE_TRANSLATE.get(props['occupation_zone_1946'], props['occupation_zone_1946'])

    sp = props.get('strategic_points')
    if sp:
        for item in sp:
            if item.get('name') == 'Нанкин':
                item['name'] = 'Nanjing'
                item['note'] = ("Capital of the Republic of China in 1946 "
                                 "(the city itself is not a separate ADM1 unit in modern data)")

    for field in DEBUG_FIELDS:
        props.pop(field, None)

with open(out("world_1946.geojson"), 'w', encoding='utf-8') as f:
    json.dump(fc, f, ensure_ascii=False)

print('Не переведено (нужно проверить):', len(not_translated))
for rid, name in not_translated:
    print(' ', rid, '|', name)
