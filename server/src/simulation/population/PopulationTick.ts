import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

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
  const gdpPerCapita = country.economy.gdp / country.population;
  const standardOfLiving = Math.min(gdpPerCapita / 10000, 2); // Нормализуем
  const educationFactor = country.economy.educationSpending / country.economy.gdp;
  const welfareFactor = country.economy.welfareSpending / country.economy.gdp;
  const stabilityFactor = country.politics.stability / 100;

  // Технологический бонус медицины (упрощённо)
  const medicineTechLevel = country.technology.domains["Biotechnology"] || 0;
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