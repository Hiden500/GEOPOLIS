export interface EconomyState {
  gdp: number;

  treasury: number;

  taxRevenue: number;

  // Эффективная налоговая ставка, выводится при старте партии (createGame) как
  // taxRevenue/gdp. Не данные сценария — рантайм-поле, поэтому опционально.
  // EconomyTick пересчитывает taxRevenue = gdp × taxRate каждый ход (доход
  // следует за ВВП). См. docs/DECISIONS.md (2026-06-23).
  taxRate?: number;

  // Доход от внешней торговли: базовая часть (ВВП × economyProfile.exportShare —
  // авторская доля страны) ПЛЮС выручка от продажи излишков сырья, обе под
  // множителями эмбарго и валютной зоны. Складываются каждый тик в TradeTick.ts.
  // До 2026-07-31 тик ЗАТИРАЛ поле сырьевой частью, и 3–6% ВВП превращались в
  // 0,0001 на первом же ходу (docs/DECISIONS.md, 2026-07-31).
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

  // Пол дискреционных расходов для ИИ-аустерити (Правило A) — ПОЛОВИНА
  // стартовой ДОЛИ каждой статьи в доходе. Рантайм-поле, выставляется в
  // createGame.
  //
  // ШКАЛА СМЕНИЛАСЬ 2026-08-01 (SAVE_VERSION 11→12): это были абсолютные суммы,
  // снимок 50% стартовых расходов. Пока расходы ИИ сами были абсолютными, пол в
  // тех же единицах работал; после перевода расходов на доли фиксированная сумма
  // стала бессмысленной — доход растёт, и пол-в-деньгах перестаёт быть полом.
  // Ключи оставлены прежними (`militarySpending` и т.д.), чтобы не переписывать
  // каждого потребителя, но ЗНАЧЕНИЕ теперь доля дохода, а не деньги.
  spendingFloor?: {
    militarySpending: number;
    researchSpending: number;
    educationSpending: number;
    infrastructureSpending: number;
    welfareSpending: number;
  };

  // Доли income по категориям (тот же паттерн, что и EconomyProfile.spending).
  // Игрок задаёт их через PUT /budget, ИИ-страны получают при createGame из
  // авторского профиля, а `EconomyTick` каждый тик пересчитывает из них
  // militarySpending/.../welfareSpending = income × доля — тот же паттерн, что
  // taxRate → taxRevenue.
  //
  // ЕСТЬ У ВСЕХ С 2026-08-01. Раньше ИИ-страны их не имели: их расходы были
  // абсолютными числами, которые двигал AiBehaviorTick. Замер показал, во что
  // это обходится — расходы не следовали за доходом вовсе, доля military падала
  // 16,00% → 6,95% за 120 месяцев, Правило C умирало за первый год (донор
  // упирался в пол), а неизрасходованный доход копился профицитом +13% ВВП.
  // Правила ИИ переведены на доли, поэтому пересчёт тика их больше не стирает
  // (`docs/DECISIONS.md`, 2026-08-01).
  spendingShares?: {
    military: number;
    research: number;
    education: number;
    infrastructure: number;
    welfare: number;
  };
}