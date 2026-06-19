/**
 * regionMappingV2.ts — Target-количество регионов для стран 1946
 * 
 * Определяет СКОЛЬКО регионов должна иметь каждая страна.
 * Группировка выполняется алгоритмически (по longitude).
 * Этот файл заменяет ручной маппинг.
 */

// ownerCountryId для каждой страны (исторический владелец в 1946)
export const ISO_TO_OWNER: Record<string, string> = {
  BEL: 'BEL', NLD: 'NED', LUX: 'LUX',
  DNK: 'DEN', NOR: 'NOR', SWE: 'SWE', FIN: 'FIN', ISL: 'ISL',
  PRT: 'PRT', ESP: 'ESP',
  CHE: 'SWI', AUT: 'AUT',
  HUN: 'HUN', POL: 'POL', CZE: 'CZE', SVK: 'CZE',
  ROU: 'ROU', BGR: 'BGR', GRC: 'GRE', ALB: 'ALB',
  SVN: 'YUG', HRV: 'YUG', BIH: 'YUG', SRB: 'YUG', MNE: 'YUG', MKD: 'YUG', XKX: 'YUG',
  GBR: 'UK', IRL: 'IRE',
  ITA: 'ITA',
  EST: 'USSR', LVA: 'USSR', LTU: 'USSR',
  FRA: 'FRA', DEU: 'Germany',
  USA: 'USA', CAN: 'CAN', AUS: 'AUS', NZL: 'NZL', ZAF: 'SAF',
  CHN: 'China', TWN: 'Taiwan', HKG: 'Taiwan', MAC: 'Taiwan',
  IND: 'IND', JPN: 'JPN', KOR: 'KOR', PRK: 'KOR',
  BRA: 'BRA', ARG: 'ARG', MEX: 'MEX', CHL: 'CHL',
  EGY: 'EGY', TUR: 'TUR', IRN: 'IRN', IRQ: 'IRQ', SAU: 'SAU',
  IDN: 'NED', PHL: 'USA', MMR: 'UK', VNM: 'FRA', THA: 'THA',
  MYS: 'UK', SGP: 'UK',
  // ... остальные в index.ts
};

// Целевое количество регионов для стран ЕВРОПЫ
export const EUROPE_TARGETS: Record<string, number> = {
  // Бенилюкс
  BEL: 5, NLD: 7, LUX: 1,
  // Скандинавия
  DNK: 4, NOR: 4, SWE: 5, FIN: 6, ISL: 1,
  // Пиринеи
  PRT: 6, ESP: 12,
  // Альпы
  CHE: 3, AUT: 9,
  // Центральная Европа
  HUN: 6, POL: 17, CZE: 22,
  // Балканы
  ROU: 6, BGR: 5, GRC: 14, ALB: 1,
  // Югославия
  SVN: 1, HRV: 2, BIH: 4, SRB: 7, MNE: 1, MKD: 1, XKX: 1,
  // Британия
  GBR: 21, IRL: 3,
  // Италия
  ITA: 11,
  // Балтия
  EST: 3, LVA: 3, LTU: 3,
};

