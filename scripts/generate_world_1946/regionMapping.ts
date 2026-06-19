/**
 * regionMapping.ts — Жёсткий маппинг admin-1 кодов → целевые регионы
 * 
 * Каждая запись: { [targetId]: { name, nameEn, ownerCountryId, sources: string[] } }
 * 
 * Правила:
 * - targetId = ISO-AGG-{N} для агрегированных регионов
 * - Для одиночных регионов: targetId = sourceId
 * - Группировка по историческим/географическим областям
 */

export type RegionMappingEntry = {
  name: string;
  nameEn: string;
  ownerCountryId: string;
  sources: string[];
  kind?: 'land' | 'occupation_zone' | 'berlin_sector';
};

export type CountryMapping = Record<string, RegionMappingEntry>;

// ========================================================================
// 1. БЕНИЛЮКС
// ========================================================================

export const BEL_MAPPING: CountryMapping = {
  'BEL-FLANDERS': {
    name: 'Фландрия', nameEn: 'Flanders',
    ownerCountryId: 'BEL',
    sources: ['BEL-3479', 'BEL-3478', 'BEL-3480', 'BEL-3', 'BEL-3475'],
  },
  'BEL-WALLONIA': {
    name: 'Валлония', nameEn: 'Wallonia',
    ownerCountryId: 'BEL',
    sources: ['BEL-2', 'BEL-3476', 'BEL-3477', 'BEL-3481', 'BEL-3482'],
  },
  'BEL-BRUSSELS': {
    name: 'Брюссель', nameEn: 'Brussels',
    ownerCountryId: 'BEL',
    sources: ['BEL-3474'],
  },
  'BEL-LIEGE': {
    name: 'Льеж', nameEn: 'Liège',
    ownerCountryId: 'BEL',
    sources: ['BEL-3481'],
  },
  'BEL-LUXEMBOURG': {
    name: 'Люксембург (Бельгийский)', nameEn: 'Luxembourg (Belgian)',
    ownerCountryId: 'BEL',
    sources: ['BEL-3477'],
  },
};

export const NLD_MAPPING: CountryMapping = {
  'NLD-NORTH': {
    name: 'Северные Нидерланды', nameEn: 'Northern Netherlands',
    ownerCountryId: 'NED',
    sources: ['NLD-2048', 'NLD-2049', 'NLD-3184', 'NLD-2969'],
  },
  'NLD-EAST': {
    name: 'Восточные Нидерланды', nameEn: 'Eastern Netherlands',
    ownerCountryId: 'NED',
    sources: ['NLD-12920', 'NLD-12923', 'NLD-2968', 'NLD-2966'],
  },
  'NLD-WEST': {
    name: 'Западные Нидерланды', nameEn: 'Western Netherlands',
    ownerCountryId: 'NED',
    sources: ['NLD-2972', 'NLD-2971', 'NLD-2973', 'NLD-2974'],
  },
  'NLD-SOUTH': {
    name: 'Южные Нидерланды', nameEn: 'Southern Netherlands',
    ownerCountryId: 'NED',
    sources: ['NLD-2975', 'NLD-2976', 'NLD-2977'],
  },
  'NLD-RANDSTAD': {
    name: 'Рандстад', nameEn: 'Randstad',
    ownerCountryId: 'NED',
    sources: ['NLD-2970', 'NLD-2967'],
  },
  'NLD-FRIESLAND': {
    name: 'Фрисландия', nameEn: 'Friesland',
    ownerCountryId: 'NED',
    sources: ['NLD-3184'],
  },
  'NLD-URBAN': {
    name: 'Утрехт', nameEn: 'Utrecht',
    ownerCountryId: 'NED',
    sources: ['NLD-2973'],
  },
};

export const LUX_MAPPING: CountryMapping = {
  'LUX-1': {
    name: 'Люксембург', nameEn: 'Luxembourg',
    ownerCountryId: 'LUX',
    sources: ['LUX-2962'],
  },
};

// ========================================================================
// 2. СКАНДИНАВИЯ
// ========================================================================

export const DNK_MAPPING: CountryMapping = {
  'DNK-JUTLAND': {
    name: 'Ютландия', nameEn: 'Jutland',
    ownerCountryId: 'DEN',
    sources: ['DNK-3417', 'DNK-3416', 'DNK-3418'],
  },
  'DNK-ZEALAND': {
    name: 'Зеландия', nameEn: 'Zealand',
    ownerCountryId: 'DEN',
    sources: ['DNK-3420', 'DNK-3419'],
  },
  'DNK-FAROE': {
    name: 'Фарерские острова', nameEn: 'Faroe Islands',
    ownerCountryId: 'DEN',
    sources: ['FRO'],
  },
  'DNK-GREENLAND': {
    name: 'Гренландия', nameEn: 'Greenland',
    ownerCountryId: 'DEN',
    sources: ['GRL'],
  },
};

