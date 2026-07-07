import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { EquipmentType } from "@shared/types/military/EquipmentType";

/**
 * Сколько единиц эквивалентной стоимости даёт 1 единица militarySpending при
 * полной (share=1) отдаче на тир 0 — тюнингуемая константа, как
 * RESEARCH_SPENDING_SCALE в ResearchTick.ts. Подобрана так, чтобы полностью
 * сфокусированная держава (share=0.7) набирала тысячи единиц техники за
 * несколько лет, не за один месяц и не за десятилетия (War Phase 2,
 * независимый гейм-дизайн разбор, 2026-07-06).
 */
const EQUIPMENT_SPENDING_SCALE = 200_000_000;

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

  // Бонус от военных расходов (страна без территории — gdp=0 — не получает
  // бонус/штраф, не NaN; см. EconomyTick.ts, та же защита).
  const militarySpendingRatio = economy.gdp > 0 ? economy.militarySpending / economy.gdp : 0;
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

  // Производство техники по категориям (War Phase 2, 2026-07-06) — доля
  // militarySpending на категорию даёт прирост equipment[type]; категории без
  // явной доли в productionAllocation делят остаток поровну — тот же паттерн,
  // что распределение researchSpending по доменам в ResearchTick.ts.
  if (economy.militarySpending > 0) {
    const equipmentTypes = Object.values(EquipmentType);
    const allocation = military.productionAllocation ?? {};
    const explicitShareSum = equipmentTypes.reduce((sum, t) => sum + (allocation[t] ?? 0), 0);
    const unallocatedTypes = equipmentTypes.filter(t => allocation[t] === undefined);
    const remainingShare = Math.max(0, 1 - explicitShareSum);
    const evenShare = unallocatedTypes.length > 0 ? remainingShare / unallocatedTypes.length : 0;

    for (const type of equipmentTypes) {
      const share = allocation[type] ?? evenShare;
      if (share <= 0) continue;

      const gain = (economy.militarySpending * share) / EQUIPMENT_SPENDING_SCALE;
      military.equipment[type] += gain;
    }
  }
}