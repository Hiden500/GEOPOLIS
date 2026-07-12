import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { getGdpPerCapita, GDP_PER_CAPITA_REFERENCE } from "@shared/utils/countryMetrics";
import {
  BASE_BIRTH_RATE_PER_MONTH,
  BASE_DEATH_RATE_PER_MONTH,
  STANDARD_OF_LIVING_CAP,
  STANDARD_OF_LIVING_BIRTH_FLOOR,
  MEDICINE_TECH_BONUS_RATE,
  BIRTH_RATE_LIVING_STANDARD_BASE,
  BIRTH_RATE_LIVING_STANDARD_COEFFICIENT,
  BIRTH_RATE_EDUCATION_BASE,
  BIRTH_RATE_EDUCATION_COEFFICIENT,
  BIRTH_RATE_WELFARE_BASE,
  BIRTH_RATE_WELFARE_COEFFICIENT,
  BIRTH_RATE_STABILITY_BASE,
  BIRTH_RATE_STABILITY_COEFFICIENT,
  DEATH_RATE_STABILITY_BASE,
  DEATH_RATE_STABILITY_COEFFICIENT,
  MIN_REGION_POPULATION,
} from "@shared/defines/population";

/**
 * Полная реализация PopulationTick. Рассчитывает рождаемость, смертность и
 * миграцию на уровне регионов. Баланс-константы — shared/src/defines/population.ts.
 */
export function populationTick(
  country: Country,
  regions: Region[]
): void {
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  if (countryRegions.length === 0) {
    return;
  }

  // Факторы страны
  const gdpPerCapita = getGdpPerCapita(country);
  // Нормализуем к GDP_PER_CAPITA_REFERENCE (~850, калибровка "средней крупной
  // державы" 1946 года, см. countryMetrics.ts) — страна на уровне ориентира
  // получает standardOfLiving=1, вдвое богаче — потолок STANDARD_OF_LIVING_CAP.
  const standardOfLiving = Math.min(gdpPerCapita / GDP_PER_CAPITA_REFERENCE, STANDARD_OF_LIVING_CAP);
  // Пол уровня жизни ТОЛЬКО для рождаемости (демографический переход, см.
  // STANDARD_OF_LIVING_BIRTH_FLOOR): бедность не подавляет фертильность ниже
  // аграрной нормы. Смертность ниже использует сырой standardOfLiving-независимый
  // путь (медицина/стабильность), пол её не касается.
  const birthStandardOfLiving = Math.max(STANDARD_OF_LIVING_BIRTH_FLOOR, standardOfLiving);
  // Страна без территории (gdp=0) не получает бонус/штраф, не NaN; см.
  // EconomyTick.ts, та же защита.
  const hasGdp = country.economy.gdp > 0;
  const educationFactor = hasGdp ? country.economy.educationSpending / country.economy.gdp : 0;
  const welfareFactor = hasGdp ? country.economy.welfareSpending / country.economy.gdp : 0;

  // Технологический бонус медицины (упрощённо). "biology" — реальный ключ
  // домена медицины эры 1946 (см. shared/src/data/eras.ts); другие эры
  // используют другой ключ ("medicine" в 1836, "biotechnology" в 2000) —
  // не обобщаем на них сейчас, единственный играбельный сценарий — 1946.
  const medicineTechLevel = country.technology.domains["biology"] || 0;
  const medicineBonus = 1 + (medicineTechLevel * MEDICINE_TECH_BONUS_RATE);

  for (const region of countryRegions) {
    // Рождаемость региона
    // Чем выше уровень жизни, медицина и образование - тем выше рождаемость (до определённого предела)
    const regionBirthRate = BASE_BIRTH_RATE_PER_MONTH *
      (BIRTH_RATE_LIVING_STANDARD_BASE + birthStandardOfLiving * BIRTH_RATE_LIVING_STANDARD_COEFFICIENT) *
      (BIRTH_RATE_EDUCATION_BASE + educationFactor * BIRTH_RATE_EDUCATION_COEFFICIENT) *
      (BIRTH_RATE_WELFARE_BASE + welfareFactor * BIRTH_RATE_WELFARE_COEFFICIENT) *
      (BIRTH_RATE_STABILITY_BASE + region.stability / 100 * BIRTH_RATE_STABILITY_COEFFICIENT);

    const births = Math.floor(region.population * regionBirthRate);

    // Смертность региона
    // Чем выше медицина и стабильность - тем ниже смертность
    const regionDeathRate = BASE_DEATH_RATE_PER_MONTH /
      medicineBonus /
      (DEATH_RATE_STABILITY_BASE + region.stability / 100 * DEATH_RATE_STABILITY_COEFFICIENT);

    const deaths = Math.floor(region.population * regionDeathRate);

    // Естественный прирост
    region.population += births - deaths;

    // Минимум населения
    if (region.population < MIN_REGION_POPULATION) {
      region.population = MIN_REGION_POPULATION;
    }
  }

  // Агрегация населения страны происходит автоматически через updateAllRegionsAndAggregate
  // в SimulationEngine после всех тиков
}