/**
 * Шкалы двух величин, которые читают чужие пороги: инфляция/безработица и скор
 * тира.
 *
 * ЗАЧЕМ. Обе величины сравниваются с порогами, заданными где-то ещё, и обе под
 * подозрением из `.agent/audits/formula-audit-2026-07-30.md` (P2). Отчёт — не
 * замер; скрипт отвечает на два вопроса живыми числами:
 *
 *  1. Двигаются ли инфляция и безработица за партию настолько, чтобы их пороги
 *     (`STABILITY_*` в `shared/defines/politics.ts`) вообще срабатывали, и
 *     остаются ли значения в правдоподобном коридоре.
 *  2. Отличается ли ранг по `TierTick.computeScore` от ранга по одному ВВП. Если
 *     не отличается — веса военной силы и влияния декоративны, а тир решает, кто
 *     получает ход LLM.
 *
 * Запуск:  npx tsx scripts/probeScales.ts [--months 120]
 */
// Пороги безработицы переименованы веткой claude/stability-equilibrium
// (ступени заменены непрерывным откликом), ЧИСЛА сохранены: прежний
// LOW = 5 стал REFERENCE, прежний HIGH = 15 — это точка насыщения
// REFERENCE + SATURATION. Смысл проверки не изменился.
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { computeScore, computeTierTotals } from "../src/simulation/tier/TierTick";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import {
  STABILITY_UNEMPLOYMENT_REFERENCE,
  STABILITY_UNEMPLOYMENT_SATURATION,
  STABILITY_HIGH_INFLATION_THRESHOLD,
} from "@shared/defines/politics";
import { MAJOR_COUNT, REGIONAL_COUNT } from "@shared/defines/tier";

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

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

/** Ранги 1..N по убыванию значения; ключ — id страны. */
function ranksByDesc(countries: Country[], value: (c: Country) => number): Map<string, number> {
  const sorted = [...countries].sort((a, b) => value(b) - value(a));
  return new Map(sorted.map((c, i) => [c.id, i + 1]));
}

/**
 * Ранговая корреляция Спирмена. Считается по формуле Пирсона от рангов, а не по
 * упрощённой 1 − 6Σd²/n(n²−1): та верна только без связок, а нулевых военных и
 * нулевого влияния в сценарии много.
 */
