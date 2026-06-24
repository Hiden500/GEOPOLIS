/**
 * Исторические данные 1946 года для регионов
 * Население, ресурсы и экономические показатели
 */

import type { ResourceType } from '../types/resources/ResourcesType';

/**
 * Население стран в 1946 году (в миллионах)
 */
export const COUNTRY_POPULATION_1946: Record<string, number> = {
  'USSR': 170,      // СССР после войны
  'USA': 140,       // США
  'UK': 49,         // Великобритания
  'FRA': 40,        // Франция
  'Germany': 45,    // Германия (оккупированная)
  'Italy': 45,      // Италия
  'China': 460,     // Китай (коммунисты - контролируемая территория)
  'Taiwan': 450,    // Тайвань (Гоминьдан - формально весь Китай)
};

/**
 * Население регионов Германии в 1946 (в тысячах)
 */
export const GERMANY_REGION_POPULATION: Record<string, number> = {
  'DEU-1601': 4500,   // Sachsen
  'DEU-1600': 2800,   // Sachsen-Anhalt
  'DEU-3487': 2500,   // Brandenburg
  'DEU-3488': 2100,   // Mecklenburg-Vorpommern
  'DEU-1577': 2300,   // Thüringen
  'DEU-1591': 7000,   // Bayern
  'DEU-1574': 4000,   // Hessen
  'DEU-1575': 600,    // Bremen
  'DEU-1573': 6500,   // Baden-Württemberg
  'DEU-1576': 6000,   // Niedersachsen
  'DEU-1572': 10000,  // Nordrhein-Westfalen
  'DEU-1579': 2200,   // Schleswig-Holstein
  'DEU-1578': 1600,   // Hamburg
  'DEU-1580': 3800,   // Rheinland-Pfalz
  'DEU-1581': 1000,   // Saarland
  'DEU-1599': 3300,   // Berlin
};

/**
 * Население регионов Китая в 1946 (в тысячах)
 */
export const CHINA_REGION_POPULATION: Record<string, number> = {
  'CHN-1839': 5000,   // Heilongjiang (Маньчжурия)
  'CHN-1828': 4000,   // Jilin (Маньчжурия)
  'CHN-1813': 8000,   // Liaoning (Маньчжурия)
  'CHN-1838': 6000,   // Inner Mongolia
  'CHN-1811': 25000,  // Hebei
  'CHN-1805': 12000,  // Shanxi
  'CHN-1804': 10000,  // Shaanxi
  'CHN-1803': 1500,   // Ningxia
  'CHN-1150': 8000,   // Gansu
  'CHN-1814': 35000,  // Shandong
  'CHN-1816': 4000,   // Tianjin
  'CHN-1155': 5000,   // Beijing
  'CHN-1819': 4500,   // Shanghai
  'CHN-1818': 35000,  // Jiangsu
  'CHN-1820': 20000,  // Zhejiang
  'CHN-1178': 15000,  // Fujian
  'CHN-1179': 25000,  // Anhui
  'CHN-1812': 28000,  // Henan
  'CHN-1807': 22000,  // Hubei
  'CHN-1808': 25000,  // Hunan
  'CHN-1817': 18000,  // Jiangxi
  'CHN-1180': 30000,  // Guangdong
  'CHN-1152': 18000,  // Guangxi
  'CHN-1775': 2000,   // Hainan
  'CHN-1810': 15000,  // Yunnan
  'CHN-1153': 10000,  // Guizhou
  'CHN-1809': 50000,  // Sichuan
  'CHN-1154': 8000,   // Chongqing
  'CHN-1756': 4000,   // Xinjiang
  'CHN-1662': 1000,   // Xizang (Тибет)
  'CHN-1151': 2000,   // Qinghai
};

/**
 * Производство ресурсов по странам в 1946 (условные единицы)
 */
