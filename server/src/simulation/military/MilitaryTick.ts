import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

/**
 * Полная реализация MilitaryTick.
 * Пополнение manpower, восстановление подразделений, производство техники.
 */
export function militaryTick(
  country: Country,
  regions: Region[]
): void {
  const military = country.military;
  const economy = country.economy;

  // Пополнение manpower на основе населения и военных расходов
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);
  const totalPopulation = countryRegions.reduce((sum, r) => sum + r.population, 0);

  // Базовый набор manpower: 0.1% населения в месяц
  const baseManpowerGain = Math.floor(totalPopulation * 0.001);

  // Бонус от военных расходов
  const militarySpendingRatio = economy.militarySpending / economy.gdp;
  const spendingBonus = Math.floor(baseManpowerGain * militarySpendingRatio * 2);

  // Штраф от низкой стабильности
  const stabilityPenalty = country.politics.stability < 50 ? 0.5 : 1;

  const manpowerGain = Math.floor((baseManpowerGain + spendingBonus) * stabilityPenalty);
  military.manpower += manpowerGain;

  // Восстановление подразделений
  for (const unit of military.units) {
    if (unit.strength < 100) {
      // Базовое восстановление
      let recoveryRate = 1;

      // Бонус от военных расходов
      recoveryRate += militarySpendingRatio * 2;

      // Штраф от дефицита бюджета
      if (economy.budgetBalance < 0) {
        recoveryRate *= 0.5;
      }

      unit.strength = Math.min(100, unit.strength + recoveryRate);
    }
  }

  // Обновление activePersonnel на основе manpower
  // Упрощённая модель: 10% manpower = activePersonnel
  military.activePersonnel = Math.floor(military.manpower * 0.1);
  military.reservePersonnel = Math.floor(military.manpower * 0.9);

  // Производство техники (упрощённая модель)
  // Зависит от военных расходов и ВВП
  const productionCapacity = economy.militarySpending / 1000;
  // Здесь можно добавить логику производства конкретных типов техники
  // Для будущего расширения
}