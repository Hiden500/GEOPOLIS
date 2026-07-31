/**
 * Держится ли экспортный доход и что он делает с бюджетом мира.
 *
 * ЗАЧЕМ. `exportIncome` нёс два разных смысла: базовую внешнюю торговлю из
 * профиля страны (3–6% ВВП) и выручку от продажи излишков сырья (~0,0001 ВВП),
 * причём второе затирало первое на первом же тике. Скрипт меряет, что осталось
 * после перевода на сложение, и главное — как это сказалось на долге мира,
 * ради которого правка и делалась.
 *
 * Запуск:  npx tsx scripts/probeExportIncome.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 120;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function fmt(value: number, digits = 4): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function report(game: GameState, label: string): void {
  const solvent = game.countries.filter(c => c.economy.gdp > 0);
  const ratio = solvent.map(c => c.economy.exportIncome / c.economy.gdp);
  const balance = solvent.map(c => c.economy.budgetBalance / c.economy.gdp);
  const debt = solvent.map(c => c.economy.debt / c.economy.gdp);
  const inDebt = solvent.filter(c => c.economy.debt > 0).length;
  const heavy = solvent.filter(c => c.economy.debt / c.economy.gdp > 1).length;

  console.log(`\n=== ${label} ===`);
  console.log(`exportIncome/gdp: медиана ${fmt(median(ratio), 5)}, ` +
    `${fmt(Math.min(...ratio), 5)}…${fmt(Math.max(...ratio), 5)}`);
  console.log(`budgetBalance/gdp: медиана ${fmt(median(balance), 5)}`);
  console.log(`стран в долгу: ${inDebt} из ${solvent.length}, из них долг/ВВП > 1: ${heavy}`);
  console.log(`долг/ВВП: медиана ${fmt(median(debt), 3)}, максимум ${fmt(Math.max(...debt), 1)}`);
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  report(game, "старт (месяц 0)");

  const checkpoints = [1, 12, 60, months].filter((m, i, all) => m <= months && all.indexOf(m) === i);
  let simulated = 0;
  for (const checkpoint of checkpoints) {
    for (; simulated < checkpoint; simulated++) simulateMonth(game);
    report(game, `через ${checkpoint} месяцев`);
  }
}

main();
