/**
 * Структура бюджетной росписи на живом сценарии 1946: во что стране обходятся
 * её обязательства и помещаются ли они в доход.
 *
 * ЗАЧЕМ. Пять статей росписи считаются как доля ДОХОДА
 * (`EconomyTick.updateBudget`), а `importSpending`, `otherExpenses` и
 * `debtInterest` ложатся сверху и в росписи не участвуют. Прошлая сессия
 * намерила 84,9% + 7,9% + 17,5% = 110,9% дохода и 68% мира в долгу за первый
 * год. Вопрос, на который отвечает скрипт: сколько это на СЕГОДНЯШНИХ данных
 * сценария и насколько разрыв структурный, а не переходный.
 *
 * ЕДИНИЦЫ. Всё печатается долями дохода того же месяца — в тех же единицах,
 * в которых живут `spendingShares` и `spendingFloor`. Абсолютные суммы
 * (`*Spending`, порядок 1e10) с долями не смешиваются: ровно на этом
 * `probeStabilityRule.ts` однажды печатал мусор, не падая. Страны с нулевым
 * или отрицательным доходом из статистики исключаются и считаются отдельной
 * строкой — деление на такой доход дало бы бесконечность, которая тихо
 * испортила бы медиану.
 *
 * Запуск:  npx tsx scripts/probeBudgetShares.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 120;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
}

function incomeOf(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/** Доли дохода по группам обязательств. Порядок слагаемых — как в updateBudget. */
function breakdown(c: Country, income: number) {
  const e = c.economy;
  const five =
    e.militarySpending +
    e.researchSpending +
    e.educationSpending +
    e.infrastructureSpending +
    e.welfareSpending;
  return {
    five: five / income,
    debtInterest: e.debtInterest / income,
    other: e.otherExpenses / income,
    imports: e.importSpending / income,
    total: (five + e.debtInterest + e.otherExpenses + e.importSpending) / income,
  };
}

function report(game: GameState, label: string): void {
  const all = game.countries;
  const live = all.filter(c => incomeOf(c) > 0);
  const dead = all.length - live.length;

  const rows = live.map(c => breakdown(c, incomeOf(c)));
  const med = (pick: (r: ReturnType<typeof breakdown>) => number) =>
    quantile(rows.map(pick), 0.5);

  const overCommitted = rows.filter(r => r.total > 1).length;
  const inDebt = live.filter(c => c.economy.debt > 0).length;
  const inDeficit = live.filter(c => c.economy.budgetBalance < 0).length;

  console.log(`\n=== ${label} ===`);
  console.log(`стран в выборке: ${live.length} из ${all.length}` +
    (dead > 0 ? ` (исключено с доходом <= 0: ${dead})` : ""));
  console.log(
    `медианные доли дохода: пять статей ${(med(r => r.five) * 100).toFixed(1)}%` +
    ` + проценты по долгу ${(med(r => r.debtInterest) * 100).toFixed(1)}%` +
    ` + прочие ${(med(r => r.other) * 100).toFixed(1)}%` +
    ` + импорт ${(med(r => r.imports) * 100).toFixed(1)}%`
  );
  console.log(
    `  ИТОГО обязательств: медиана ${(med(r => r.total) * 100).toFixed(1)}% дохода` +
    `, квартили ${(quantile(rows.map(r => r.total), 0.25) * 100).toFixed(1)}%` +
    `..${(quantile(rows.map(r => r.total), 0.75) * 100).toFixed(1)}%`
  );
  console.log(
    `  тратят больше дохода: ${overCommitted} стран` +
    ` | в дефиците этого месяца: ${inDeficit}` +
    ` | с долгом: ${inDebt}`
  );
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  report(game, "старт (месяц 0)");

  const checkpoints = [12, 60, months].filter((m, i, all) => m <= months && all.indexOf(m) === i);
  let simulated = 0;
  for (const checkpoint of checkpoints) {
    for (; simulated < checkpoint; simulated++) simulateMonth(game);
    report(game, `через ${checkpoint} месяцев`);
  }
}

main();