export const NOR_MAPPING: CountryMapping = {
  'NOR-NORTH': {
    name: 'Северная Норвегия', nameEn: 'Northern Norway',
    ownerCountryId: 'NOR',
    sources: ['NOR-2245', 'NOR-2246', 'NOR-2247', 'NOR-2248'],
  },
  'NOR-CENTRAL': {
    name: 'Центральная Норвегия', nameEn: 'Central Norway',
    ownerCountryId: 'NOR',
    sources: ['NOR-2249', 'NOR-2250'],
  },
  'NOR-SOUTH': {
    name: 'Южная Норвегия', nameEn: 'Southern Norway',
    ownerCountryId: 'NOR',
    sources: ['NOR-2251', 'NOR-2252', 'NOR-2253', 'NOR-2254', 'NOR-2255', 'NOR-2256', 'NOR-2257'],
  },
  'NOR-SVALBARD': {
    name: 'Шпицберген', nameEn: 'Svalbard',
    ownerCountryId: 'NOR',
    sources: ['SJM'],
  },
};

export const SWE_MAPPING: CountryMapping = {
  'SWE-NORRLAND': {
    name: 'Норрланд', nameEn: 'Norrland',
    ownerCountryId: 'SWE',
    sources: ['SWE-5000', 'SWE-5001', 'SWE-5002', 'SWE-5003', 'SWE-5004'],
  },
  'SWE-SVEALAND': {
    name: 'Свеаланд', nameEn: 'Svealand',
    ownerCountryId: 'SWE',
    sources: ['SWE-5005', 'SWE-5006', 'SWE-5007', 'SWE-5008'],
  },
  'SWE-GOTALAND': {
    name: 'Гёталанд', nameEn: 'Götaland',
    ownerCountryId: 'SWE',
    sources: ['SWE-5009', 'SWE-5010', 'SWE-5011', 'SWE-5012'],
  },
  'SWE-SKANE': {
    name: 'Сконе', nameEn: 'Skåne',
    ownerCountryId: 'SWE',
    sources: ['SWE-5013'],
  },
  'SWE-GOTLAND': {
    name: 'Готланд', nameEn: 'Gotland',
    ownerCountryId: 'SWE',
    sources: ['SWE-5014'],
  },
};

export const FIN_MAPPING: CountryMapping = {
  'FIN-LAPLAND': {
    name: 'Лапландия', nameEn: 'Lapland',
    ownerCountryId: 'FIN',
    sources: ['FIN-3176'],
  },
  'FIN-OULU': {
    name: 'Оулу', nameEn: 'Oulu',
    ownerCountryId: 'FIN',
    sources: ['FIN-3180', 'FIN-3179'],
  },
  'FIN-WEST': {
    name: 'Западная Финляндия', nameEn: 'Western Finland',
    ownerCountryId: 'FIN',
    sources: ['FIN-3182', 'FIN-3181', 'FIN-3191', 'FIN-3192'],
  },
  'FIN-EAST': {
    name: 'Восточная Финляндия', nameEn: 'Eastern Finland',
    ownerCountryId: 'FIN',
    sources: ['FIN-3190', 'FIN-3178', 'FIN-3177'],
  },
  'FIN-SOUTH': {
    name: 'Южная Финляндия', nameEn: 'Southern Finland',
    ownerCountryId: 'FIN',
    sources: ['FIN-3193', 'FIN-3188', 'FIN-3187'],
  },
  'FIN-ALAND': {
    name: 'Аландские острова', nameEn: 'Åland Islands',
    ownerCountryId: 'FIN',
    sources: ['FI-ALAND'],
  },
};

export const ISL_MAPPING: CountryMapping = {
  'ISL-1': {
    name: 'Исландия', nameEn: 'Iceland',
    ownerCountryId: 'ISL',
    sources: ['ISL'],
  },
};

// ========================================================================
// 3. ПИРЕНЕЙСКИЙ ПОЛУОСТРОВ
// ========================================================================

