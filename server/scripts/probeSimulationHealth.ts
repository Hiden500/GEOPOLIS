/**
 * Замер здоровья симуляции на ЖИВОМ сценарии 1946 — вход, которого не было у
 * 1276 зелёных тестов.
 *
 * ЗАЧЕМ. Аудит формул 2026-07-30 (`.agent/audits/formula-audit-2026-07-30.md`)
 * показал класс дефекта «формула написана аккуратно, а её вход мёртв»: тесты
 * проверяют функцию на подобранной фикстуре, поэтому константа у всех стран и
 * недостижимый порог им не видны. Этот скрипт печатает распределения, а не
 * ответы на подготовленном примере: разброс между странами и есть предмет.
 *
 * Числа отсюда — доказательная база правок; guard-тесты закрепляют свойства,
 * которые он измеряет (`server/src/simulation/__tests__/longRunGuards.test.ts`).
 *
 * Запуск:  npx tsx scripts/probeSimulationHealth.ts [--months 120]
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
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function spread(values: number[]): { min: number; max: number; span: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}

function fmt(n: number, digits = 4): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

/** Население мира: считаем по регионам, а не по агрегату страны. */
function worldPopulation(game: GameState): number {
  return game.regions.reduce((sum, r) => sum + r.population, 0);
}

function report(game: GameState, label: string): void {
  const countries = game.countries.filter(c => c.economy.gdp > 0);

  const exportRatio = countries.map(c => c.economy.exportIncome / c.economy.gdp);
  const inDebt = countries.filter(c => (c.economy.debt ?? 0) > 0).length;
  const balanceRatio = countries.map(c => c.economy.budgetBalance / c.economy.gdp);

  const legitimacy = countries.map(c => c.politics.legitimacy);
  const corruption = countries.map(c => c.politics.corruption);
  const regionStability = game.regions.map(r => r.stability);

  const biology = countries.map(c => c.technology.domains["biology"] ?? 0);
  const industry = countries.map(c => c.technology.domains["industry"] ?? 0);

  const legSpread = spread(legitimacy);
  const corrSpread = spread(corruption);
  const stabSpread = spread(regionStability);

  console.log(`\n=== ${label} ===`);
  console.log(`страны с gdp>0: ${countries.length}, регионов: ${game.regions.length}`);
  console.log(`население мира: ${(worldPopulation(game) / 1e9).toFixed(3)} млрд`);
  console.log(`exportIncome/gdp: медиана ${fmt(median(exportRatio), 6)}`);
  console.log(`budgetBalance/gdp: медиана ${fmt(median(balanceRatio), 5)}`);
  console.log(`стран в долгу: ${inDebt} из ${countries.length}`);
  console.log(
    `legitimacy: ${fmt(legSpread.min, 1)}…${fmt(legSpread.max, 1)} (разброс ${fmt(legSpread.span, 1)})`
  );
  console.log(
    `corruption: ${fmt(corrSpread.min, 1)}…${fmt(corrSpread.max, 1)} (разброс ${fmt(corrSpread.span, 1)})`
  );
  console.log(
    `region.stability: ${fmt(stabSpread.min, 3)}…${fmt(stabSpread.max, 3)} (разброс ${fmt(stabSpread.span, 3)})`
  );
  console.log(`domains.biology: медиана ${fmt(median(biology), 1)}, максимум ${fmt(Math.max(...biology), 1)}`);
  console.log(`domains.industry: медиана ${fmt(median(industry), 1)}, максимум ${fmt(Math.max(...industry), 1)}`);
}

function main(): void {
  const months = parseMonths();
  // `simulateMonth` напрямую, а не `GameService.advanceMonth`: ход через сервис
  // закрыт LLM-гейтом (`LLMGateError`), а нас интересует именно детерминированная
  // часть — та же, что гоняет campaignSmoke.test.ts.
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
