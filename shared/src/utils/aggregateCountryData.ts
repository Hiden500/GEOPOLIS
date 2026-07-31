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

  // Страна БЕЗ регионов (или без населения) обнуляется, а не выходит с
  // прежними числами (исправлено Милстоуном 1, сессия жизненного цикла).
  //
  // Раньше здесь стоял ранний `return` при пустом списке регионов: население и
  // ВВП оставались на последнем посчитанном значении. Пока страны не
  // появлялись и не исчезали, до этой ветки было не доехать. Жизненный цикл
  // (`CONCEPT.md` §7.1) открывает её штатным путём — и молча, а не падением:
  // осколок, созданный до передачи ему регионов, унаследовал бы численность
  // метрополии и с ней ушёл бы в индекс силы, в промт и в проверку сумм.
  // Разделение «суммы считаем всегда, средние — только когда есть на что
  // делить» и есть починка: обнуление должно быть ЯВНЫМ результатом, а
  // деление на ноль не должно давать NaN.
  if (countryRegions.length === 0 || totalPopulation <= 0) {
    return;
  }

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

  // Агрегируем экономические сектора регионов (если инициализированы)
  let totalAgriculture = 0;
  let totalIndustry = 0;
  let totalMining = 0;
  let totalServices = 0;

  for (const region of countryRegions) {
    if (region.economy) {
      totalAgriculture += region.economy.agriculture * region.population;
      totalIndustry += region.economy.industry * region.population;
      totalMining += region.economy.mining * region.population;
      totalServices += region.economy.services * region.population;
    }
  }

  // Средневзвешенные по населению сектора
  const avgSectors = {
    agriculture: totalAgriculture / totalPopulation,
    industry: totalIndustry / totalPopulation,
    mining: totalMining / totalPopulation,
    services: totalServices / totalPopulation,
  };

  // Deposits: сумма richness ресурсов всех регионов (docs/plans/04_RESOURCES.md)
  const deposits: Partial<Record<ResourceType, number>> = {};
  for (const region of countryRegions) {
    for (const [resource, amount] of Object.entries(region.deposits)) {
      const resourceType = resource as ResourceType;
      const amountValue = amount as number;
      deposits[resourceType] = (deposits[resourceType] || 0) + amountValue;
    }
  }

  // Если нужно сохранить агрегированные данные в country, можно добавить поля
  // Например: country.aggregatedRegionData = { infrastructure: avgInfrastructure, sectors: avgSectors, ... }
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
 * Выставляет начальный ВВП всех регионов по формуле (население × развитие ×
 * инфраструктура). Использовать ТОЛЬКО при создании партии (createGame) —
 * после старта region.gdp растёт через EconomyTick (мультипликативно, с
 * памятью), и повторный пересчёт по этой формуле каждый ход стирал бы тот
 * рост (найдено при верификации Q9, см. docs/DECISIONS.md 2026-06-26).
 */
export function initializeRegionGdp(regions: Region[]): void {
  for (const region of regions) {
    region.gdp = calculateRegionGdp(region);
  }
}

/**
 * Агрегирует текущий region.gdp (и прочие региональные показатели) к странам.
 * НЕ пересчитывает region.gdp — это раздельный шаг (initializeRegionGdp),
 * чтобы не затирать рост, накопленный EconomyTick за предыдущие ходы.
 */
export function aggregateAllCountries(
  countries: Country[],
  regions: Region[]
): void {
  for (const country of countries) {
    aggregateCountryFromRegions(country, regions);
  }
}

/**
 * Полная инициализация при создании партии: ВВП регионов + агрегация к
 * странам. Не использовать в симуляции тиков — см. initializeRegionGdp.
 */
export function updateAllRegionsAndAggregate(
  countries: Country[],
  regions: Region[]
): void {
  initializeRegionGdp(regions);
  aggregateAllCountries(countries, regions);
}
