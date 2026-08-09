/**
 * Замер: ЖИВ ЛИ характер страны (`Country.aiTraits`) на реальном сценарии 1946.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, ЕСЛИ ЕСТЬ ЮНИТ-ТЕСТЫ. Тесты `AiBehaviorTick.test.ts`
 * доказывают, что функция СЧИТАЕТ: на фикстуре, где состояние выставлено строго
 * между порогами двух характеров, страны ведут себя по-разному. Они не
 * доказывают, что вход ЖИВОЙ, — что в настоящей партии хоть одна страна попадает
 * в зазор между порогами. Ровно так `Country.aiTraits` и осиротели: удалённое
 * Правило D было покрыто зелёными тестами и при этом не срабатывало ни разу за
 * партию (`AiBehaviorTick.ts`, разбор на месте Правила D).
 *
 * ПОЧЕМУ РАЗБРОСА НЕДОСТАТОЧНО КАК ДОКАЗАТЕЛЬСТВА. Страны 1946 расходятся по
 * долям бюджета и без всякого характера: у них разные `economyProfile`, разный
 * долг, разная стабильность. Поэтому здесь считается не разброс, а РАЗНИЦА ДВУХ
 * МИРОВ на ОДНОМ сиде:
 *
 *   A — партия как есть (характеры живые);
 *   B — та же партия, но сразу после `createGame` все `aiTraits` зажаты в 1.0,
 *       то есть пороги у всех общие — поведение до 2026-08-09.
 *
 * Сид один, значит стартовое состояние, порядок тиков и вся прочая случайность
 * в обоих мирах совпадают: любое расхождение колонок объясняется характером и
 * ничем другим. Плюс к разнице считается КОРРЕЛЯЦИЯ значения признака с исходом
 * по странам — она отвечает на вопрос «а в ту ли сторону действует признак».
 *
 * Запуск (cwd: server/):
 *   npx tsx scripts/probeAiTraits.ts [--seed 12345] [--months 120] [--player USA]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";
import { STABILITY_LOW } from "@shared/defines/ai";
import { DEBT_GDP_PENALTY_THRESHOLD } from "@shared/defines/economy";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

/** Наблюдение по одной стране за партию. */
interface Trace {
  id: string;
  aggressiveness: number;
  riskTolerance: number;
  /** Месяц, когда Правило C впервые сняло деньги с армии; null — не сняло ни разу. */
  firstCrisisShift: number | null;
  /** Месяц, когда Правило A впервые урезало расходы; null — не урезало. */
  firstAusterity: number | null;
  /** Доля military в располагаемом доходе на последнем месяце. */
  militaryShare: number;
  welfareShare: number;
}

function traceCampaign(seed: number, player: string, months: number, neutral: boolean): Trace[] {
  const game: GameState = createGame("1946", player, undefined, seed);
  if (neutral) {
    for (const c of game.countries) c.aiTraits = { aggressiveness: 1, riskTolerance: 1 };
  }

  const traces = new Map<string, Trace>();
  const prevMilitary = new Map<string, number>();
  const prevEducation = new Map<string, number>();
  for (const c of game.countries) {
    traces.set(c.id, {
      id: c.id,
      aggressiveness: c.aiTraits.aggressiveness,
      riskTolerance: c.aiTraits.riskTolerance,
      firstCrisisShift: null,
      firstAusterity: null,
      militaryShare: Number.NaN,
      welfareShare: Number.NaN,
    });
    prevMilitary.set(c.id, c.economy.spendingShares?.military ?? Number.NaN);
    prevEducation.set(c.id, c.economy.spendingShares?.education ?? Number.NaN);
  }

  for (let month = 1; month <= months; month++) {
    simulateMonth(game);
    for (const c of game.countries) {
      const t = traces.get(c.id);
      const shares = c.economy.spendingShares;
      if (!t || !shares) continue;

      // Правило C узнаётся по паре military↓/welfare↑ в один месяц; Правило A —
      // по education↓ (аустерити режет ВСЕ пять статей, а education не трогает
      // больше никто, поэтому он и есть чистый индикатор урезания).
      const milDown = shares.military < (prevMilitary.get(c.id) ?? shares.military) - 1e-12;
      const eduDown = shares.education < (prevEducation.get(c.id) ?? shares.education) - 1e-12;
      if (t.firstCrisisShift === null && milDown && !eduDown) t.firstCrisisShift = month;
      if (t.firstAusterity === null && eduDown) t.firstAusterity = month;

      prevMilitary.set(c.id, shares.military);
      prevEducation.set(c.id, shares.education);
      t.militaryShare = shares.military;
      t.welfareShare = shares.welfare;
    }
  }

  return [...traces.values()];
}

