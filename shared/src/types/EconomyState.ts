export interface EconomyState {
  gdp: number;

  treasury: number;

  taxRevenue: number;

  // Эффективная налоговая ставка, выводится при старте партии (createGame) как
  // taxRevenue/gdp. Не данные сценария — рантайм-поле, поэтому опционально.
  // EconomyTick пересчитывает taxRevenue = gdp × taxRate каждый ход (доход
  // следует за ВВП). См. docs/DECISIONS.md (2026-06-23).
  taxRate?: number;

  exportIncome: number;

  stateEnterpriseIncome: number;

  otherIncome: number;

  militarySpending: number;

  researchSpending: number;

  educationSpending: number;

  infrastructureSpending: number;

  welfareSpending: number;

  debtInterest: number;

  otherExpenses: number;

  inflation: number;

  unemployment: number;

  tradeBalance: number;

  budgetBalance: number;

  // Снимок 50% стартовых дискреционных расходов — пол для ИИ-аустерити
  // (Правило A в aiBehaviorTick): расходы не урезаются ниже этого уровня.
  // Рантайм-поле, выставляется в createGame. См. docs/DECISIONS.md (2026-06-23).
  spendingFloor?: {
    militarySpending: number;
    researchSpending: number;
    educationSpending: number;
    infrastructureSpending: number;
    welfareSpending: number;
  };
}