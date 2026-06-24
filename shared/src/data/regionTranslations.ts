/**
 * Система перевода названий регионов на русский язык
 * Использует данные из GeoJSON (name_ru) и дополнительные переводы
 */

/**
 * Словарь переводов регионов без русского названия в GeoJSON
 * Ключ: adm1_code или оригинальное английское название
 * Значение: русское название
 */
export const REGION_TRANSLATIONS: Record<string, string> = {
  // Германия - федеральные земли
  'DEU-1601': 'Саксония',
  'DEU-1600': 'Саксония-Анхальт',
  'DEU-3487': 'Бранденбург',
  'DEU-3488': 'Мекленбург-Передняя Померания',
  'DEU-1577': 'Тюрингия',
  'DEU-1591': 'Бавария',
  'DEU-1574': 'Гессен',
  'DEU-1575': 'Бремен',
  'DEU-1573': 'Баден-Вюртемберг',
  'DEU-1576': 'Нижняя Саксония',
  'DEU-1572': 'Северный Рейн-Вестфалия',
  'DEU-1579': 'Шлезвиг-Гольштейн',
  'DEU-1578': 'Гамбург',
  'DEU-1580': 'Рейнланд-Пфальц',
  'DEU-1581': 'Саар',
  'DEU-1599': 'Берлин',

  // Китай - провинции
  'CHN-1839': 'Хэйлунцзян',
  'CHN-1828': 'Цзилинь',
  'CHN-1813': 'Ляонин',
  'CHN-1838': 'Внутренняя Монголия',
  'CHN-1811': 'Хэбэй',
  'CHN-1805': 'Шаньси',
  'CHN-1804': 'Шэньси',
  'CHN-1803': 'Нинся',
  'CHN-1150': 'Ганьсу',
  'CHN-1814': 'Шаньдун',
  'CHN-1816': 'Тяньцзинь',
  'CHN-1155': 'Пекин',
  'CHN-1819': 'Шанхай',
  'CHN-1818': 'Цзянсу',
  'CHN-1820': 'Чжэцзян',
  'CHN-1178': 'Фуцзянь',
  'CHN-1179': 'Аньхой',
  'CHN-1812': 'Хэнань',
  'CHN-1807': 'Хубэй',
  'CHN-1808': 'Хунань',
  'CHN-1817': 'Цзянси',
  'CHN-1180': 'Гуандун',
  'CHN-1152': 'Гуанси',
  'CHN-1775': 'Хайнань',
  'CHN-1810': 'Юньнань',
  'CHN-1153': 'Гуйчжоу',
  'CHN-1809': 'Сычуань',
  'CHN-1154': 'Чунцин',
  'CHN-1756': 'Синьцзян',
  'CHN-1662': 'Тибет',
  'CHN-1151': 'Цинхай',

  // Дополнительные переводы для общих названий
  'Saxony': 'Саксония',
  'Saxony-Anhalt': 'Саксония-Анхальт',
  'Brandenburg': 'Бранденбург',
  'Mecklenburg-Vorpommern': 'Мекленбург-Передняя Померания',
  'Thuringia': 'Тюрингия',
  'Bavaria': 'Бавария',
  'Hesse': 'Гессен',
  'Bremen': 'Бремен',
  'Baden-Württemberg': 'Баден-Вюртемберг',
  'Lower Saxony': 'Нижняя Саксония',
  'North Rhine-Westphalia': 'Северный Рейн-Вестфалия',
  'Schleswig-Holstein': 'Шлезвиг-Гольштейн',
  'Hamburg': 'Гамбург',
  'Rhineland-Palatinate': 'Рейнланд-Пфальц',
  'Saarland': 'Саар',
  'Berlin': 'Берлин',
  'Heilongjiang': 'Хэйлунцзян',
  'Jilin': 'Цзилинь',
  'Liaoning': 'Ляонин',
  'Inner Mongolia': 'Внутренняя Монголия',
  'Hebei': 'Хэбэй',
  'Shanxi': 'Шаньси',
  'Shaanxi': 'Шэньси',
  'Ningxia': 'Нинся',
  'Gansu': 'Ганьсу',
  'Shandong': 'Шаньдун',
  'Tianjin': 'Тяньцзинь',
  'Beijing': 'Пекин',
  'Shanghai': 'Шанхай',
  'Jiangsu': 'Цзянсу',
  'Zhejiang': 'Чжэцзян',
  'Fujian': 'Фуцзянь',
  'Anhui': 'Аньхой',
  'Henan': 'Хэнань',
  'Hubei': 'Хубэй',
  'Hunan': 'Хунань',
  'Jiangxi': 'Цзянси',
  'Guangdong': 'Гуандун',
  'Guangxi': 'Гуанси',
  'Hainan': 'Хайнань',
  'Yunnan': 'Юньнань',
  'Guizhou': 'Гуйчжоу',
  'Sichuan': 'Сычуань',
  'Chongqing': 'Чунцин',
  'Xinjiang': 'Синьцзян',
  'Tibet': 'Тибет',
  'Qinghai': 'Цинхай',
};

/**
 * Получает русское название региона
 * Приоритет:
 * 1. name_ru из GeoJSON properties
 * 2. Перевод из словаря по adm1_code
 * 3. Перевод из словаря по английскому названию
 * 4. Оригинальное английское название
 */
export function getRussianRegionName(
  geoJsonId: string,
  englishName: string,
  nameRu?: string
): string {
  // Приоритет 1: name_ru из GeoJSON
  if (nameRu && nameRu.trim()) {
    return nameRu;
  }

  // Приоритет 2: перевод по adm1_code
  if (REGION_TRANSLATIONS[geoJsonId]) {
    return REGION_TRANSLATIONS[geoJsonId];
  }

  // Приоритет 3: перевод по английскому названию
  if (REGION_TRANSLATIONS[englishName]) {
    return REGION_TRANSLATIONS[englishName];
  }

  // Приоритет 4: оригинальное название
  return englishName;
}

/**
 * Добавляет новый перевод в словарь
 */
export function addRegionTranslation(key: string, russianName: string): void {
  REGION_TRANSLATIONS[key] = russianName;
}

/**
 * Пакетное добавление переводов
 */
export function addRegionTranslations(translations: Record<string, string>): void {
  Object.assign(REGION_TRANSLATIONS, translations);
}
