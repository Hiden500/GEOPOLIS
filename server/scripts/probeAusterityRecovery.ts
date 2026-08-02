/**
 * Стресс-тест обратного хода Правила A (аустерити) на живом мире 1946.
 *
 * ЗАЧЕМ. На калиброванном мире дефицитов после 6-го года нет ни у кого,
 * поэтому живой прогон (probeStabilityRule) показывает восстановление только
 * там, где аустерити случилось само в первые годы. Этот скрипт проверяет
 * ПОЛНЫЙ цикл принудительно: дефицит → аустерити режет доли к полу →
 * профицит → доли возвращаются к стартовым — и меряет осцилляцию, ради
 * которой существует гистерезис AUSTERITY_RECOVERY_SURPLUS_MARGIN.
 *
 * МЕХАНИКА СТРЕССА. Первые `--stress` месяцев каждой ИИ-стране перед тиком
 * задаётся `otherExpenses = 40% дохода` и долг не ниже 0,8 × ВВП — оба условия
 * урезания (дефицит И долг выше порога) выполняются гарантированно. После —
 * `otherExpenses` возвращается к исходному, долг остаётся: гасить его и
 * зарабатывать право на восстановление страна обязана сама, это и есть
 * проверяемый путь.
 *
 * МЕТРИКА ОСЦИЛЛЯЦИИ — число смен направления помесячной динамики доли
 * education (трассер: её не трогают Правила B/C, только аустерити и обратный
 * ход). Здоровый цикл — ровно 2 смены (плато→спад, спад→подъём; подъём→плато
 * сменой не считается, считаются только переходы вниз↔вверх через знак).
 * Больше двух — цикл cut/restore, тот самый, который гистерезис должен убрать.
 *
 * РЕЖИМ --bias N (доля дохода, по умолчанию 0) — структурный дефицит: после
 * стресса каждой стране к базовым otherExpenses добавляется N × доход. Страна
 * со структурным дефицитом НА СТАРТОВЫХ долях — единственный профиль, где
 * узкий гистерезис даёт вечный цикл: восстановление возвращает дефицит,
 * дефицит наращивает долг за порог, аустерити возвращает профицит — и так по
 * кругу. На калиброванном мире без bias такого профиля нет (после 6-го года
 * дефицитов нет ни у кого), поэтому осцилляцию надо провоцировать явно.
 *
 * Запуск:  npx tsx scripts/probeAusterityRecovery.ts [--months 120] [--stress 24] [--bias 0.01]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { AUSTERITY_RECOVERY_SURPLUS_MARGIN } from "@shared/defines/ai";
import { type Country } from "@shared/types/Country";

function argNum(name: string, fallback: number): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  const parsed = Number.parseFloat(argv[i + 1]!);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function income(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

function educationShare(c: Country): number {
  return c.economy.spendingShares?.education ?? Number.NaN;
}

function startEducationShare(c: Country): number {
  return (c.economy.spendingFloor?.educationSpending ?? 0) * 2;
}

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)] ?? Number.NaN;
}

function main(): void {
  const months = Math.round(argNum("months", 120));
  const stressMonths = Math.round(argNum("stress", 24));
  const bias = argNum("bias", 0);
  const game = createGame("1946", "USA");

  const ai = game.countries.filter(
    c =>
      c.id !== game.playerCountryId &&
      c.economy.spendingShares &&
      c.economy.spendingFloor &&
      (c.economy.spendingFloor.educationSpending ?? 0) > 0 &&
      income(c) > 0
  );
  const baseOtherExpenses = new Map(ai.map(c => [c.id, c.economy.otherExpenses]));

  // По каждой стране: история направления движения доли education.
  const lastShare = new Map(ai.map(c => [c.id, educationShare(c)]));
  const lastDir = new Map<string, -1 | 1>();
  const flips = new Map(ai.map(c => [c.id, 0]));
  const monthAtFloor = new Map<string, number>();
  const monthRecovered = new Map<string, number>();

  for (let m = 1; m <= months; m++) {
    const stress = m <= stressMonths;
    for (const c of ai) {
      if (stress) {
        c.economy.otherExpenses = income(c) * 0.4;
        c.economy.debt = Math.max(c.economy.debt, c.economy.gdp * 0.8);
      } else {
        c.economy.otherExpenses = baseOtherExpenses.get(c.id)! + income(c) * bias;
      }
    }

    simulateMonth(game);

    for (const c of ai) {
      const share = educationShare(c);
      const prev = lastShare.get(c.id)!;
      const delta = share - prev;
      if (Math.abs(delta) > 1e-12) {
        const dir: -1 | 1 = delta > 0 ? 1 : -1;
        const prevDir = lastDir.get(c.id);
        if (prevDir !== undefined && prevDir !== dir) {
          flips.set(c.id, flips.get(c.id)! + 1);
        }
        lastDir.set(c.id, dir);
      }
      lastShare.set(c.id, share);

      const floorShare = (c.economy.spendingFloor?.educationSpending ?? 0);
      if (!monthAtFloor.has(c.id) && share <= floorShare + 1e-9) monthAtFloor.set(c.id, m);
      const start = startEducationShare(c);
      if (
        monthAtFloor.has(c.id) &&
        !monthRecovered.has(c.id) &&
        share >= start - 1e-9
      ) {
        monthRecovered.set(c.id, m);
      }
    }
  }

  const cut = ai.filter(c => monthAtFloor.has(c.id));
  const recovered = cut.filter(c => monthRecovered.has(c.id));
  const flipCounts = ai.map(c => flips.get(c.id)!);
  const oscillating = ai.filter(c => flips.get(c.id)! > 2);
  const ratios = ai.map(c => educationShare(c) / startEducationShare(c));

  console.log(
    `margin = ${AUSTERITY_RECOVERY_SURPLUS_MARGIN}, bias = ${bias}, ` +
    `стресс ${stressMonths} мес, всего ${months} мес, стран ${ai.length}`
  );
  console.log(`дорезаны до пола education за стресс: ${cut.length}`);
  console.log(`из них вернулись ровно к стартовой доле: ${recovered.length}`);
  if (recovered.length > 0) {
    const recMonths = recovered.map(c => monthRecovered.get(c.id)! - stressMonths);
    console.log(
      `  месяцев от конца стресса до полного возврата: медиана ${quantile(recMonths, 0.5)}, ` +
      `максимум ${Math.max(...recMonths)}`
    );
  }
  console.log(
    `education к стартовой доле на месяц ${months}: медиана ${quantile(ratios, 0.5).toFixed(2)}, ` +
    `минимум ${Math.min(...ratios).toFixed(2)}, максимум ${Math.max(...ratios).toFixed(2)}`
  );
  console.log(
    `смены направления доли education: максимум ${Math.max(...flipCounts)}, ` +
    `стран с > 2 сменами (осцилляция cut/restore): ${oscillating.length}`
  );
}

main();