export const COUNTRY_RESOURCE_PRODUCTION_1946: Record<string, Partial<Record<ResourceType, number>>> = {
  'USSR': {
    oil: 30,
    coal: 150,
    iron: 40,
    copper: 15,
    bauxite: 10,
    gold: 20,
  },
  'USA': {
    oil: 80,
    coal: 200,
    iron: 50,
    copper: 25,
    bauxite: 15,
    gold: 15,
  },
  'UK': {
    oil: 5,
    coal: 100,
    iron: 15,
    copper: 5,
    bauxite: 0,
    gold: 2,
  },
  'FRA': {
    oil: 2,
    coal: 40,
    iron: 10,
    copper: 3,
    bauxite: 20,
    gold: 1,
  },
  'Germany': {
    oil: 1,
    coal: 80,
    iron: 20,
    copper: 5,
    bauxite: 5,
    gold: 2,
  },
  'Italy': {
    oil: 0,
    coal: 5,
    iron: 3,
    copper: 5,
    bauxite: 5,
    gold: 1,
  },
  'China': {
    oil: 5,
    coal: 50,
    iron: 10,
    copper: 8,
    bauxite: 5,
    gold: 10,
  },
  'Taiwan': {
    oil: 2,
    coal: 30,
    iron: 5,
    copper: 5,
    bauxite: 3,
    gold: 5,
  },
};

/**
 * Экономические показатели стран в 1946
 */
export const COUNTRY_ECONOMICS_1946: Record<string, {
  urbanization: number;    // Урбанизация (0-1)
  stability: number;        // Стабильность (0-1)
  infrastructure: number;   // Инфраструктура (0-1)
  development: number;      // Развитие (0-1)
}> = {
  'USSR': {
    urbanization: 0.35,
    stability: 0.6,
    infrastructure: 0.4,
    development: 0.5,
  },
  'USA': {
    urbanization: 0.65,
    stability: 0.9,
    infrastructure: 0.9,
    development: 0.95,
  },
  'UK': {
    urbanization: 0.8,
    stability: 0.7,
    infrastructure: 0.7,
    development: 0.85,
  },
  'FRA': {
    urbanization: 0.55,
    stability: 0.5,
    infrastructure: 0.5,
    development: 0.7,
  },
  'Germany': {
    urbanization: 0.6,
    stability: 0.3,
    infrastructure: 0.4,
    development: 0.7,
  },
  'Italy': {
    urbanization: 0.5,
    stability: 0.4,
    infrastructure: 0.4,
    development: 0.6,
  },
  'China': {
    urbanization: 0.15,
    stability: 0.4,
    infrastructure: 0.2,
    development: 0.3,
  },
  'Taiwan': {
    urbanization: 0.2,
    stability: 0.5,
    infrastructure: 0.25,
    development: 0.35,
  },
};

/**
 * Получает население региона в 1946
 */
export function getRegionPopulation1946(geoJsonId: string, countryId: string, area: number): number {
  // Проверяем специфические данные для Германии
  if (GERMANY_REGION_POPULATION[geoJsonId]) {
    return GERMANY_REGION_POPULATION[geoJsonId] * 1000;
  }

  // Проверяем специфические данные для Китая
  if (CHINA_REGION_POPULATION[geoJsonId]) {
    return CHINA_REGION_POPULATION[geoJsonId] * 1000;
  }

  // Если нет специфических данных, оцениваем по стране
  const countryPopulation = COUNTRY_POPULATION_1946[countryId] || 10;
  
  // Оценка: население пропорционально площади (очень грубая оценка)
  // Для реального использования нужна более точная логика
  return Math.round((countryPopulation * 1000000) / 100); // Упрощенно
}

/**
 * Получает экономические показатели региона в 1946
 */
export function getRegionEconomics1946(countryId: string): {
  urbanization: number;
  stability: number;
  infrastructure: number;
  development: number;
} {
  return COUNTRY_ECONOMICS_1946[countryId] || {
    urbanization: 0.3,
    stability: 0.5,
    infrastructure: 0.4,
    development: 0.5,
  };
}

/**
 * Получает производство ресурсов региона в 1946
 */
export function getRegionResourceProduction1946(countryId: string): Partial<Record<ResourceType, number>> {
  return COUNTRY_RESOURCE_PRODUCTION_1946[countryId] || {};
}