export const PRT_MAPPING: CountryMapping = {
  'PRT-NORTH': {
    name: 'Северная Португалия', nameEn: 'Northern Portugal',
    ownerCountryId: 'PRT',
    sources: ['PRT-20037', 'PRT-20041', 'PRT-20033'],
  },
  'PRT-CENTRAL': {
    name: 'Центральная Португалия', nameEn: 'Central Portugal',
    ownerCountryId: 'PRT',
    sources: ['PRT-20035', 'PRT-20036', 'PRT-20038'],
  },
  'PRT-SOUTH': {
    name: 'Южная Португалия', nameEn: 'Southern Portugal',
    ownerCountryId: 'PRT',
    sources: ['PRT-20039', 'PRT-20040'],
  },
  'PRT-LISBON': {
    name: 'Лиссабон', nameEn: 'Lisbon',
    ownerCountryId: 'PRT',
    sources: ['PRT-20034'],
  },
  'PRT-AZORES': {
    name: 'Азорские острова', nameEn: 'Azores',
    ownerCountryId: 'PRT',
    sources: ['PRT-AZORES'],
  },
  'PRT-MADEIRA': {
    name: 'Мадейра', nameEn: 'Madeira',
    ownerCountryId: 'PRT',
    sources: ['PRT-MADEIRA'],
  },
};

export const ESP_MAPPING: CountryMapping = {
  'ESP-MADRID': {
    name: 'Мадрид', nameEn: 'Madrid',
    ownerCountryId: 'ESP',
    sources: ['ESP-5833'],
  },
  'ESP-CASTILE-LEON': {
    name: 'Кастилия-Леон', nameEn: 'Castile and León',
    ownerCountryId: 'ESP',
    sources: ['ESP-5839', 'ESP-5845', 'ESP-5850', 'ESP-5852', 'ESP-5830', 'ESP-5810', 'ESP-5806', 'ESP-5841', 'ESP-5802'],
  },
  'ESP-CASTILE-LAMANCHA': {
    name: 'Кастилия-Ла-Манча', nameEn: 'Castile-La Mancha',
    ownerCountryId: 'ESP',
    sources: ['ESP-5848', 'ESP-5818', 'ESP-5816', 'ESP-5822', 'ESP-5843'],
  },
  'ESP-ANDALUSIA': {
    name: 'Андалусия', nameEn: 'Andalusia',
    ownerCountryId: 'ESP',
    sources: ['ESP-5807', 'ESP-5812', 'ESP-5811', 'ESP-5824', 'ESP-5804', 'ESP-5821', 'ESP-5834', 'ESP-5844', 'ESP-5826', 'ESP-5817'],
  },
  'ESP-CATALONIA': {
    name: 'Каталония', nameEn: 'Catalonia',
    ownerCountryId: 'ESP',
    sources: ['ESP-5809', 'ESP-5820', 'ESP-5831', 'ESP-5846', 'ESP-5814', 'ESP-5849'],
  },
  'ESP-ARAGON': {
    name: 'Арагон', nameEn: 'Aragon',
    ownerCountryId: 'ESP',
    sources: ['ESP-5825', 'ESP-5853', 'ESP-5847'],
  },
  'ESP-SOUTH': {
    name: 'Валенсия', nameEn: 'Valencia',
    ownerCountryId: 'ESP',
    sources: ['ESP-5849', 'ESP-5803', 'ESP-5836'],
  },
  'ESP-NORTHWEST': {
    name: 'Галисия', nameEn: 'Galicia',
    ownerCountryId: 'ESP',
    sources: ['ESP-5827', 'ESP-5832', 'ESP-5840', 'ESP-5805', 'ESP-5813'],
  },
  'ESP-BASQUE': {
    name: 'Страна Басков', nameEn: 'Basque Country',
    ownerCountryId: 'ESP',
    sources: ['ESP-5823', 'ESP-5851', 'ESP-5801', 'ESP-5837', 'ESP-5828'],
  },
  'ESP-BALEARES': {
    name: 'Балеарские острова', nameEn: 'Balearic Islands',
    ownerCountryId: 'ESP',
    sources: ['ESP-5808'],
  },
  'ESP-CANARIAS': {
    name: 'Канарские острова', nameEn: 'Canary Islands',
    ownerCountryId: 'ESP',
    sources: ['ESP-5842', 'ESP-5829'],
  },
  'ESP-AFRICA': {
    name: 'Испанская Африка', nameEn: 'Spanish Africa',
    ownerCountryId: 'ESP',
    sources: ['ESP-5815', 'ESP-5835'],
  },
};

// ========================================================================
// 4. АЛЬПЫ
// ========================================================================

export const CHE_MAPPING: CountryMapping = {
  'CHE-GERMAN': {
    name: 'Немецкая Швейцария', nameEn: 'German Switzerland',
    ownerCountryId: 'SWI',
    sources: ['CHE-165', 'CHE-170', 'CHE-171', 'CHE-174', 'CHE-176', 'CHE-162', 'CHE-3425', 'CHE-3423', 'CHE-167', 'CHE-3426', 'CHE-163', 'CHE-177', 'CHE-175', 'CHE-173', 'CHE-169', 'CHE-164', 'CHE-3427', 'CHE-166', 'CHE-3473'],
  },
  'CHE-FRENCH': {
    name: 'Французская Швейцария', nameEn: 'French Switzerland',
    ownerCountryId: 'SWI',
    sources: ['CHE-160', 'CHE-159', 'CHE-3422', 'CHE-161', 'CHE-3424', 'CHE-3421'],
  },
  'CHE-ITALIAN': {
    name: 'Итальянская Швейцария', nameEn: 'Italian Switzerland',
    ownerCountryId: 'SWI',
    sources: ['CHE-168'],
  },
};

