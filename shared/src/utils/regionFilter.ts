/**
 * Фильтр для маленьких стран и регионов
 * Позволяет сократить количество регионов для оптимизации производительности
 */

import type { FeatureCollection, Feature } from 'geojson';

/**
 * Список маленьких стран для фильтрации
 * ISO Alpha-3 коды стран, регионы которых могут быть объединены или исключены
 */
export const SMALL_COUNTRIES: Set<string> = new Set([
  'SVN', // Словения
  'MKD', // Македония
  'XKX', // Косово
  'MDA', // Молдова
  'BFA', // Буркина Фасо
  'GTM', // Гватемала
  'TWN', // Тайвань (может быть исключен для упрощения)
]);

/**
 * Порог площади региона (в кв. км) для фильтрации
 * Регионы меньше этого размера могут быть объединены с соседями
 */
export const MIN_REGION_AREA = 1000; // 1000 кв. км

/**
 * Уровни детализации карты
 */
export enum DetailLevel {
  FULL = 'full',           // Все регионы
  HIGH = 'high',           // Без очень маленьких регионов
  MEDIUM = 'medium',       // Без маленьких стран
  LOW = 'low',             // Только крупные регионы
}

/**
 * Настройки фильтрации по уровню детализации
 */
const DETAIL_LEVEL_CONFIG: Record<DetailLevel, {
  minArea: number;
  excludeSmallCountries: boolean;
  mergeTinyRegions: boolean;
}> = {
  [DetailLevel.FULL]: {
    minArea: 0,
    excludeSmallCountries: false,
    mergeTinyRegions: false,
  },
  [DetailLevel.HIGH]: {
    minArea: 500,
    excludeSmallCountries: false,
    mergeTinyRegions: true,
  },
  [DetailLevel.MEDIUM]: {
    minArea: 1000,
    excludeSmallCountries: true,
    mergeTinyRegions: true,
  },
  [DetailLevel.LOW]: {
    minArea: 5000,
    excludeSmallCountries: true,
    mergeTinyRegions: true,
  },
};

/**
 * Проверяет, является ли страна маленькой
 */
export function isSmallCountry(isoA3: string): boolean {
  return SMALL_COUNTRIES.has(isoA3);
}

/**
 * Проверяет, является ли регион слишком маленьким по площади
 */
export function isTinyRegion(area: number, minArea: number): boolean {
  return area > 0 && area < minArea;
}

/**
 * Фильтрует GeoJSON FeatureCollection на основе уровня детализации
 */
export function filterGeoJsonByDetailLevel(
  geoJson: FeatureCollection,
  detailLevel: DetailLevel = DetailLevel.MEDIUM
): FeatureCollection {
  const config = DETAIL_LEVEL_CONFIG[detailLevel];

  const filteredFeatures = geoJson.features.filter((feature: Feature) => {
    const props = feature.properties || {};
    const adm0_a3 = (props.adm0_a3 || '') as string;
    const area = (props.area_sqkm || 0) as number;

    // Исключаем маленькие страны если настроено
    if (config.excludeSmallCountries && isSmallCountry(adm0_a3)) {
      return false;
    }

    // Исключаем слишком маленькие регионы если настроено
    if (config.mergeTinyRegions && isTinyRegion(area, config.minArea)) {
      return false;
    }

    return true;
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures,
  };
}

/**
 * Группирует регионы маленькой страны в один объединенный регион
 * Упрощенная реализация - оставляет только самый большой регион
 */
export function mergeSmallCountryRegions(
  geoJson: FeatureCollection
): FeatureCollection {
  const countryRegions = new Map<string, Feature[]>();

  // Группируем регионы по странам
  for (const feature of geoJson.features) {
    const props = feature.properties || {};
    const adm0_a3 = (props.adm0_a3 || '') as string;

    if (!countryRegions.has(adm0_a3)) {
      countryRegions.set(adm0_a3, []);
    }
    countryRegions.get(adm0_a3)!.push(feature);
  }

  const mergedFeatures: Feature[] = [];

  // Обрабатываем каждую страну
  for (const [isoA3, features] of countryRegions.entries()) {
    // Если страна маленькая и имеет несколько регионов, оставляем только самый большой
    if (isSmallCountry(isoA3) && features.length > 1) {
      const largestFeature = features.reduce((max: Feature, feature: Feature) => {
        const area = (feature.properties?.area_sqkm || 0) as number;
        const maxArea = (max.properties?.area_sqkm || 0) as number;
        return area > maxArea ? feature : max;
      });
      mergedFeatures.push(largestFeature);
    } else {
      // Иначе оставляем все регионы
      mergedFeatures.push(...features);
    }
  }

  return {
    type: 'FeatureCollection',
    features: mergedFeatures,
  };
}