/** Коэффициент корреляции Пирсона; NaN, если одна из выборок вырождена. */
function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return Number.NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : Number.NaN;
}

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function main(): void {
  const seed = Number.parseInt(arg("seed", "20260809"), 10);
  const months = Number.parseInt(arg("months", "120"), 10);
  const player = arg("player", "USA");

  console.log(`сид ${seed} | ${months} месяцев | игрок ${player}`);
  console.log("прогон A — характеры живые…");
  const live = traceCampaign(seed, player, months, false);
  console.log("прогон B — все aiTraits зажаты в 1.0 (поведение до 2026-08-09)…\n");
  const flat = traceCampaign(seed, player, months, true);

  const byId = new Map(flat.map(t => [t.id, t]));
  const paired = live.filter(t => byId.has(t.id));

  // 1. Разошлись ли миры вообще.
  const changedCrisis = paired.filter(t => t.firstCrisisShift !== byId.get(t.id)!.firstCrisisShift);
  const changedAusterity = paired.filter(t => t.firstAusterity !== byId.get(t.id)!.firstAusterity);
  const changedShare = paired.filter(
    t => Math.abs(t.militaryShare - byId.get(t.id)!.militaryShare) > 1e-9
  );

  console.log(`стран в сравнении: ${paired.length}`);
  console.log(
    `  момент первого сдвига Правила C изменился у ${changedCrisis.length}\n` +
      `  момент первого урезания Правила A изменился у ${changedAusterity.length}\n` +
      `  итоговая доля military отличается у ${changedShare.length}`
  );

  const inCrisisLive = paired.filter(t => t.firstCrisisShift !== null).length;
  const inCrisisFlat = flat.filter(t => t.firstCrisisShift !== null).length;
  console.log(
    `  под Правило C попало: ${inCrisisLive} с характерами против ${inCrisisFlat} без них ` +
      `(порог базы ${STABILITY_LOW})`
  );

  // 2. В ТУ ЛИ СТОРОНУ действует признак.
  //
  // ПОЧЕМУ НЕ КОРРЕЛЯЦИЯ С МОМЕНТОМ ВХОДА. Она здесь ничего не измеряет:
  // стабильность 1946 такова, что подавляющее большинство кризисных стран
  // входит в Правило C на ПЕРВОМ же месяце, и «момент» у них константа —
  // выборка вырождена, корреляция болтается около нуля независимо от знака
  // множителя. Характер решает не «когда войдёт», а «войдёт ли вообще».
  //
  // Поэтому проверка направления построена на странах, чей ИСХОД РАЗОШЁЛСЯ
  // между мирами. Тавтологии здесь нет: попадание в эту группу определяется
  // сравнением двух прогонов, а проверяется независимая величина — знак
  // отклонения характера от нейтрального.
  const avoided = paired.filter(
    t => t.firstCrisisShift === null && byId.get(t.id)!.firstCrisisShift !== null
  );
  const succumbed = paired.filter(
    t => t.firstCrisisShift !== null && byId.get(t.id)!.firstCrisisShift === null
  );
  const meanAgg = (xs: Trace[]) =>
    xs.length === 0 ? Number.NaN : xs.reduce((s, t) => s + t.aggressiveness, 0) / xs.length;
  console.log(
    `\nнаправление признака (aggressiveness, нейтральное значение 1.0):\n` +
      `  избежали Правила C благодаря характеру: ${avoided.length}, ` +
      `средняя агрессивность ${fmt(meanAgg(avoided))} — ожидается ВЫШЕ 1\n` +
      `  попали под Правило C из-за характера:  ${succumbed.length}, ` +
      `средняя агрессивность ${fmt(meanAgg(succumbed))} — ожидается НИЖЕ 1`
  );
  console.log(
    `корреляция aggressiveness ↔ итоговая доля military: ` +
      `${fmt(correlation(paired.map(t => t.aggressiveness), paired.map(t => t.militaryShare)))} ` +
      `(ожидается ПОЛОЖИТЕЛЬНАЯ: агрессивная сохраняет больше)`
  );

  const austerityCohort = paired.filter(t => t.firstAusterity !== null);
  console.log(
    `корреляция riskTolerance ↔ месяц первого урезания Правила A: ` +
      `${fmt(correlation(
        austerityCohort.map(t => t.riskTolerance),
        austerityCohort.map(t => t.firstAusterity!)
      ))} (ожидается ПОЛОЖИТЕЛЬНАЯ: рисковая тянет дольше; выборка ${austerityCohort.length}, ` +
      `база порога ${DEBT_GDP_PENALTY_THRESHOLD})`
  );

  // 3. Разброс сам по себе — справочно, НЕ доказательство (см. шапку).
  const shares = paired.map(t => t.militaryShare).sort((a, b) => a - b);
  console.log(
    `\nсправочно, итоговая доля military по миру: мин ${fmt(shares[0] ?? Number.NaN)} | ` +
      `медиана ${fmt(shares[Math.floor(shares.length / 2)] ?? Number.NaN)} | ` +
      `макс ${fmt(shares[shares.length - 1] ?? Number.NaN)} | ` +
      `различных значений ${new Set(shares.map(v => v.toFixed(6))).size}`
  );
}

main();
