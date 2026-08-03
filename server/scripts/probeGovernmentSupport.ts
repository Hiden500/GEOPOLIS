/**
 * Замер равновесия governmentSupport на ЖИВОМ сценарии 1946 — по образцу
 * `probeStabilityEquilibrium.ts`.
 *
 * ЗАЧЕМ. Прогон 240 месяцев (E2 движкового work-order) показал
 * `governmentSupport` = 65,00 у всех 157 стран — мировая константа. Причина в
 * том, что все входы `governmentSupportEquilibrium` на живом мире не различали
 * страны (пороговые ступени вне живого диапазона). 2026-08-02 среда изменилась:
 * Правило A стало двусторонним, страны не сидят вечно на урезанном бюджете —
 * поэтому вклад каждого входа перемеряется здесь, а не берётся из старого
 * отчёта. Скрипт печатает распределение равновесия и КАЖДОГО входа-кандидата
 * на 0/12/60/120 месяцах.
 *
 * Запуск:  npx tsx scripts/probeGovernmentSupport.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import {
  governmentSupportEquilibrium,
  stabilityEquilibrium,
} from "../src/simulation/politics/PoliticsTick";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { regionDiscontent } from "@shared/utils/discontent";

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function stdev(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function regionsOf(game: GameState, country: Country): Region[] {
  return game.regions.filter(r => r.ownerCountryId === country.id);
}

function income(c: Country): number {
  return (
    c.economy.taxRevenue +
    c.economy.exportIncome +
    c.economy.stateEnterpriseIncome +
    c.economy.otherIncome
  );
}

/** Население-взвешенное недовольство регионов страны; NaN — ни один регион не размечен. */
function countryDiscontent(game: GameState, country: Country): number {
  let pop = 0;
  let weighted = 0;
  for (const region of regionsOf(game, country)) {
    const d = regionDiscontent(game, region);
    if (d === undefined) continue;
    pop += region.population;
    weighted += d * region.population;
  }
  return pop > 0 ? weighted / pop : Number.NaN;
}

/** Доля населения страны под чужой оккупацией — «война на своей территории». */
function occupiedPopulationShare(game: GameState, country: Country): number {
  let pop = 0;
  let occupied = 0;
  for (const region of regionsOf(game, country)) {
    pop += region.population;
    if (region.occupiedBy !== undefined && region.occupiedBy !== country.id) {
      occupied += region.population;
    }
  }
  return pop > 0 ? occupied / pop : 0;
}

function show(name: string, values: number[], digits = 4): void {
  const finite = values.filter(v => Number.isFinite(v));
  const nanCount = values.length - finite.length;
  if (finite.length === 0) {
    console.log(`  ${name.padEnd(28)} нет конечных значений (${values.length} NaN)`);
    return;
  }
  console.log(
    `  ${name.padEnd(28)} ${fmt(Math.min(...finite), digits)}…${fmt(Math.max(...finite), digits)} ` +
      `медиана ${fmt(median(finite), digits)} sd ${fmt(stdev(finite), digits)} ` +
      `различных ${new Set(finite.map(v => v.toFixed(6))).size}` +
      (nanCount > 0 ? ` (n/a у ${nanCount})` : "")
  );
}

function report(game: GameState, label: string): void {
  const countries = game.countries.filter(c => c.economy.gdp > 0);
  const equilibria = countries.map(c => governmentSupportEquilibrium(c, regionsOf(game, c), game));
  const actual = countries.map(c => c.politics.governmentSupport);

  const distinct = new Set(equilibria.map(v => v.toFixed(4)));
  const modal = new Map<string, number>();
  for (const key of equilibria.map(v => v.toFixed(4))) modal.set(key, (modal.get(key) ?? 0) + 1);
  const [modalValue, modalCount] = [...modal.entries()].sort((a, b) => b[1] - a[1])[0]!;

  console.log(`\n=== ${label} ===`);
  console.log(`стран с gdp>0: ${countries.length}`);
  console.log(
    `govSupportEquilibrium: ${fmt(Math.min(...equilibria))}…${fmt(Math.max(...equilibria))}, ` +
      `медиана ${fmt(median(equilibria))}, sd ${fmt(stdev(equilibria))}`
  );
  console.log(
    `различных значений: ${distinct.size}; модальное ${modalValue} у ${modalCount} стран ` +
      `(${fmt((modalCount / countries.length) * 100, 1)}%)`
  );
  console.log(
    `фактический politics.governmentSupport: ${fmt(Math.min(...actual))}…${fmt(Math.max(...actual))}, ` +
      `медиана ${fmt(median(actual))}, sd ${fmt(stdev(actual))}, ` +
      `различных ${new Set(actual.map(v => v.toFixed(4))).size}`
  );

  console.log("--- входы-кандидаты ---");
  show("unemployment", countries.map(c => c.economy.unemployment), 2);
  show("budgetBalance/income", countries.map(c => {
    const inc = income(c);
    return inc > 0 ? c.economy.budgetBalance / inc : Number.NaN;
  }));
  show("welfareShare (welf/income)", countries.map(c => {
    const inc = income(c);
    return inc > 0 ? c.economy.welfareSpending / inc : Number.NaN;
  }));
  show("floorShare (welfare)", countries.map(c => c.economy.spendingFloor?.welfareSpending ?? Number.NaN));
  show("welfareShare/floorShare", countries.map(c => {
    const inc = income(c);
    const floor = c.economy.spendingFloor?.welfareSpending ?? 0;
    return inc > 0 && floor > 0 ? c.economy.welfareSpending / inc / floor : Number.NaN;
  }));
  show("stabilityGap (eq−actual)", countries.map(c =>
    stabilityEquilibrium(c, regionsOf(game, c)) - c.politics.stability
  ));
  show("countryDiscontent", countries.map(c => countryDiscontent(game, c)));
  show("occupiedPopShare", countries.map(c => occupiedPopulationShare(game, c)));
}

function main(): void {
  const game = createGame("1946", "USA");
  const checkpoints = [0, 12, 60, 120];
  const maxMonth = Math.max(...checkpoints);

  let month = 0;
  for (const checkpoint of checkpoints) {
    while (month < checkpoint) {
      simulateMonth(game);
      month++;
    }
    report(game, `месяц ${checkpoint}`);
    if (checkpoint === maxMonth) break;
  }
}

main();