export const AUT_MAPPING: CountryMapping = {
  'AUT-WIEN': {
    name: 'Вена', nameEn: 'Vienna',
    ownerCountryId: 'AUT',
    sources: ['AUT-2331'],
  },
  'AUT-LOWER': {
    name: 'Нижняя Австрия', nameEn: 'Lower Austria',
    ownerCountryId: 'AUT',
    sources: ['AUT-2330'],
  },
  'AUT-UPPER': {
    name: 'Верхняя Австрия', nameEn: 'Upper Austria',
    ownerCountryId: 'AUT',
    sources: ['AUT-2326'],
  },
  'AUT-STYRIA': {
    name: 'Штирия', nameEn: 'Styria',
    ownerCountryId: 'AUT',
    sources: ['AUT-2323'],
  },
  'AUT-TYROL': {
    name: 'Тироль', nameEn: 'Tyrol',
    ownerCountryId: 'AUT',
    sources: ['AUT-2329'],
  },
  'AUT-CARINTHIA': {
    name: 'Каринтия', nameEn: 'Carinthia',
    ownerCountryId: 'AUT',
    sources: ['AUT-2325'],
  },
  'AUT-SALZBURG': {
    name: 'Зальцбург', nameEn: 'Salzburg',
    ownerCountryId: 'AUT',
    sources: ['AUT-2327'],
  },
  'AUT-BURGENLAND': {
    name: 'Бургенланд', nameEn: 'Burgenland',
    ownerCountryId: 'AUT',
    sources: ['AUT-2322'],
  },
  'AUT-VORARLBERG': {
    name: 'Форарльберг', nameEn: 'Vorarlberg',
    ownerCountryId: 'AUT',
    sources: ['AUT-2320'],
  },
};

// ========================================================================
// 5. ЦЕНТРАЛЬНАЯ ЕВРОПА
// ========================================================================

export const HUN_MAPPING: CountryMapping = {
  'HUN-BUDAPEST': {
    name: 'Будапешт', nameEn: 'Budapest',
    ownerCountryId: 'HUN',
    sources: ['HUN-2746'],
  },
  'HUN-NORTH': {
    name: 'Северная Венгрия', nameEn: 'Northern Hungary',
    ownerCountryId: 'HUN',
    sources: ['HUN-2747', 'HUN-2748', 'HUN-2749'],
  },
  'HUN-EAST': {
    name: 'Восточная Венгрия', nameEn: 'Eastern Hungary',
    ownerCountryId: 'HUN',
    sources: ['HUN-2750', 'HUN-2751', 'HUN-2752'],
  },
  'HUN-SOUTH': {
    name: 'Южная Венгрия', nameEn: 'Southern Hungary',
    ownerCountryId: 'HUN',
    sources: ['HUN-2753', 'HUN-2754', 'HUN-2755'],
  },
  'HUN-WEST': {
    name: 'Западная Венгрия', nameEn: 'Western Hungary',
    ownerCountryId: 'HUN',
    sources: ['HUN-2756', 'HUN-2757'],
  },
  'HUN-CENTRAL': {
    name: 'Центральная Венгрия', nameEn: 'Central Hungary',
    ownerCountryId: 'HUN',
    sources: ['HUN-2758'],
  },
};

export const POL_MAPPING: CountryMapping = {
  'POL-WARSAW': {
    name: 'Варшава', nameEn: 'Warsaw',
    ownerCountryId: 'POL',
    sources: ['POL-2579'],
  },
  'POL-NORTH': {
    name: 'Северная Польша', nameEn: 'Northern Poland',
    ownerCountryId: 'POL',
    sources: ['POL-2575', 'POL-2576', 'POL-2577'],
  },
  'POL-CENTRAL': {
    name: 'Центральная Польша', nameEn: 'Central Poland',
    ownerCountryId: 'POL',
    sources: ['POL-2578', 'POL-2580', 'POL-2581', 'POL-2582'],
  },
  'POL-SOUTH': {
    name: 'Южная Польша', nameEn: 'Southern Poland',
    ownerCountryId: 'POL',
    sources: ['POL-2583', 'POL-2584', 'POL-2585'],
  },
  'POL-EAST': {
    name: 'Восточная Польша', nameEn: 'Eastern Poland',
    ownerCountryId: 'POL',
    sources: ['POL-2586', 'POL-2587', 'POL-2588'],
  },
  // Keeping original 16 voivodeships would require all codes - use regional grouping from 1946
};

