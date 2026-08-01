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
 * Запуск:  npx tsx scripts/probeStabilityRule.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { STABILITY_LOW, WELFARE_CAP_SHARE } from "@shared/defines/ai";
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

function report(game: GameState, label: string): void {
  const ai = game.countries.filter(c => c.id !== game.playerCountryId && c.economy.gdp > 0);
  const stability = ai.map(c => c.politics.stability);
  const below = ai.filter(c => c.politics.stability < STABILITY_LOW);

  // Сколько из задетых правилом реально может сдвинуть бюджет: у остальных
  // welfare уже упёрся в потолок или military лежит на полу, и правило —
  // холостой ход.
  const canShift = below.filter(c => {
    const inc = income(c);
    if (inc <= 0 || !c.economy.spendingFloor) return false;
    const room = inc * WELFARE_CAP_SHARE - c.economy.welfareSpending;
    const donor = c.economy.militarySpending - c.economy.spendingFloor.militarySpending;
    return room > 0 && donor > 0;
  });

  const welfareShare = ai
    .filter(c => income(c) > 0)
    .map(c => c.economy.welfareSpending / income(c));

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
    `упёрлись в потолок welfare: ${welfareShare.filter(v => v >= WELFARE_CAP_SHARE - 1e-9).length} стран`
  );

  // Почему правило перестаёт срабатывать: у него два условия, и надо знать,
  // какое именно закрывается. Донор — military сверх пола (снимок 50% старта).
  const withFloor = below.filter(c => c.economy.spendingFloor);
  const noDonor = withFloor.filter(
    c => c.economy.militarySpending - c.economy.spendingFloor!.militarySpending <= 0
  );
  const noRoom = withFloor.filter(c => income(c) * WELFARE_CAP_SHARE - c.economy.welfareSpending <= 0);
  console.log(
    `  из задетых порогом: без донора (military на полу) ${noDonor.length}, ` +
    `без места (welfare у потолка) ${noRoom.length}`
  );
  const donorShare = withFloor
    .filter(c => income(c) > 0)
    .map(c => (c.economy.militarySpending - c.economy.spendingFloor!.militarySpending) / income(c));
  if (donorShare.length > 0) {
    console.log(
      `  запас military над полом, доля дохода: медиана ${(quantile(donorShare, 0.5) * 100).toFixed(2)}%, ` +
      `максимум ${(Math.max(...donorShare) * 100).toFixed(2)}%`
    );
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