// Региональные названия (русские) для групп
// Формат: { ISO: { номер_группы: [название_ru, название_en] } }
export const REGION_NAMES: Record<string, Record<number, [string, string]>> = {
  BEL: {
    0: ['Фландрия', 'Flanders'],
    1: ['Валлония', 'Wallonia'],
    2: ['Брюссель', 'Brussels'],
    3: ['Лимбург', 'Limburg'],
    4: ['Люксембург', 'Luxembourg'],
  },
  NLD: {
    0: ['Гронинген/Дренте', 'Groningen/Drenthe'],
    1: ['Оверэйссел/Флеволанд', 'Overijssel/Flevoland'],
    2: ['Гелдерланд', 'Gelderland'],
    3: ['Северный Брабант/Лимбург', 'North Brabant/Limburg'],
    4: ['Северная/Южная Голландия', 'North/South Holland'],
    5: ['Фрисландия', 'Friesland'],
    6: ['Утрехт/Зеландия', 'Utrecht/Zeeland'],
  },
  DNK: {
    0: ['Ютландия', 'Jutland'],
    1: ['Зеландия', 'Zealand'],
    2: ['Фарерские острова', 'Faroe Islands'],
    3: ['Гренландия', 'Greenland'],
  },
  NOR: {
    0: ['Северная Норвегия', 'Northern Norway'],
    1: ['Центральная Норвегия', 'Central Norway'],
    2: ['Южная Норвегия', 'Southern Norway'],
    3: ['Шпицберген', 'Svalbard'],
  },
  SWE: {
    0: ['Норрланд', 'Norrland'],
    1: ['Свеаланд', 'Svealand'],
    2: ['Гёталанд', 'Götaland'],
    3: ['Сконе', 'Scania'],
    4: ['Готланд', 'Gotland'],
  },
  FIN: {
    0: ['Лапландия', 'Lapland'],
    1: ['Северная Остроботния', 'Northern Ostrobothnia'],
    2: ['Западная Финляндия', 'Western Finland'],
    3: ['Восточная Финляндия', 'Eastern Finland'],
    4: ['Южная Финляндия', 'Southern Finland'],
    5: ['Аландские острова', 'Åland Islands'],
  },
  PRT: {
    0: ['Северная Португалия', 'Northern Portugal'],
    1: ['Центральная Португалия', 'Central Portugal'],
    2: ['Южная Португалия', 'Southern Portugal'],
    3: ['Лиссабон', 'Lisbon'],
    4: ['Азорские острова', 'Azores'],
    5: ['Мадейра', 'Madeira'],
  },
  ESP: {
    0: ['Мадрид', 'Madrid'],
    1: ['Кастилия-Леон', 'Castile and León'],
    2: ['Кастилия-Ла-Манча', 'Castile-La Mancha'],
    3: ['Андалусия', 'Andalusia'],
    4: ['Каталония', 'Catalonia'],
    5: ['Арагон', 'Aragon'],
    6: ['Валенсия', 'Valencia'],
    7: ['Галисия', 'Galicia'],
    8: ['Страна Басков', 'Basque Country'],
    9: ['Балеарские острова', 'Balearic Islands'],
    10: ['Канарские острова', 'Canary Islands'],
    11: ['Испанская Африка', 'Spanish Africa'],
  },
  CHE: {
    0: ['Немецкая Швейцария', 'German Switzerland'],
    1: ['Французская Швейцария', 'French Switzerland'],
    2: ['Итальянская Швейцария', 'Italian Switzerland'],
  },
  AUT: {
    0: ['Вена', 'Vienna'],
    1: ['Нижняя Австрия', 'Lower Austria'],
    2: ['Верхняя Австрия', 'Upper Austria'],
    3: ['Штирия', 'Styria'],
    4: ['Тироль', 'Tyrol'],
    5: ['Каринтия', 'Carinthia'],
    6: ['Зальцбург', 'Salzburg'],
    7: ['Бургенланд', 'Burgenland'],
    8: ['Форарльберг', 'Vorarlberg'],
  },
  HUN: {
    0: ['Будапешт', 'Budapest'],
    1: ['Северная Венгрия', 'Northern Hungary'],
    2: ['Восточная Венгрия', 'Eastern Hungary'],
    3: ['Южная Венгрия', 'Southern Hungary'],
    4: ['Западная Венгрия', 'Western Hungary'],
    5: ['Центральная Венгрия', 'Central Hungary'],
  },
  POL: {
    0: ['Варшава', 'Warsaw'],
    1: ['Северная Польша', 'Northern Poland'],
    2: ['Северо-Восточная Польша', 'North-Eastern Poland'],
    3: ['Центральная Польша', 'Central Poland'],
    4: ['Лодзь', 'Łódź'],
    5: ['Южная Польша', 'Southern Poland'],
    6: ['Силезия', 'Silesia'],
    7: ['Восточная Польша', 'Eastern Poland'],
    8: ['Западная Польша', 'Western Poland'],
    9: ['Померания', 'Pomerania'],
    10: ['Вармия-Мазуры', 'Warmia-Masuria'],
    11: ['Подлясье', 'Podlaskie'],
    12: ['Свентокшиское', 'Świętokrzyskie'],
    13: ['Люблин', 'Lublin'],
    14: ['Подкарпатье', 'Subcarpathia'],
    15: ['Малопольша', 'Lesser Poland'],
    16: ['Куявия', 'Kuyavia'],
  },
  ROU: {
    0: ['Бухарест', 'Bucharest'],
    1: ['Трансильвания', 'Transylvania'],
    2: ['Валахия', 'Wallachia'],
    3: ['Молдова', 'Moldavia'],
    4: ['Добруджа', 'Dobruja'],
    5: ['Банат', 'Banat'],
  },
  BGR: {
    0: ['София', 'Sofia'],
    1: ['Северная Болгария', 'Northern Bulgaria'],
    2: ['Восточная Болгария', 'Eastern Bulgaria'],
    3: ['Южная Болгария', 'Southern Bulgaria'],
    4: ['Пловдив', 'Plovdiv'],
  },
  GRC: {
    0: ['Аттика', 'Attica'],
    1: ['Центральная Греция', 'Central Greece'],
    2: ['Пелопоннес', 'Peloponnese'],
    3: ['Фессалия', 'Thessaly'],
    4: ['Эпир', 'Epirus'],
    5: ['Македония', 'Macedonia'],
    6: ['Фракия', 'Thrace'],
    7: ['Эгейские острова', 'Aegean Islands'],
    8: ['Ионические острова', 'Ionian Islands'],
    9: ['Крит', 'Crete'],
    10: ['Северные Эгейские острова', 'North Aegean'],
    11: ['Южные Эгейские острова', 'South Aegean'],
    12: ['Центральная Македония', 'Central Macedonia'],
    13: ['Западная Македония', 'Western Macedonia'],
  },
  ALB: {
    0: ['Албания', 'Albania'],
  },
  SVN: {
    0: ['Словения', 'Slovenia'],
  },
  HRV: {
    0: ['Загреб', 'Zagreb'],
    1: ['Далмация', 'Dalmatia'],
  },
  BIH: {
    0: ['Северная Босния', 'Northern Bosnia'],
    1: ['Центральная Босния', 'Central Bosnia'],
    2: ['Герцеговина', 'Herzegovina'],
    3: ['Восточная Босния', 'Eastern Bosnia'],
  },
  SRB: {
    0: ['Белград', 'Belgrade'],
    1: ['Северная Сербия', 'Northern Serbia'],
    2: ['Центральная Сербия', 'Central Serbia'],
    3: ['Южная Сербия', 'Southern Serbia'],
    4: ['Косово', 'Kosovo'],
    5: ['Воеводина', 'Vojvodina'],
    6: ['Санджак', 'Sandžak'],
  },
  MNE: {
    0: ['Черногория', 'Montenegro'],
  },
  MKD: {
    0: ['Македония', 'Macedonia'],
  },
  XKX: {
    0: ['Косово', 'Kosovo'],
  },
  IRL: {
    0: ['Ольстер', 'Ulster'],
    1: ['Манстер', 'Munster'],
    2: ['Ленстер', 'Leinster'],
  },
  EST: {
    0: ['Северная Эстония', 'Northern Estonia'],
    1: ['Южная Эстония', 'Southern Estonia'],
    2: ['Западная Эстония', 'Western Estonia'],
  },
  LVA: {
    0: ['Видземе', 'Vidzeme'],
    1: ['Латгале', 'Latgale'],
    2: ['Курземе', 'Kurzeme'],
  },
  LTU: {
    0: ['Аукштайтия', 'Aukštaitija'],
    1: ['Жемайтия', 'Samogitia'],
    2: ['Дзукия', 'Dzūkija'],
  },
};