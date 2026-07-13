import { type Country } from "@shared/types/Country";
import { type EconomyState } from "@shared/types/EconomyState";
import { type Region } from "@shared/types/map/Region";
import { RegionEconomyService } from "../../services/RegionEconomyService";
import {
  BASE_GROWTH_INTERCEPT,
  BASE_GROWTH_DEVELOPMENT_COEFFICIENT,
  BASE_GROWTH_INFRASTRUCTURE_COEFFICIENT,
  INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT,
  DEFICIT_PENALTY_COEFFICIENT,
  SECTOR_INDUSTRY_GROWTH_COEFFICIENT,
  SECTOR_SERVICES_GROWTH_COEFFICIENT,
  MAX_MONTHLY_GROWTH_RATE,
  INFLATION_DEFICIT_COEFFICIENT,
  UNEMPLOYMENT_DEFICIT_COEFFICIENT,
  DEBT_BASE_MONTHLY_INTEREST_RATE,
  DEBT_RISK_PREMIUM_COEFFICIENT,
  DEBT_GDP_PENALTY_THRESHOLD,
  DEBT_GDP_GROWTH_PENALTY_COEFFICIENT,
} from "@shared/defines/economy";

/**
 * Обновлённый EconomyTick с использованием регионов и региональной экономики.
 * Рост ВВП на основе промышленности регионов, инфраструктуры и ресурсов.
 * Баланс-константы — shared/src/defines/economy.ts (docs/ECONOMY.md,
 * docs/DECISIONS.md 2026-06-26, Q9).
 */

/**
 * Налог/доход/расходы/баланс бюджета. taxRevenue следует за gdp (taxRate
 * выводится в createGame); остальные компоненты дохода пока статичны —
 * см. docs/DECISIONS.md. Если игрок задал spendingShares (PUT /budget,
 * см. docs/DECISIONS.md 2026-07-04 "Бюджет: доли/проценты"), *Spending
 * пересчитываются из income × доля каждый тик — тот же паттерн, что
 * taxRate → taxRevenue выше. ИИ-страны spendingShares не имеют — их
 * *Spending остаются абсолютными числами, которые двигает AiBehaviorTick.
 */
function updateBudget(country: Country): { income: number; expenses: number } {
  const economy = country.economy;
  if (economy.taxRate !== undefined) {
    economy.taxRevenue = economy.gdp * economy.taxRate;
  }

  // Проценты по долгу пересчитываются каждый тик из текущего долга и здоровья
  // государства (docs/plans/08_WAR_WAVE1.md, Шаг 4) — до суммирования расходов,
  // чтобы обслуживание долга входило в дефицит этого месяца. Ставка выше при
  // низкой legitimacy/stability (слабое государство занимает дороже).
  economy.debtInterest = economy.debt > 0
    ? economy.debt * debtMonthlyInterestRate(country)
    : 0;

  const income =
    economy.taxRevenue +
    economy.exportIncome +
    economy.stateEnterpriseIncome +
    economy.otherIncome;

  if (economy.spendingShares) {
    economy.militarySpending = income * economy.spendingShares.military;
    economy.researchSpending = income * economy.spendingShares.research;
    economy.educationSpending = income * economy.spendingShares.education;
    economy.infrastructureSpending = income * economy.spendingShares.infrastructure;
    economy.welfareSpending = income * economy.spendingShares.welfare;
  }

  const expenses =
    economy.militarySpending +
    economy.researchSpending +
    economy.educationSpending +
    economy.infrastructureSpending +
    economy.welfareSpending +
    economy.debtInterest +
    economy.otherExpenses +
    economy.importSpending;

  economy.budgetBalance = income - expenses;
  economy.treasury += economy.budgetBalance;

  // Дефицит финансируется долгом: казна не уходит в бесконечный минус — часть
  // ниже нуля конвертируется в рост долга (docs/plans/08_WAR_WAVE1.md, Шаг 4).
  // Профицит гасит долг в первую очередь, остаток идёт в казну.
  if (economy.treasury < 0) {
    economy.debt += -economy.treasury;
    economy.treasury = 0;
  } else if (economy.debt > 0 && economy.treasury > 0) {
    const repaid = Math.min(economy.debt, economy.treasury);
    economy.debt -= repaid;
    economy.treasury -= repaid;
  }

  return { income, expenses };
}

/**
 * Месячная ставка по госдолгу: база + риск-премия за плохое здоровье
 * государства (avgHealth = (legitimacy + stability)/2, оба 0..100).
 * docs/plans/08_WAR_WAVE1.md, Шаг 4.
 */