export const CZE_MAPPING: CountryMapping = {
  'CZE-BOHEMIA': {
    name: 'Чехия', nameEn: 'Bohemia',
    ownerCountryId: 'CZE',
    sources: ['CZE'],
  },
  'CZE-SLOVAKIA': {
    name: 'Словакия', nameEn: 'Slovakia',
    ownerCountryId: 'CZE',
    sources: ['SVK'],
  },
};

// ========================================================================
// 6. БАЛКАНЫ
// ========================================================================

export const ROU_MAPPING: CountryMapping = {
  'ROU-BUCHAREST': {
    name: 'Бухарест', nameEn: 'Bucharest',
    ownerCountryId: 'ROU',
    sources: ['ROU-2927'],
  },
  'ROU-TRANSYLVANIA': {
    name: 'Трансильвания', nameEn: 'Transylvania',
    ownerCountryId: 'ROU',
    sources: ['ROU-2905', 'ROU-2906', 'ROU-2907', 'ROU-2908', 'ROU-2909', 'ROU-2910'],
  },
  'ROU-WALLACHIA': {
    name: 'Валахия', nameEn: 'Wallachia',
    ownerCountryId: 'ROU',
    sources: ['ROU-2911', 'ROU-2912', 'ROU-2913', 'ROU-2914', 'ROU-2915'],
  },
  'ROU-MOLDAVIA': {
    name: 'Молдова (Румынская)', nameEn: 'Moldavia',
    ownerCountryId: 'ROU',
    sources: ['ROU-2916', 'ROU-2917', 'ROU-2918', 'ROU-2919'],
  },
  'ROU-DOBRUJA': {
    name: 'Добруджа', nameEn: 'Dobruja',
    ownerCountryId: 'ROU',
    sources: ['ROU-2920', 'ROU-2921'],
  },
  'ROU-BANAT': {
    name: 'Банат', nameEn: 'Banat',
    ownerCountryId: 'ROU',
    sources: ['ROU-2922', 'ROU-2923'],
  },
};

export const BGR_MAPPING: CountryMapping = {
  'BGR-SOFIA': {
    name: 'София', nameEn: 'Sofia',
    ownerCountryId: 'BGR',
    sources: ['BGR-2243', 'BGR-2244', 'BGR-2245', 'BGR-2246', 'BGR-2247'],
  },
  'BGR-NORTH': {
    name: 'Северная Болгария', nameEn: 'Northern Bulgaria',
    ownerCountryId: 'BGR',
    sources: ['BGR-2253', 'BGR-2250', 'BGR-2251', 'BGR-2248', 'BGR-2249', 'BGR-2258', 'BGR-2256', 'BGR-2257'],
  },
  'BGR-EAST': {
    name: 'Восточная Болгария', nameEn: 'Eastern Bulgaria',
    ownerCountryId: 'BGR',
    sources: ['BGR-2260', 'BGR-2254', 'BGR-2255', 'BGR-2261', 'BGR-2262', 'BGR-2259'],
  },
  'BGR-SOUTH': {
    name: 'Южная Болгария', nameEn: 'Southern Bulgaria',
    ownerCountryId: 'BGR',
    sources: ['BGR-2232', 'BGR-2237', 'BGR-2236', 'BGR-2235', 'BGR-2233', 'BGR-2231', 'BGR-2234', 'BGR-3002'],
  },
};

export const GRC_MAPPING: CountryMapping = {
  'GRC-MAINLAND': {
    name: 'Материковая Греция', nameEn: 'Mainland Greece',
    ownerCountryId: 'GRE',
    sources: ['GRC'],
  },
  'GRC-ISLANDS': {
    name: 'Греческие острова', nameEn: 'Greek Islands',
    ownerCountryId: 'GRE',
    sources: ['GRC-CRETE', 'GRC-CYCLADES'],
  },
};

export const ALB_MAPPING: CountryMapping = {
  'ALB-1': {
    name: 'Албания', nameEn: 'Albania',
    ownerCountryId: 'ALB',
    sources: ['ALB'],
  },
};

// ========================================================================
// 7. ЮГОСЛАВИЯ (1946)
// ========================================================================

export const SVN_MAPPING: CountryMapping = {
  'SVN-1': {
    name: 'Словения', nameEn: 'Slovenia',
    ownerCountryId: 'YUG',
    sources: ['SVN'],
  },
};

export const HRV_MAPPING: CountryMapping = {
  'HRV-ZAGREB': {
    name: 'Загреб', nameEn: 'Zagreb',
    ownerCountryId: 'YUG',
    sources: ['HRV'],
  },
  'HRV-DALMATIA': {
    name: 'Далмация', nameEn: 'Dalmatia',
    ownerCountryId: 'YUG',
    sources: ['HRV-DALMATIA'],
  },
};

