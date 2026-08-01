/**
 * Замер равновесия стабильности на ЖИВОМ сценарии 1946 — по образцу
 * `probeSimulationHealth.ts`.
 *
 * ЗАЧЕМ. Аудит формул 2026-07-30 заявил: «все пять ветвей `stabilityEquilibrium`
 * дают одинаковый ответ 154 странам из 157», то есть вход формулы выродился в
 * константу. Числа аудита сняты до влития баз легитимности, стартовой политики
 * из структурных базисов и цены репрессии — распределение могло измениться, и
 * отчёт здесь не свидетельство. Скрипт печатает само распределение: сколько
 * различных равновесий в мире, какой у них разброс и какая КОМБИНАЦИЯ ветвей
 * срабатывает у скольких стран.
 *
 * Запуск:  npx tsx scripts/probeStabilityEquilibrium.ts [--months 24]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { stabilityEquilibrium } from "../src/simulation/politics/PoliticsTick";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { stabilityBase } from "@shared/utils/politics";
import { type Region } from "@shared/types/map/Region";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 24;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Стандартное отклонение — мера «различает ли вход страны». Разброс max−min
 * ловят два выброса, sd ловит форму распределения.
 */
function stdev(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Регионы одной страны — тем же выражением, что и в тике. */
function regionsOf(game: GameState, country: Country): Region[] {
  return game.regions.filter(r => r.ownerCountryId === country.id);
}

/**
 * Разложение равновесия на слагаемые: якорь отдельно, каждая поправка отдельно.
 * Оно и отвечает на вопрос «что именно различает страны, а что выродилось» —
 * для непрерывной формы это информативнее подсчёта сработавших ветвей.
 */
function contributions(game: GameState, country: Country): Record<string, number> {
  const anchor = stabilityBase(regionsOf(game, country));
  const total = stabilityEquilibrium(country, regionsOf(game, country));
  return { anchor, total, adjustments: total - anchor };
}

function histogram(values: number[], buckets = 10): string[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!(max > min)) return [`  всё в одной точке: ${fmt(min)}`];
  const width = (max - min) / buckets;
  const counts = new Array<number>(buckets).fill(0);
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor((v - min) / width));
    counts[idx]! += 1;
  }
  return counts.map((count, i) => {
    const lo = min + width * i;
    const hi = lo + width;
    const bar = "#".repeat(Math.round((count / values.length) * 60));
    return `  [${fmt(lo)}…${fmt(hi)}) ${String(count).padStart(4)} ${bar}`;
  });
}

function report(game: GameState, label: string): void {
  const countries = game.countries.filter(c => c.economy.gdp > 0);
  const equilibria = countries.map(c => stabilityEquilibrium(c, regionsOf(game, c)));
  const actual = countries.map(c => c.politics.stability);

  const distinct = new Set(equilibria.map(v => v.toFixed(4)));
  const modal = new Map<string, number>();
  for (const key of equilibria.map(v => v.toFixed(4))) modal.set(key, (modal.get(key) ?? 0) + 1);
  const [modalValue, modalCount] = [...modal.entries()].sort((a, b) => b[1] - a[1])[0]!;

  const parts = countries.map(c => contributions(game, c));
  const anchors = parts.map(p => p.anchor!);
  const adjustments = parts.map(p => p.adjustments!);

  console.log(`\n=== ${label} ===`);
  console.log(`стран с gdp>0: ${countries.length}`);
  console.log(
    `stabilityEquilibrium: ${fmt(Math.min(...equilibria))}…${fmt(Math.max(...equilibria))}, ` +
      `медиана ${fmt(median(equilibria))}, sd ${fmt(stdev(equilibria))}`
  );
  console.log(
    `различных значений: ${distinct.size}; модальное ${modalValue} у ${modalCount} стран ` +
      `(${fmt((modalCount / countries.length) * 100, 1)}%)`
  );
  console.log(
    `фактическая politics.stability: ${fmt(Math.min(...actual))}…${fmt(Math.max(...actual))}, ` +
      `sd ${fmt(stdev(actual))}, различных ${new Set(actual.map(v => v.toFixed(4))).size}`
  );
  console.log(
    `  из них якорь сценария: ${fmt(Math.min(...anchors))}…${fmt(Math.max(...anchors))} ` +
      `(sd ${fmt(stdev(anchors))}, различных ${new Set(anchors.map(v => v.toFixed(4))).size}); ` +
      `сумма поправок: ${fmt(Math.min(...adjustments))}…${fmt(Math.max(...adjustments))} ` +
      `(sd ${fmt(stdev(adjustments))})`
  );
  console.log("гистограмма равновесия:");
  for (const line of histogram(equilibria)) console.log(line);
}

/** Разброс самих ВХОДОВ формулы — чтобы видеть, что именно выродилось. */
function reportInputs(game: GameState, label: string): void {
  const countries = game.countries.filter(c => c.economy.gdp > 0);
  const show = (name: string, values: number[], digits = 4): void => {
    console.log(
      `  ${name.padEnd(22)} ${fmt(Math.min(...values), digits)}…${fmt(Math.max(...values), digits)} ` +
        `медиана ${fmt(median(values), digits)} различных ${new Set(values.map(v => v.toFixed(6))).size}`
    );
  };

  console.log(`\n--- входы формулы, ${label} ---`);
  show("unemployment", countries.map(c => c.economy.unemployment), 2);
  show("inflation", countries.map(c => c.economy.inflation), 2);
  show("budgetBalance/gdp", countries.map(c => c.economy.budgetBalance / c.economy.gdp), 5);
  show("corruption", countries.map(c => c.politics.corruption), 2);
  show("legitimacy", countries.map(c => c.politics.legitimacy), 2);
  show("debt/gdp", countries.map(c => (c.economy.debt ?? 0) / c.economy.gdp), 4);
  show("region.stability (нас.-взв.)", countries.map(c => {
    const regions = game.regions.filter(r => r.ownerCountryId === c.id);
    const pop = regions.reduce((s, r) => s + r.population, 0);
    if (pop <= 0) return 0;
    return regions.reduce((s, r) => s + r.stability * r.population, 0) / pop;
  }), 4);
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  report(game, "старт (месяц 0)");
  reportInputs(game, "старт");

  for (let m = 0; m < months; m++) simulateMonth(game);

  report(game, `через ${months} месяцев`);
  reportInputs(game, `через ${months} месяцев`);
}

main();