function debtMonthlyInterestRate(country: Country): number {
  const avgHealth = (country.politics.legitimacy + country.politics.stability) / 2;
  const healthShortfall = Math.max(0, Math.min(1, (100 - avgHealth) / 100));
  return DEBT_BASE_MONTHLY_INTEREST_RATE + DEBT_RISK_PREMIUM_COEFFICIENT * healthShortfall;
}

/**
 * Итоговый месячный рост ВВП страны: база (среднее развитие/инфраструктура
 * регионов) + бонус от инвестиций в инфраструктуру − штраф от дефицита,
 * с защитным потолком. `hasGdp=false` — страна без территории (gdp=0:
 * рассинхрон id со сценарием, либо будущая полная оккупация в war-системе) —
 * экономически инертна за этот тик, а не получает NaN от деления на ноль.
 */
function computeGrowthRate(economy: EconomyState, countryRegions: Region[], hasGdp: boolean): number {
  let avgInfrastructure = 0;
  let avgDevelopment = 0;

  if (countryRegions.length > 0) {
    avgInfrastructure = countryRegions.reduce((sum, r) => sum + r.infrastructure, 0) / countryRegions.length;
    avgDevelopment = countryRegions.reduce((sum, r) => sum + r.development, 0) / countryRegions.length;
  }

  const baseGrowthRate =
    BASE_GROWTH_INTERCEPT +
    avgDevelopment * BASE_GROWTH_DEVELOPMENT_COEFFICIENT +
    avgInfrastructure * BASE_GROWTH_INFRASTRUCTURE_COEFFICIENT;

  const infrastructureBonus = hasGdp
    ? economy.infrastructureSpending / economy.gdp * INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT
    : 0;

  const deficitPenalty = hasGdp && economy.budgetBalance < 0
    ? Math.abs(economy.budgetBalance) / economy.gdp * DEFICIT_PENALTY_COEFFICIENT
    : 0;

  // Штраф росту от долговой нагрузки (docs/plans/08_WAR_WAVE1.md, Шаг 4) —
  // считается напрямую как функция состояния (долг/ВВП), не timed-модификатором:
  // это непрерывная зависимость от текущего долга, а не временный эффект, поэтому
  // не требует протаскивать game.modifiers через сигнатуру economyTick.
  const debtBurden = hasGdp ? economy.debt / economy.gdp : 0;
  const debtPenalty = debtBurden > DEBT_GDP_PENALTY_THRESHOLD
    ? (debtBurden - DEBT_GDP_PENALTY_THRESHOLD) * DEBT_GDP_GROWTH_PENALTY_COEFFICIENT
    : 0;

  return Math.min(
    MAX_MONTHLY_GROWTH_RATE,
    Math.max(0, baseGrowthRate + infrastructureBonus - deficitPenalty - debtPenalty)
  );
}

/** Применяет growthRate к ВВП регионов страны, с бонусом от сектора региона. */
function applyGrowthToRegions(countryRegions: Region[], growthRate: number): void {
  for (const region of countryRegions) {
    let sectorBonus = 0;
    if (region.economy) {
      sectorBonus =
        region.economy.industry * SECTOR_INDUSTRY_GROWTH_COEFFICIENT +
        region.economy.services * SECTOR_SERVICES_GROWTH_COEFFICIENT;
    }
    region.gdp *= (1 + growthRate + sectorBonus);
  }
}

/** Инфляция/безработица на основе дефицита бюджета. Без эффекта при gdp=0. */
function updateInflationAndUnemployment(
  economy: EconomyState,
  income: number,
  expenses: number,
  hasGdp: boolean
): void {
  if (!hasGdp) return;

  economy.inflation += INFLATION_DEFICIT_COEFFICIENT * (expenses - income) / economy.gdp;

  economy.unemployment += UNEMPLOYMENT_DEFICIT_COEFFICIENT * (expenses - income) / economy.gdp;
  economy.unemployment = Math.max(0, economy.unemployment);
}

export function economyTick(
  country: Country,
  regions: Region[]
): void {
  const economy = country.economy;
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  const { income, expenses } = updateBudget(country);

  // Инициализируем региональную экономику если нужно
  const regionEconomyService = new RegionEconomyService();
  for (const region of countryRegions) {
    if (!region.economy) {
      regionEconomyService.initializeRegionEconomy(region);
    }
  }

  const hasGdp = economy.gdp > 0;
  const growthRate = computeGrowthRate(economy, countryRegions, hasGdp);
  applyGrowthToRegions(countryRegions, growthRate);
  // ВВП страны обновится через агрегацию в SimulationEngine (aggregateAllCountries,
  // без пересчёта region.gdp — см. shared/src/utils/aggregateCountryData.ts)

  updateInflationAndUnemployment(economy, income, expenses, hasGdp);
}
