import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import {
  EQUIPMENT_SPENDING_SCALE,
  BASE_MANPOWER_GAIN_RATE,
  MANPOWER_SPENDING_BONUS_MULTIPLIER,
  MANPOWER_LOW_STABILITY_THRESHOLD,
  MANPOWER_LOW_STABILITY_PENALTY,
  UNIT_MAX_STRENGTH,
  UNIT_BASE_RECOVERY_RATE,
  UNIT_RECOVERY_SPENDING_BONUS_MULTIPLIER,
  UNIT_RECOVERY_DEFICIT_PENALTY,
  ACTIVE_PERSONNEL_SHARE,
  ACTIVE_PERSONNEL_MOBILIZATION_RATE,
  RESERVE_PERSONNEL_SHARE,
} from "@shared/defines/military";

/**
 * Полная реализация MilitaryTick. Пополнение manpower, восстановление
 * подразделений, производство техники. Баланс-константы —
 * shared/src/defines/military.ts.
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

  const baseManpowerGain = Math.floor(totalPopulation * BASE_MANPOWER_GAIN_RATE);

  // Бонус от военных расходов (страна без территории — gdp=0 — не получает
  // бонус/штраф, не NaN; см. EconomyTick.ts, та же защита).
  const militarySpendingRatio = economy.gdp > 0 ? economy.militarySpending / economy.gdp : 0;
  const spendingBonus = Math.floor(baseManpowerGain * militarySpendingRatio * MANPOWER_SPENDING_BONUS_MULTIPLIER);

  // Штраф от низкой стабильности
  const stabilityPenalty = country.politics.stability < MANPOWER_LOW_STABILITY_THRESHOLD
    ? MANPOWER_LOW_STABILITY_PENALTY
    : 1;

  const manpowerGain = Math.floor((baseManpowerGain + spendingBonus) * stabilityPenalty);
  military.manpower += manpowerGain;

  // Восстановление подразделений
  for (const unit of military.units) {
    if (unit.strength < UNIT_MAX_STRENGTH) {
      // Базовое восстановление
      let recoveryRate = UNIT_BASE_RECOVERY_RATE;

      // Бонус от военных расходов
      recoveryRate += militarySpendingRatio * UNIT_RECOVERY_SPENDING_BONUS_MULTIPLIER;

      // Штраф от дефицита бюджета
      if (economy.budgetBalance < 0) {
        recoveryRate *= UNIT_RECOVERY_DEFICIT_PENALTY;
      }

      unit.strength = Math.min(UNIT_MAX_STRENGTH, unit.strength + recoveryRate);
    }
  }

  // activePersonnel — ЗАПАС (мобилизованная армия), а не производное от
  // manpower поле: пул задаёт ПОТОЛОК, набор до потолка идёт со скоростью
  // ACTIVE_PERSONNEL_MOBILIZATION_RATE. Присваивание «= manpower × доля»
  // (как было до 2026-07-31) стирало потери, списанные warTick'ом в том же
  // месяце, — из убитого солдата в строй возвращалось 90%, и война не
  // ослабляла армию вообще (замер: server/scripts/probeWarFeedback.ts).
  //
  // Порядок тиков при этом НЕ меняется: militaryTick по-прежнему идёт раньше
  // warTick в SimulationEngine.ts, и это больше не важно — списание живёт в
  // самом поле, а не в порядке его пересчёта.
  const activeTarget = Math.floor(military.manpower * ACTIVE_PERSONNEL_SHARE);
  if (military.activePersonnel >= activeTarget) {
    // Пул ужался (потери бьют и по manpower) — армия не может быть больше него.
    military.activePersonnel = activeTarget;
  } else {
    const gap = activeTarget - military.activePersonnel;
    military.activePersonnel += Math.ceil(gap * ACTIVE_PERSONNEL_MOBILIZATION_RATE);
  }

  // Резерв остаётся производным: с ним никто не воюет, восстанавливать нечего.
  military.reservePersonnel = Math.floor(military.manpower * RESERVE_PERSONNEL_SHARE);

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