export const BIH_MAPPING: CountryMapping = {
  'BIH-NORTH': {
    name: 'Северная Босния', nameEn: 'Northern Bosnia',
    ownerCountryId: 'YUG',
    sources: ['BIH-2225', 'BIH-4802', 'BIH-4801', 'BIH-3153', 'BIH-4803', 'BIH-4804', 'BIH-2224'],
  },
  'BIH-CENTRAL': {
    name: 'Центральная Босния', nameEn: 'Central Bosnia',
    ownerCountryId: 'YUG',
    sources: ['BIH-2226', 'BIH-2889', 'BIH-2887', 'BIH-2890', 'BIH-2891', 'BIH-4806'],
  },
  'BIH-HERZEGOVINA': {
    name: 'Герцеговина', nameEn: 'Herzegovina',
    ownerCountryId: 'YUG',
    sources: ['BIH-2228', 'BIH-4808', 'BIH-2227'],
  },
  'BIH-EAST': {
    name: 'Восточная Босния', nameEn: 'Eastern Bosnia',
    ownerCountryId: 'YUG',
    sources: ['BIH-4807', 'BIH-4805'],
  },
};

export const SRB_MAPPING: CountryMapping = {
  'SRB-BELGRADE': {
    name: 'Белград', nameEn: 'Belgrade',
    ownerCountryId: 'YUG',
    sources: ['SRB-2148'],
  },
  'SRB-NORTH': {
    name: 'Северная Сербия', nameEn: 'Northern Serbia',
    ownerCountryId: 'YUG',
    sources: ['SRB-2145', 'SRB-2146', 'SRB-2147'],
  },
  'SRB-CENTRAL': {
    name: 'Центральная Сербия', nameEn: 'Central Serbia',
    ownerCountryId: 'YUG',
    sources: ['SRB-2149', 'SRB-2150', 'SRB-2151'],
  },
  'SRB-SOUTH': {
    name: 'Южная Сербия', nameEn: 'Southern Serbia',
    ownerCountryId: 'YUG',
    sources: ['SRB-2152', 'SRB-2153', 'SRB-2154'],
  },
  'SRB-KOSOVO': {
    name: 'Косово', nameEn: 'Kosovo',
    ownerCountryId: 'YUG',
    sources: ['XKX'],
  },
  'SRB-VOJVODINA': {
    name: 'Воеводина', nameEn: 'Vojvodina',
    ownerCountryId: 'YUG',
    sources: ['SRB-VOJVODINA'],
  },
  'SRB-SANDZAK': {
    name: 'Санджак', nameEn: 'Sandžak',
    ownerCountryId: 'YUG',
    sources: ['SRB-SANDZAK'],
  },
};

export const MNE_MAPPING: CountryMapping = {
  'MNE-1': {
    name: 'Черногория', nameEn: 'Montenegro',
    ownerCountryId: 'YUG',
    sources: ['MNE'],
  },
};

export const MKD_MAPPING: CountryMapping = {
  'MKD-1': {
    name: 'Македония', nameEn: 'Macedonia',
    ownerCountryId: 'YUG',
    sources: ['MKD'],
  },
};

// ========================================================================
// 8. БРИТАНИЯ И ИРЛАНДИЯ
// ========================================================================

