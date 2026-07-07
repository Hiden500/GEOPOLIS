import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { getGdpPerCapita, GDP_PER_CAPITA_REFERENCE } from "@shared/utils/countryMetrics";

/**
 * Полная реализация PopulationTick.
 * Рассчитывает рождаемость, смертность и миграцию на уровне регионов.
 */
export function populationTick(
  country: Country,
  regions: Region[]
): void {
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  if (countryRegions.length === 0) {
    return;
  }

  // Базовые коэффициенты
  const baseBirthRate = 0.01; // 1% в месяц базовая рождаемость
  const baseDeathRate = 0.005; // 0.5% в месяц базовая смертность

  // Факторы страны
  const gdpPerCapita = getGdpPerCapita(country);
  // Нормализуем к GDP_PER_CAPITA_REFERENCE (~850, калибровка "средней крупной
  // державы" 1946 года, см. countryMetrics.ts) — страна на уровне ориентира
  // получает standardOfLiving=1, вдвое богаче — потолок 2.
  const standardOfLiving = Math.min(gdpPerCapita / GDP_PER_CAPITA_REFERENCE, 2);
  // Страна без территории (gdp=0) не получает бонус/штраф, не NaN; см.
  // EconomyTick.ts, та же защита.
  const hasGdp = country.economy.gdp > 0;
  const educationFactor = hasGdp ? country.economy.educationSpending / country.economy.gdp : 0;
  const welfareFactor = hasGdp ? country.economy.welfareSpending / country.economy.gdp : 0;
  const stabilityFactor = country.politics.stability / 100;

  // Технологический бонус медицины (упрощённо). "biology" — реальный ключ
  // домена медицины эры 1946 (см. shared/src/data/eras.ts); другие эры
  // используют другой ключ ("medicine" в 1836, "biotechnology" в 2000) —
  // не обобщаем на них сейчас, единственный играбельный сценарий — 1946.
  const medicineTechLevel = country.technology.domains["biology"] || 0;
  const medicineBonus = 1 + (medicineTechLevel * 0.1);

  for (const region of countryRegions) {
    // Рождаемость региона
    // Чем выше уровень жизни, медицина и образование - тем выше рождаемость (до определённого предела)
    const regionBirthRate = baseBirthRate *
      (0.5 + standardOfLiving * 0.3) *
      (0.8 + educationFactor * 2) *
      (0.9 + welfareFactor * 2) *
      (0.8 + region.stability / 100 * 0.4);

    const births = Math.floor(region.population * regionBirthRate);

    // Смертность региона
    // Чем выше медицина и стабильность - тем ниже смертность
    const regionDeathRate = baseDeathRate /
      medicineBonus /
      (0.9 + region.stability / 100 * 0.3);

    const deaths = Math.floor(region.population * regionDeathRate);

    // Естественный прирост
    region.population += births - deaths;

    // Минимум населения
    if (region.population < 1000) {
      region.population = 1000;
    }
  }

  // Агрегация населения страны происходит автоматически через updateAllRegionsAndAggregate
  // в SimulationEngine после всех тиков
}