import { type Country } from "../types/Country";
import { type Region } from "../types/map/Region";
import { ResourceType } from "../types/resources/ResourcesType";

/**
 * Агрегирует данные от регионов к стране.
 * Рассчитывает показатели страны на основе суммирования/усреднения данных регионов.
 */
export function aggregateCountryFromRegions(
  country: Country,
  regions: Region[]
): void {
  const countryRegions = regions.filter(
    r => r.ownerCountryId === country.id
  );

  if (countryRegions.length === 0) {
    return;
  }

  // Population: сумма населения всех регионов
  const totalPopulation = countryRegions.reduce(
    (sum, region) => sum + region.population,
    0
  );
  country.population = totalPopulation;

  // GDP: сумма ВВП всех регионов
  const totalGdp = countryRegions.reduce(
    (sum, region) => sum + region.gdp,
    0
  );
  country.economy.gdp = totalGdp;

  // Infrastructure: среднее значение по регионам
  const avgInfrastructure = countryRegions.reduce(
    (sum, region) => sum + region.infrastructure,
    0
  ) / countryRegions.length;
  // Сохраняем в дополнительное поле если нужно, или используем для расчётов

  // Stability: средневзвешенное по населению
  const weightedStability = countryRegions.reduce(
    (sum, region) => sum + region.stability * region.population,
    0
  ) / totalPopulation;

  // Development: средневзвешенное по населению
  const weightedDevelopment = countryRegions.reduce(
    (sum, region) => sum + region.development * region.population,
    0
  ) / totalPopulation;

  // Resource Production: сумма добычи ресурсов всех регионов
  const resourceProduction: Partial<Record<ResourceType, number>> = {};
  for (const region of countryRegions) {
    for (const [resource, amount] of Object.entries(region.resourceProduction)) {
      const resourceType = resource as ResourceType;
      const amountValue = amount as number;
      resourceProduction[resourceType] = (resourceProduction[resourceType] || 0) + amountValue;
    }
  }

  // Если нужно сохранить агрегированные данные в country, можно добавить поля
  // Например: country.aggregatedRegionData = { infrastructure: avgInfrastructure, ... }
}

/**
 * Рассчитывает ВВП региона на основе населения, развития и инфраструктуры.
 * GDP = population * development * infrastructure * baseMultiplier
 */
export function calculateRegionGdp(region: Region): number {
  const baseMultiplier = 1000; // Базовый множитель для масштабирования
  const gdp = region.population * region.development * region.infrastructure * baseMultiplier;
  return Math.floor(gdp);
}

/**
 * Обновляет ВВП всех регионов и агрегирует данные к странам.
 */
export function updateAllRegionsAndAggregate(
  countries: Country[],
  regions: Region[]
): void {
  // Сначала обновляем ВВП каждого региона
  for (const region of regions) {
    region.gdp = calculateRegionGdp(region);
  }

  // Затем агрегируем данные к странам
  for (const country of countries) {
    aggregateCountryFromRegions(country, regions);
  }
}