export const GBR_MAPPING: CountryMapping = {
  'GBR-LONDON': {
    name: 'Лондон', nameEn: 'London',
    ownerCountryId: 'UK',
    sources: ['GBR-LONDON'],
  },
  'GBR-SE': {
    name: 'Юго-Восточная Англия', nameEn: 'South East England',
    ownerCountryId: 'UK',
    sources: ['GBR-SE'],
  },
  'GBR-SW': {
    name: 'Юго-Западная Англия', nameEn: 'South West England',
    ownerCountryId: 'UK',
    sources: ['GBR-SW'],
  },
  'GBR-EE': {
    name: 'Восточная Англия', nameEn: 'Eastern England',
    ownerCountryId: 'UK',
    sources: ['GBR-EE'],
  },
  'GBR-EAST-MID': {
    name: 'Восточный Мидленд', nameEn: 'East Midlands',
    ownerCountryId: 'UK',
    sources: ['GBR-EAST-MID'],
  },
  'GBR-WEST-MID': {
    name: 'Западный Мидленд', nameEn: 'West Midlands',
    ownerCountryId: 'UK',
    sources: ['GBR-WEST-MID'],
  },
  'GBR-YORKSHIRE': {
    name: 'Йоркшир', nameEn: 'Yorkshire',
    ownerCountryId: 'UK',
    sources: ['GBR-YORKSHIRE'],
  },
  'GBR-NW': {
    name: 'Северо-Западная Англия', nameEn: 'North West England',
    ownerCountryId: 'UK',
    sources: ['GBR-NW'],
  },
  'GBR-NE': {
    name: 'Северо-Восточная Англия', nameEn: 'North East England',
    ownerCountryId: 'UK',
    sources: ['GBR-NE'],
  },
  'GBR-SCOTLAND-HIGH': {
    name: 'Шотландское нагорье', nameEn: 'Scottish Highlands',
    ownerCountryId: 'UK',
    sources: ['GBR-SCOTLAND-HIGH'],
  },
  'GBR-SCOTLAND-CENTRAL': {
    name: 'Центральная Шотландия', nameEn: 'Central Scotland',
    ownerCountryId: 'UK',
    sources: ['GBR-SCOTLAND-CENTRAL'],
  },
  'GBR-SCOTLAND-SOUTH': {
    name: 'Южная Шотландия', nameEn: 'Southern Scotland',
    ownerCountryId: 'UK',
    sources: ['GBR-SCOTLAND-SOUTH'],
  },
  'GBR-WALES-NORTH': {
    name: 'Северный Уэльс', nameEn: 'North Wales',
    ownerCountryId: 'UK',
    sources: ['GBR-WALES-NORTH'],
  },
  'GBR-WALES-SOUTH': {
    name: 'Южный Уэльс', nameEn: 'South Wales',
    ownerCountryId: 'UK',
    sources: ['GBR-WALES-SOUTH'],
  },
  'GBR-NI-EAST': {
    name: 'Восточная Северная Ирландия', nameEn: 'Eastern Northern Ireland',
    ownerCountryId: 'UK',
    sources: ['GBR-NI-EAST'],
  },
  'GBR-NI-WEST': {
    name: 'Западная Северная Ирландия', nameEn: 'Western Northern Ireland',
    ownerCountryId: 'UK',
    sources: ['GBR-NI-WEST'],
  },
  'GBR-CORNWALL': {
    name: 'Корнуолл', nameEn: 'Cornwall',
    ownerCountryId: 'UK',
    sources: ['GBR-CORNWALL'],
  },
  'GBR-KENT': {
    name: 'Кент', nameEn: 'Kent',
    ownerCountryId: 'UK',
    sources: ['GBR-KENT'],
  },
  'GBR-ISLES': {
    name: 'Острова', nameEn: 'Islands',
    ownerCountryId: 'UK',
    sources: ['GBR-ISLES'],
  },
  'GBR-GIBRALTAR': {
    name: 'Гибралтар', nameEn: 'Gibraltar',
    ownerCountryId: 'UK',
    sources: ['GIB'],
  },
};

export const IRL_MAPPING: CountryMapping = {
  'IRL-ULSTER': {
    name: 'Ольстер', nameEn: 'Ulster',
    ownerCountryId: 'IRE',
    sources: ['IRL-ULSTER'],
  },
  'IRL-MUNSTER': {
    name: 'Манстер', nameEn: 'Munster',
    ownerCountryId: 'IRE',
    sources: ['IRL-MUNSTER'],
  },
  'IRL-LEINSTER': {
    name: 'Ленстер', nameEn: 'Leinster',
    ownerCountryId: 'IRE',
    sources: ['IRL-LEINSTER'],
  },
};

// ========================================================================
// 9. ИТАЛИЯ
// ========================================================================

export const ITA_MAPPING: CountryMapping = {
  'ITA-ROME': {
    name: 'Рим', nameEn: 'Rome',
    ownerCountryId: 'ITA',
    sources: ['ITA-ROME'],
  },
  'ITA-NORTH-WEST': {
    name: 'Северо-Западная Италия', nameEn: 'North-West Italy',
    ownerCountryId: 'ITA',
    sources: ['ITA-PIEDMONT', 'ITA-LOMBARDY', 'ITA-LIGURIA', 'ITA-AOSTA'],
  },
  'ITA-NORTH-EAST': {
    name: 'Северо-Восточная Италия', nameEn: 'North-East Italy',
    ownerCountryId: 'ITA',
    sources: ['ITA-VENETO', 'ITA-FRIULI', 'ITA-TRENTINO'],
  },
  'ITA-CENTRAL': {
    name: 'Центральная Италия', nameEn: 'Central Italy',
    ownerCountryId: 'ITA',
    sources: ['ITA-TUSCANY', 'ITA-UMBRIA', 'ITA-MARCHE'],
  },
  'ITA-EMILIA': {
    name: 'Эмилия-Романья', nameEn: 'Emilia-Romagna',
    ownerCountryId: 'ITA',
    sources: ['ITA-EMILIA'],
  },
  'ITA-SOUTH': {
    name: 'Южная Италия', nameEn: 'Southern Italy',
    ownerCountryId: 'ITA',
    sources: ['ITA-CAMPANIA', 'ITA-APULIA', 'ITA-BASILICATA', 'ITA-CALABRIA', 'ITA-MOLISE', 'ITA-ABRUZZO'],
  },
  'ITA-SICILY': {
    name: 'Сицилия', nameEn: 'Sicily',
    ownerCountryId: 'ITA',
    sources: ['ITA-SICILY'],
  },
  'ITA-SARDINIA': {
    name: 'Сардиния', nameEn: 'Sardinia',
    ownerCountryId: 'ITA',
    sources: ['ITA-SARDINIA'],
  },
  'ITA-TUSCANY': {
    name: 'Тоскана', nameEn: 'Tuscany',
    ownerCountryId: 'ITA',
    sources: ['ITA-TUSCANY'],
  },
  'ITA-LOMBARDY': {
    name: 'Ломбардия', nameEn: 'Lombardy',
    ownerCountryId: 'ITA',
    sources: ['ITA-LOMBARDY'],
  },
};

