/**
 * Замер РОСТА ВЛИЯНИЯ игрока и наполнения его сферы на живом сценарии 1946.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `probeDiplomacy.ts`. Тот меряет отношения и пороги
 * соперничества — величины, которые двигает `DiplomacyTick`. Влияние живёт по
 * другому маршруту: цель задаёт `calculateBaseInfluence` (доминирование
 * игрока), к цели тянет Правило B `AiBehaviorTick`, а порог сферы применяет
 * `DiplomacyTick`. Вопрос здесь тоже другой: не «пересекается ли порог», а
 * «НАСЫЩАЕТСЯ ли рост» — механизм, задуманный ПРОТИВ снежка игрока, при
 * линейной шкале работает наградой за размер.
 *
 * Что печатается:
 *  1. распределение `dom = calculateBaseInfluence(player, X)` на месяце 0 —
 *     сколько стран мира игрок «доминирует» по построению формулы;
 *  2. помесячный рост сферы игрока и приращение сферы за месяц (насыщение
 *     видно как убывание приращения, линейность — как постоянное);
 *  3. сохранность АВТОРСКОЙ разметки `influence.json`: сколько стартовых
 *     связей механика переписала на первом же тике и насколько.
 *
 * Запуск:  npx tsx scripts/probeInfluence.ts [--country USA]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { calculateBaseInfluence } from "../src/simulation/diplomacy/DiplomacyTick";
import { SPHERE_INFLUENCE_ENTER_THRESHOLD } from "@shared/defines/diplomacy";
import { THREAT_LEVEL } from "@shared/defines/ai";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";

const HORIZON = 120;

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const PLAYER = argValue("--country", "USA");

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function player(game: GameState): Country {
  return game.countries.find(c => c.id === game.playerCountryId)!;
}

/** Снимок всех связей влияния мира: "SRC>DST" → значение. */
function influenceSnapshot(game: GameState): Map<string, number> {
  const out = new Map<string, number>();
  for (const country of game.countries) {
    for (const [targetId, value] of Object.entries(country.diplomacy.influence ?? {})) {
      out.set(`${country.id}>${targetId}`, value);
    }
  }
  return out;
}

function main(): void {
  const game = createGame("1946", PLAYER);
  const me = player(game);
  const others = game.countries.filter(c => c.id !== me.id);

  // --- 1. Доминирование на месяце 0 -------------------------------------
  const dom = others.map(c => calculateBaseInfluence(me, c)).sort((a, b) => a - b);
  const overThreat = dom.filter(v => v > THREAT_LEVEL).length;
  console.log(`игрок: ${me.id} | стран в мире: ${game.countries.length}`);
  console.log(
    `dom(player→X) на месяце 0: мин ${fmt(dom[0]!)} | медиана ${fmt(quantile(dom, 0.5))} | ` +
    `макс ${fmt(dom[dom.length - 1]!)} | выше THREAT_LEVEL=${THREAT_LEVEL}: ` +
    `${overThreat} из ${others.length} (${fmt((100 * overThreat) / others.length, 1)}%)`
  );

  // Медианная экономика — контроль «награды за размер»: если и она доминирует
  // над половиной мира, шкала измеряет не влияние, а порядок величины ВВП.
  const byGdp = [...game.countries].sort((a, b) => a.economy.gdp - b.economy.gdp);
  const median = byGdp[Math.floor(byGdp.length / 2)]!;
  const medDom = game.countries
    .filter(c => c.id !== median.id)
    .map(c => calculateBaseInfluence(median, c))
    .filter(v => v > THREAT_LEVEL).length;
  console.log(
    `контроль: медианная по ВВП страна (${median.id}) доминирует над ${medDom} странами`
  );

  // --- 3. Сохранность авторской разметки (замер до первого тика) --------
  const authored = influenceSnapshot(game);
  console.log(`авторских связей влияния на старте: ${authored.size}`);

  // --- 2. Помесячный рост сферы ----------------------------------------
  const checkpoints = new Set([1, 3, 6, 10, 12, 24, 36, 60, 90, HORIZON]);
  let previousSphere = me.diplomacy.sphereOfInfluence.length;
  console.log(
    `\nмесяц | сфера игрока | +за мес | среднее влияние игрока | связей >порога сферы (${SPHERE_INFLUENCE_ENTER_THRESHOLD})`
  );
  console.log(
    `${String(0).padStart(5)} | ${String(previousSphere).padStart(12)} | ` +
    `${"—".padStart(7)} | ${"—".padStart(22)} | ${"—".padStart(6)}`
  );

  let afterFirstTick: Map<string, number> | null = null;
  for (let month = 1; month <= HORIZON; month++) {
    simulateMonth(game);
    if (month === 1) afterFirstTick = influenceSnapshot(game);
    if (!checkpoints.has(month)) continue;

    const cur = player(game);
    const sphere = cur.diplomacy.sphereOfInfluence.length;
    const values = Object.values(cur.diplomacy.influence ?? {});
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const overSphere = values.filter(v => v > SPHERE_INFLUENCE_ENTER_THRESHOLD).length;
    console.log(
      `${String(month).padStart(5)} | ${String(sphere).padStart(12)} | ` +
      `${String(sphere - previousSphere).padStart(7)} | ${fmt(mean).padStart(22)} | ` +
      `${String(overSphere).padStart(6)}`
    );
    previousSphere = sphere;
  }

  const finalSphere = player(game).diplomacy.sphereOfInfluence.length;
  console.log(
    `\nИТОГ за ${HORIZON} мес: в сфере игрока ${finalSphere} стран из ${others.length} ` +
    `(${fmt((100 * finalSphere) / others.length, 1)}% мира)`
  );

  // --- 3 (продолжение). Что первый тик сделал с авторской разметкой -----
  if (afterFirstTick) {
    let changed = 0;
    let maxDelta = 0;
    let sumAbs = 0;
    for (const [key, before] of authored) {
      const after = afterFirstTick.get(key) ?? 0;
      const delta = Math.abs(after - before);
      if (delta > 1e-9) changed++;
      sumAbs += delta;
      maxDelta = Math.max(maxDelta, delta);
    }
    const added = [...afterFirstTick.keys()].filter(k => !authored.has(k)).length;
    console.log(
      `\nавторская разметка после ПЕРВОГО тика: изменено ${changed} из ${authored.size} связей | ` +
      `средний сдвиг ${fmt(sumAbs / Math.max(1, authored.size))} | макс сдвиг ${fmt(maxDelta)} | ` +
      `новых связей ${added}`
    );
  }
}

main();
