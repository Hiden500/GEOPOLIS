/**
 * Маппинг ISO Alpha-3 кодов стран на игровые ID
 * Используется для связи GeoJSON регионов со странами в игре
 */

export interface CountryIsoMapping {
  isoA3: string;
  gameId: string;
}

/**
 * Основной маппинг: ISO Alpha-3 код → игровой ID страны
 * Расширяемый — добавляйте страны по мере их ввода в игру
 */
export const ISO_TO_COUNTRY_ID: Record<string, string> = {
  // СССР — все республики (исторические ISO коды)
  'SUN': 'USSR',   // Soviet Union
  'RUS': 'USSR',   // Russia (RSFSR)
  'UKR': 'USSR',   // Ukraine
  'BLR': 'USSR',   // Belarus
  'GEO': 'USSR',   // Georgia
  'ARM': 'USSR',   // Armenia
  'AZE': 'USSR',   // Azerbaijan
  'KAZ': 'USSR',   // Kazakhstan
  'UZB': 'USSR',   // Uzbekistan
  'TKM': 'USSR',   // Turkmenistan
  'KGZ': 'USSR',   // Kyrgyzstan
  'TJK': 'USSR',   // Tajikistan
  'EST': 'USSR',   // Estonia
  'LVA': 'USSR',   // Latvia
  'LTU': 'USSR',   // Lithuania
  'MDA': 'USSR',   // Moldova

  // США
  'USA': 'USA',

  // Великобритания
  'GBR': 'UK',

  // Франция
  'FRA': 'FRA',

  // Германия (оккупированная в 1946)
  'DEU': 'Germany',

  // Зоны оккупации Германии (виртуальные государства)
  'DEU-USSR': 'DEU-USSR',   // Советская зона
  'DEU-USA': 'DEU-USA',     // Американская зона
  'DEU-UK': 'DEU-UK',       // Британская зона
  'DEU-FRA': 'DEU-FRA',     // Французская зона

  // Италия
  'ITA': 'Italy',

  // Китай (коммунисты)
  'CHN': 'China',

  // Тайвань (Гоминьдан)
  'TWN': 'Taiwan',

  // Гонконг
  'HKG': 'Taiwan',
};

/**
 * Обратный маппинг: игровой ID страны → массив ISO кодов
 */
export const COUNTRY_ID_TO_ISO: Record<string, string[]> = {
  'USSR': ['SUN', 'RUS', 'UKR', 'BLR', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'EST', 'LVA', 'LTU', 'MDA'],
  'USA': ['USA'],
  'UK': ['GBR'],
  'FRA': ['FRA'],
  'Germany': ['DEU'],
  'DEU-USSR': ['DEU-USSR'],
  'DEU-USA': ['DEU-USA'],
  'DEU-UK': ['DEU-UK'],
  'DEU-FRA': ['DEU-FRA'],
  'Italy': ['ITA'],
  'China': ['CHN'],
  'Taiwan': ['TWN', 'HKG'],
};

/**
 * Получает игровой ID страны по ISO коду
 */
export function getCountryIdByIso(isoA3: string): string | null {
  return ISO_TO_COUNTRY_ID[isoA3] || null;
}

/**
 * Получает ISO коды страны по игровому ID
 */
export function getIsoCodesByCountryId(gameId: string): string[] {
  return COUNTRY_ID_TO_ISO[gameId] || [];
}

/**
 * Добавляет новый маппинг страны
 */
export function addCountryMapping(isoA3: string, gameId: string): void {
  ISO_TO_COUNTRY_ID[isoA3] = gameId;
  
  if (!COUNTRY_ID_TO_ISO[gameId]) {
    COUNTRY_ID_TO_ISO[gameId] = [];
  }
  if (!COUNTRY_ID_TO_ISO[gameId].includes(isoA3)) {
    COUNTRY_ID_TO_ISO[gameId].push(isoA3);
  }
}
