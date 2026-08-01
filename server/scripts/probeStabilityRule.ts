/**
 * Правило C (низкая stability → сдвиг бюджета к welfare) на живом сценарии.
 *
 * ЗАЧЕМ. `STABILITY_LOW = 40` калибровался под мир, где равновесие стабильности
 * было ≡ 70 у 154 стран из 157 — то есть под порог, который не брал никто.
 * После перевода равновесия на якорь сценария (2026-08-01) распределение стало
 * настоящим, и порог сработал у половины мира. Вопрос не «много или мало», а
 * «что правило делает с теми, кого задело»: сдвиг бюджета к welfare — это
 * реакция на кризис, и если она включена у половины мира постоянно, она
 * перестаёт быть реакцией.
 *
 * ЕДИНИЦЫ (правка 2026-08-01). Скрипт сравнивал АБСОЛЮТНУЮ сумму
 * `militarySpending` (порядок 1e10) с `spendingFloor.militarySpending`, который
 * тем же днём стал ДОЛЕЙ дохода (0,08). Разность всегда выходила огромной и
 * положительной, поэтому «донор есть» получалось у всех задетых, «на полу» — у
 * нуля, а строка «запас military над полом» печатала на самом деле саму долю
 * military. Числа 1 / 0 / 0 из прежних отчётов сняты ДО перевода на доли и к
 * текущему коду не относятся. Здесь всё считается в долях дохода — тех же
 * единицах, в которых живут `spendingShares` и `spendingFloor`.
 *
 * Запуск:  npx tsx scripts/probeStabilityRule.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { STABILITY_LOW, STABILITY_RECOVERED, WELFARE_CAP_SHARE } from "@shared/defines/ai";
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
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)] ?? Number.NaN;
}

function income(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/** Донор Правила C — доля military сверх пола аустерити (пол = 50% старта). */
function donorShare(c: Country): number {
  const shares = c.economy.spendingShares;
  const floor = c.economy.spendingFloor;
  if (!shares || !floor) return 0;
  return shares.military - floor.militarySpending;
}

/** Место под сдвиг — сколько доли дохода welfare не добрал до потолка. */
function roomShare(c: Country): number {
  const shares = c.economy.spendingShares;
  return shares ? WELFARE_CAP_SHARE - shares.welfare : 0;
}

/** Стартовая доля статьи: пол — её половина, значит старт = пол × 2. */
function startMilitaryShare(c: Country): number {
  return (c.economy.spendingFloor?.militarySpending ?? 0) * 2;
}

function startWelfareShare(c: Country): number {
  return (c.economy.spendingFloor?.welfareSpending ?? 0) * 2;
}