function spearman(a: Map<string, number>, b: Map<string, number>): number {
  const ids = [...a.keys()].filter(id => b.has(id));
  const n = ids.length;
  if (n < 2) return Number.NaN;
  const meanA = ids.reduce((s, id) => s + a.get(id)!, 0) / n;
  const meanB = ids.reduce((s, id) => s + b.get(id)!, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (const id of ids) {
    const da = a.get(id)! - meanA;
    const db = b.get(id)! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : Number.NaN;
}

function inflationSnapshot(game: GameState, label: string): void {
  const live = game.countries.filter(c => c.economy.gdp > 0);
  const inflation = live.map(c => c.economy.inflation);
  const unemployment = live.map(c => c.economy.unemployment);

  const crisis = inflation.filter(v => v > STABILITY_HIGH_INFLATION_THRESHOLD).length;
  const deflation = inflation.filter(v => v < 0).length;
  const lowU = unemployment.filter(v => v < STABILITY_UNEMPLOYMENT_REFERENCE).length;
  const highU = unemployment.filter(v => v > (STABILITY_UNEMPLOYMENT_REFERENCE + STABILITY_UNEMPLOYMENT_SATURATION)).length;

  console.log(`\n=== ${label} (${live.length} стран с ВВП) ===`);
  console.log(
    `инфляция:    ${fmt(Math.min(...inflation))}…${fmt(Math.max(...inflation))}, ` +
    `медиана ${fmt(median(inflation))}`
  );
  console.log(
    `  порог кризиса ${STABILITY_HIGH_INFLATION_THRESHOLD}: перешли ${crisis}; ` +
    `дефляция (<0): ${deflation}`
  );
  console.log(
    `безработица: ${fmt(Math.min(...unemployment))}…${fmt(Math.max(...unemployment))}, ` +
    `медиана ${fmt(median(unemployment))}`
  );
  console.log(
    `  ниже ${STABILITY_UNEMPLOYMENT_REFERENCE} (бонус): ${lowU}; ` +
    `выше ${(STABILITY_UNEMPLOYMENT_REFERENCE + STABILITY_UNEMPLOYMENT_SATURATION)} (штраф): ${highU}`
  );
}

/** Насколько велик дефицит относительно ВВП — множитель, который двигает шкалу. */
function deficitScale(game: GameState): void {
  const live = game.countries.filter(c => c.economy.gdp > 0);
  const ratios = live.map(c => -c.economy.budgetBalance / c.economy.gdp);
  console.log(
    `\nдефицит/ВВП за месяц: ${fmt(Math.min(...ratios), 4)}…${fmt(Math.max(...ratios), 4)}, ` +
    `медиана ${fmt(median(ratios), 4)} (положительное = дефицит)`
  );
}

/**
 * Порядки величин трёх компонентов скора. Именно их несопоставимость делала
 * веса декоративными; заодно видно, наполнен ли компонент данными вообще.
 */
function tierComponentScale(game: GameState, label: string): void {
  const live = game.countries.filter(c => c.economy.gdp > 0 || c.military.manpower > 0);
  const gdp = live.reduce((s, c) => s + c.economy.gdp, 0);
  const military = live.reduce((s, c) => s + c.military.manpower + c.military.armyStrength
    + c.military.navyStrength + c.military.airStrength, 0);
  const influence = live.reduce(
    (s, c) => s + Object.values(c.diplomacy.influence).reduce((a, b) => a + b, 0), 0);

  console.log(`\nмировые суммы компонентов тира — ${label}:`);
  console.log(`  ВВП ${gdp.toExponential(2)}, военные ${military.toExponential(2)}, влияние ${influence.toExponential(2)}`);
}

/** Совпадает ли ранг по скору тира с рангом по одному ВВП. */
function tierRankVsGdp(game: GameState, label: string): void {
  const live = game.countries.filter(c => c.economy.gdp > 0 || c.military.manpower > 0);

  const totals = computeTierTotals(live);
  const score = (c: Country) => computeScore(c, totals);

  const byScore = ranksByDesc(live, score);
  const byGdp = ranksByDesc(live, c => c.economy.gdp);

  const identical = live.filter(c => byScore.get(c.id) === byGdp.get(c.id)).length;
  const rho = spearman(byScore, byGdp);

  // Состав верхушки: именно она решает, кто получает ход LLM.
  const topN = MAJOR_COUNT + REGIONAL_COUNT;
  const byScoreDesc = [...live].sort((a, b) => score(b) - score(a));
  const byGdpDesc = [...live].sort((a, b) => b.economy.gdp - a.economy.gdp);
  const topScore = new Set(byScoreDesc.slice(0, topN).map(c => c.id));
  const topGdp = new Set(byGdpDesc.slice(0, topN).map(c => c.id));
  const sameTop = [...topScore].filter(id => topGdp.has(id)).length;

  const majorScore = byScoreDesc.slice(0, MAJOR_COUNT).map(c => c.id);
  const majorGdp = byGdpDesc.slice(0, MAJOR_COUNT).map(c => c.id);

  console.log(`\n=== ранг по тиру против ранга по ВВП — ${label} (${live.length} стран) ===`);
  console.log(`совпавших мест: ${identical} из ${live.length} (${fmt(identical / live.length * 100, 1)}%)`);
  console.log(`ранговая корреляция Спирмена: ${fmt(rho, 4)}`);
  console.log(`верхушка (${topN}): совпало ${sameTop} из ${topN}`);
  console.log(`  major по скору: ${majorScore.join(", ")}`);
  console.log(`  major по ВВП:   ${majorGdp.join(", ")}`);
}

/**
 * Достижим ли кризисный порог вообще. Одна и та же страна в двух прогонах:
 * с обычным бюджетом и с устойчивой бюджетной дырой. Если дыра не выводит
 * инфляцию за порог за партию — порог декоративен, каким бы он ни был.
 */
function deficitReachability(months: number): void {
  const run = (sharesSum: number | null) => {
    const game = createGame("1946", "USA");
    const withGdp = game.countries.filter(c => c.economy.gdp > 0);
    const sorted = [...withGdp].sort((a, b) => b.economy.gdp - a.economy.gdp);
    const subject = sorted[Math.floor(sorted.length / 2)]!;

    // null — бюджет страны не трогаем (как у остального мира). Иначе доли
    // расходов от дохода: сумма > 1 — расходы больше дохода каждый месяц.
    if (sharesSum !== null) {
      const each = sharesSum / 5;
      subject.economy.spendingShares = {
        military: each, research: each, education: each, infrastructure: each, welfare: each,
      };
    }

    let crossedAtMonth = -1;
    for (let month = 0; month < months; month++) {
      simulateMonth(game);
      if (crossedAtMonth === -1 && subject.economy.inflation > STABILITY_HIGH_INFLATION_THRESHOLD) {
        crossedAtMonth = month + 1;
      }
    }
    return {
      id: subject.id,
      inflation: subject.economy.inflation,
      unemployment: subject.economy.unemployment,
      crossedAtMonth,
    };
  };

  const normal = run(null);
  const deficit = run(1.30);

  console.log(`\n=== достижимость порогов: страна ${normal.id}, ${months} месяцев ===`);
  console.log(
    `обычный бюджет (бюджет не тронут): инфляция ${fmt(normal.inflation, 2)}, ` +
    `безработица ${fmt(normal.unemployment, 2)}, ` +
    `порог ${STABILITY_HIGH_INFLATION_THRESHOLD} ${normal.crossedAtMonth === -1 ? "НЕ перейдён" : `перейдён на месяце ${normal.crossedAtMonth}`}`
  );
  console.log(
    `бюджетная дыра (доли 1,30): инфляция ${fmt(deficit.inflation, 2)}, ` +
    `безработица ${fmt(deficit.unemployment, 2)}, ` +
    `порог ${STABILITY_HIGH_INFLATION_THRESHOLD} ${deficit.crossedAtMonth === -1 ? "НЕ перейдён" : `перейдён на месяце ${deficit.crossedAtMonth}`}`
  );
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  inflationSnapshot(game, "старт (месяц 0)");
  tierComponentScale(game, "старт");
  tierRankVsGdp(game, "старт");

  for (let month = 0; month < months; month++) simulateMonth(game);

  inflationSnapshot(game, `через ${months} месяцев`);
  deficitScale(game);
  tierComponentScale(game, `через ${months} месяцев`);
  tierRankVsGdp(game, `через ${months} месяцев`);
  deficitReachability(months);
}

main();
