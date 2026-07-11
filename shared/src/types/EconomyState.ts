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

  // Расход на импорт ресурсов, которых не хватает до внутреннего резерва
  // (docs/TRADE.md, "Явные пробелы v1" → импорт дефицита) — симметрично
  // exportIncome, перезаписывается каждый тик TradeTick.ts, учитывается как
  // расход в EconomyTick.ts::updateBudget().
  importSpending: number;

  stateEnterpriseIncome: number;

  otherIncome: number;

  militarySpending: number;

  researchSpending: number;

  educationSpending: number;

  infrastructureSpending: number;

  welfareSpending: number;

  // Накопленный госдолг (docs/plans/08_WAR_WAVE1.md, Шаг 4). Дефицит бюджета,
  // который не покрывает казна, конвертируется в долг (EconomyTick), казна не
  // уходит в бесконечный минус. debtInterest = debt × ставка (ставка выше при
  // низкой legitimacy/stability). Долг/ВВП выше порога штрафует рост ВВП и
  // рождает мировой факт «на грани дефолта».
  debt: number;

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

  // Доли income по категориям (тот же паттерн, что и EconomyProfile.spending,
  // но задаётся игроком через PUT /budget, не при createGame). Опционально —
  // ИИ-страны его не имеют, их *Spending остаются абсолютными числами,
  // которые двигает AiBehaviorTick напрямую. Когда задано, EconomyTick
  // пересчитывает militarySpending/.../welfareSpending = income × доля
  // каждый тик (тот же паттерн, что taxRate → taxRevenue). См.
  // docs/DECISIONS.md (2026-07-04, "Бюджет: доли/проценты").
  spendingShares?: {
    military: number;
    research: number;
    education: number;
    infrastructure: number;
    welfare: number;
  };
}