function report(game: GameState, label: string): void {
  const ai = game.countries.filter(c => c.id !== game.playerCountryId && c.economy.gdp > 0);
  const stability = ai.map(c => c.politics.stability);
  const below = ai.filter(c => c.politics.stability < STABILITY_LOW);
  const withShares = ai.filter(c => c.economy.spendingShares && c.economy.spendingFloor && income(c) > 0);

  // Сколько из задетых правилом реально может сдвинуть бюджет: у остальных
  // welfare уже упёрся в потолок или military лежит на полу, и правило —
  // холостой ход.
  const canShift = below.filter(c => donorShare(c) > 0 && roomShare(c) > 0);

  const welfareShare = withShares.map(c => c.economy.spendingShares!.welfare);
  const militaryShare = withShares.map(c => c.economy.spendingShares!.military);

  console.log(`\n=== ${label} ===`);
  console.log(
    `stability ИИ-стран: ${Math.min(...stability).toFixed(1)}…${Math.max(...stability).toFixed(1)}, ` +
    `медиана ${quantile(stability, 0.5).toFixed(1)}`
  );
  console.log(
    `ниже порога ${STABILITY_LOW}: ${below.length} из ${ai.length} ` +
    `(${((below.length / ai.length) * 100).toFixed(0)}%), из них правило реально двигает бюджет: ${canShift.length}`
  );
  console.log(
    `доля welfare в доходе: медиана ${(quantile(welfareShare, 0.5) * 100).toFixed(1)}%, ` +
    `p90 ${(quantile(welfareShare, 0.9) * 100).toFixed(1)}%, потолок ${(WELFARE_CAP_SHARE * 100).toFixed(0)}%`
  );
  console.log(
    `доля military в доходе: медиана ${(quantile(militaryShare, 0.5) * 100).toFixed(1)}%, ` +
    `p10 ${(quantile(militaryShare, 0.1) * 100).toFixed(1)}%`
  );
  console.log(
    `упёрлись в потолок welfare: ${welfareShare.filter(v => v >= WELFARE_CAP_SHARE - 1e-9).length} стран`
  );

  // Почему правило перестаёт срабатывать: у него два условия, и надо знать,
  // какое именно закрывается. Донор — military сверх пола (снимок 50% старта).
  const noDonor = below.filter(c => donorShare(c) <= 0);
  const noRoom = below.filter(c => roomShare(c) <= 0);
  console.log(
    `  из задетых порогом: без донора (military на полу) ${noDonor.length}, ` +
    `без места (welfare у потолка) ${noRoom.length}`
  );
  const donors = below.filter(c => c.economy.spendingShares && c.economy.spendingFloor).map(donorShare);
  if (donors.length > 0) {
    console.log(
      `  запас military над полом, доля дохода: медиана ${(quantile(donors, 0.5) * 100).toFixed(2)}%, ` +
      `максимум ${(Math.max(...donors) * 100).toFixed(2)}%`
    );
  }

  // ХРАПОВИК. Правило снимает долю с military в кризис и (до правки) никогда не
  // возвращает. «Осевшие» — страны, у которых military ниже стартовой доли, а
  // кризис давно закончился: это и есть цена односторонности.
  const drained = withShares.filter(c => c.economy.spendingShares!.military < startMilitaryShare(c) - 1e-9);
  const drainedStability = drained.map(c => c.politics.stability);
  console.log(
    `  храповик: military ниже стартовой доли у ${drained.length} стран; их stability — ` +
    (drained.length > 0
      ? `медиана ${quantile(drainedStability, 0.5).toFixed(1)}, ` +
        `выше порога ${STABILITY_LOW}: ${drainedStability.filter(v => v >= STABILITY_LOW).length}, ` +
        `выше ${STABILITY_RECOVERED}: ${drainedStability.filter(v => v >= STABILITY_RECOVERED).length}`
      : "—")
  );

  // Кто из просевших уже вышел из кризиса — и почему возврат у него не идёт.
  // Две границы возврата закрываются по разным причинам, и лечатся они тоже
  // по-разному: место под military — это Правило C, донор welfare — Правило A.
  const recovered = drained.filter(c => c.politics.stability >= STABILITY_RECOVERED);
  const returning = recovered.filter(
    c => c.economy.spendingShares!.welfare > startWelfareShare(c) + 1e-9
  );
  console.log(
    `  из них кризис позади у ${recovered.length}: возврат идёт у ${returning.length}, ` +
    `заперт полом welfare (урезание Правила A) у ${recovered.length - returning.length}`
  );
  // Трассер аустерити: education Правило C не трогает вовсе, поэтому его
  // отношение к стартовой доле показывает ЧИСТОЕ действие Правила A. 1,0 —
  // аустерити не было, 0,5 — дорезано до пола.
  if (recovered.length > 0) {
    const tracer = recovered
      .filter(c => (c.economy.spendingFloor?.educationSpending ?? 0) > 0)
      .map(c => c.economy.spendingShares!.education / (c.economy.spendingFloor!.educationSpending * 2));
    if (tracer.length > 0) {
      console.log(
        `  трассер аустерити (education к стартовой доле): медиана ${quantile(tracer, 0.5).toFixed(2)}, ` +
        `минимум ${Math.min(...tracer).toFixed(2)}, максимум ${Math.max(...tracer).toFixed(2)}`
      );
    }
  }
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
