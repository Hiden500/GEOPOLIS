import { type EconomyState } from "../types/EconomyState";

/**
 * Placeholder EconomyState с нулевыми денежными полями. createGame выводит
 * реальные значения из economyProfile × gdp после агрегации регионов — см.
 * server/src/data/countries/templates/CreateCountry.ts, docs/ECONOMY.md.
 *
 * Перенесено из shared/src/constants/ (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — не числовая константа в строгом смысле, но тот же класс
 * «дефолтных баланс-значений вне simulation/**», что и остальной defines/.
 */
export function createEmptyEconomyState(): EconomyState {
  return {
    gdp: 0,
    treasury: 0,
    taxRevenue: 0,
    exportIncome: 0,
    stateEnterpriseIncome: 0,
    otherIncome: 0,
    militarySpending: 0,
    researchSpending: 0,
    educationSpending: 0,
    infrastructureSpending: 0,
    welfareSpending: 0,
    debtInterest: 0,
    otherExpenses: 0,
    inflation: 0,
    unemployment: 0,
    tradeBalance: 0,
    budgetBalance: 0,
  };
}
