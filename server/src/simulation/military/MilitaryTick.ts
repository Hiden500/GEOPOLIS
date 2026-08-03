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
  WAR_MATERIAL_RESOURCE_IDS,
  EQUIPMENT_RESOURCE_DEMAND_SCALE,
} from "@shared/defines/military";

/**
 * Коэффициент покрытия сырьевого спроса производства (гейт сырья, вариант А,
 * решение пользователя 2026-08-02 — docs/IDEAS.md §11).
 *
 * demand ≤ 0 — производство ничего не требует, гейт не режет (1). Иначе —
 * доля спроса, покрытая доступным сырьём, с потолком 1: избыток сырья не
 * ускоряет производство, только страхует от перебоев.
 */
export function equipmentResourceCoverage(available: number, demand: number): number {
  if (demand <= 0) return 1;
  if (available <= 0) return 0;
  return Math.min(1, available / demand);
}

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
    // ГЕЙТ СЫРЬЯ (вариант А, 2026-08-02). До него производство было чистой
    // функцией денег: страна без грамма стали клепала танки в полном темпе,
    // а обнуление ВСЕГО запаса мира меняло снаряжение на −0,13% за 24 месяца
    // (замер: server/scripts/probeResourceGates.ts). Теперь спрос производства
    // (militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE) сверяется с
    // доступным военным сырьём — стокпайл уже включает добычу и импорт этого
    // месяца, потому что resourceTick и tradeTick идут раньше militaryTick
    // (SimulationEngine.ts) — и выпуск падает пропорционально непокрытой доле.
    //
    // Производство ПОТРЕБЛЯЕТ сырьё: покрытая часть спроса списывается со
    // складов пропорционально вкладу каждого ресурса. Это закрывает вопрос
    // docs/ECONOMY.md «что потребляет ресурсы внутри страны» и делает
    // build_extraction/блокаду/оккупацию действиями с военными последствиями.
    const demand = economy.militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE;
    let available = 0;
    for (const resourceId of WAR_MATERIAL_RESOURCE_IDS) {
      available += Math.max(0, country.stockpile[resourceId] ?? 0);
    }
    const coverage = equipmentResourceCoverage(available, demand);

    const consumed = Math.min(available, demand);
    if (consumed > 0) {
      const consumedShare = consumed / available;
      for (const resourceId of WAR_MATERIAL_RESOURCE_IDS) {
        const stock = country.stockpile[resourceId] ?? 0;
        if (stock > 0) country.stockpile[resourceId] = stock - stock * consumedShare;
      }
    }

    const equipmentTypes = Object.values(EquipmentType);
    const allocation = military.productionAllocation ?? {};
    const explicitShareSum = equipmentTypes.reduce((sum, t) => sum + (allocation[t] ?? 0), 0);
    const unallocatedTypes = equipmentTypes.filter(t => allocation[t] === undefined);
    const remainingShare = Math.max(0, 1 - explicitShareSum);
    const evenShare = unallocatedTypes.length > 0 ? remainingShare / unallocatedTypes.length : 0;

    for (const type of equipmentTypes) {
      const share = allocation[type] ?? evenShare;
      if (share <= 0) continue;

      const gain = ((economy.militarySpending * share) / EQUIPMENT_SPENDING_SCALE) * coverage;
      military.equipment[type] += gain;
    }
  }
}