// ========================================================================
// 10. БАЛТИЯ
// ========================================================================

export const EST_MAPPING: CountryMapping = {
  'EST-NORTH': {
    name: 'Северная Эстония', nameEn: 'Northern Estonia',
    ownerCountryId: 'USSR',
    sources: ['EST-1654', 'EST-1658', 'EST-1655', 'EST-2348'],
  },
  'EST-SOUTH': {
    name: 'Южная Эстония', nameEn: 'Southern Estonia',
    ownerCountryId: 'USSR',
    sources: ['EST-2349', 'EST-2350', 'EST-1659', 'EST-2347', 'EST-2351'],
  },
  'EST-WEST': {
    name: 'Западная Эстония', nameEn: 'Western Estonia',
    ownerCountryId: 'USSR',
    sources: ['EST-2346', 'EST-1661', 'EST-1656', 'EST-2352', 'EST-1660'],
  },
};

export const LVA_MAPPING: CountryMapping = {
  'LVA-VIDZEME': {
    name: 'Видземе', nameEn: 'Vidzeme',
    ownerCountryId: 'USSR',
    sources: ['LVA-VIDZEME'],
  },
  'LVA-LATGALE': {
    name: 'Латгале', nameEn: 'Latgale',
    ownerCountryId: 'USSR',
    sources: ['LVA-LATGALE'],
  },
  'LVA-KURZEME': {
    name: 'Курземе', nameEn: 'Kurzeme',
    ownerCountryId: 'USSR',
    sources: ['LVA-KURZEME'],
  },
};

export const LTU_MAPPING: CountryMapping = {
  'LTU-AUKSTAITIJA': {
    name: 'Аукштайтия', nameEn: 'Aukštaitija',
    ownerCountryId: 'USSR',
    sources: ['LTU-AUKSTAITIJA'],
  },
  'LTU-SAMOGITIA': {
    name: 'Жемайтия', nameEn: 'Samogitia',
    ownerCountryId: 'USSR',
    sources: ['LTU-SAMOGITIA'],
  },
  'LTU-DZUKIJA': {
    name: 'Дзукия', nameEn: 'Dzūkija',
    ownerCountryId: 'USSR',
    sources: ['LTU-DZUKIJA'],
  },
};

// ========================================================================
// INDEX — список всех маппингов по ISO
// ========================================================================

export const ALL_MAPPINGS: Record<string, CountryMapping> = {
  BEL: BEL_MAPPING,
  NLD: NLD_MAPPING,
  LUX: LUX_MAPPING,
  DNK: DNK_MAPPING,
  NOR: NOR_MAPPING,
  SWE: SWE_MAPPING,
  FIN: FIN_MAPPING,
  ISL: ISL_MAPPING,
  PRT: PRT_MAPPING,
  ESP: ESP_MAPPING,
  CHE: CHE_MAPPING,
  AUT: AUT_MAPPING,
  HUN: HUN_MAPPING,
  POL: POL_MAPPING,
  CZE: CZE_MAPPING,
  ROU: ROU_MAPPING,
  BGR: BGR_MAPPING,
  GRC: GRC_MAPPING,
  ALB: ALB_MAPPING,
  SVN: SVN_MAPPING,
  HRV: HRV_MAPPING,
  BIH: BIH_MAPPING,
  SRB: SRB_MAPPING,
  MNE: MNE_MAPPING,
  MKD: MKD_MAPPING,
  GBR: GBR_MAPPING,
  IRL: IRL_MAPPING,
  ITA: ITA_MAPPING,
  EST: EST_MAPPING,
  LVA: LVA_MAPPING,
  LTU: LTU_MAPPING,
};