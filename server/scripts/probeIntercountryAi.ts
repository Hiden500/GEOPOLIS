/**
 * Замер МЕЖСТРАНОВОЙ жизни мира на живом сценарии 1946 БЕЗ LLM (задача E7).
 *
 * ЗАЧЕМ. Механики войны и дипломатии написаны и покрыты тестами, но вопрос не
 * «работает ли функция», а «случается ли ЭТО в партии». Тик, у которого нет
 * входа, зелёные тесты проходит: фикстура доказывает, что функция считает, а не
 * что мир доводит её до вызова. Поэтому здесь считается не поведение функций, а
 * СОБЫТИЯ мира за горизонт партии — и отдельно ПРИЧИНА, по которой их нет:
 * порог недостижим арифметически / достижим, но не достигается / достигается,
 * но не у кого.
 *
 * Отличие от `probeDiplomacy.ts` (тот же мир, другой вопрос): там — обратимость
 * соперничества и калибровка порогов по распределению отношений. Здесь — охват:
 * сколько стран за партию вообще получают хоть одного соперника или союзника, и
 * сколько войн начинается без игрока и без режиссёра-LLM.
 *
 * Запуск (cwd = server/):  npx tsx scripts/probeIntercountryAi.ts [--months N] [--player XXX]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { collectPairStandings, calculateBaseInfluence } from "../src/simulation/diplomacy/DiplomacyTick";
import {
  structuralAffinity,
  allianceThreshold,
  allianceBreakThreshold,
} from "../src/simulation/diplomacy/affinity";
import { RIVAL_RELATION_THRESHOLD } from "@shared/defines/diplomacy";
import { THREAT_LEVEL } from "@shared/defines/ai";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const HORIZON = Number(argValue("--months") ?? 240);
const PLAYER = argValue("--player") ?? "USA";
const CHECKPOINTS = new Set([1, 12, 60, 120, 180, HORIZON]);

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Пары, где хотя бы одна сторона записала другую в соперники. */
function rivalPairs(game: GameState): Set<string> {
  const pairs = new Set<string>();
  for (const country of game.countries) {
    for (const rival of country.diplomacy.rivals ?? []) pairs.add(pairKey(country.id, rival));
  }
  return pairs;
}

/** Пары в союзе (запись двусторонняя по построению `addAlly`, ключ всё равно неупорядочен). */
function allyPairs(game: GameState): Set<string> {
  const pairs = new Set<string>();
  for (const country of game.countries) {
    for (const ally of country.diplomacy.allies ?? []) pairs.add(pairKey(country.id, ally));
  }
  return pairs;
}

function warPairs(game: GameState): Set<string> {
  const pairs = new Set<string>();
  for (const war of game.wars ?? []) {
    for (const attacker of war.attackers) {
      for (const defender of war.defenders) pairs.add(pairKey(attacker, defender));
    }
  }
  return pairs;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

/** Максимум отношения, которого пара достигла хоть в одном месяце горизонта. */
const peakRelation = new Map<string, number>();
/** Страны, у которых за весь горизонт хоть раз был соперник / союзник. */
const everHadRival = new Set<string>();
const everHadAlly = new Set<string>();

function observe(game: GameState): void {
  for (const country of game.countries) {
    if ((country.diplomacy.rivals ?? []).length) everHadRival.add(country.id);
    if ((country.diplomacy.allies ?? []).length) everHadAlly.add(country.id);
    for (const [targetId, value] of Object.entries(country.diplomacy.relations ?? {})) {
      if (typeof value !== "number") continue;
      const key = pairKey(country.id, targetId);
      const previous = peakRelation.get(key);
      if (previous === undefined || value > previous) peakRelation.set(key, value);
    }
  }
}

function countryLine(game: GameState, id: string): string {
  const country = game.countries.find(c => c.id === id);
  return country ? `${id}` : id;
}

function report(game: GameState, month: number): void {
  const rivals = rivalPairs(game);
  const allies = allyPairs(game);
  const wars = (game.wars ?? []).filter(w => w.active !== false).length;
  const withRival = game.countries.filter(c => (c.diplomacy.rivals ?? []).length > 0).length;
  const withAlly = game.countries.filter(c => (c.diplomacy.allies ?? []).length > 0).length;
  const withNeither = game.countries.filter(
    c => (c.diplomacy.rivals ?? []).length === 0 && (c.diplomacy.allies ?? []).length === 0
  ).length;
  console.log(
    `месяц ${String(month).padStart(3)}: ` +
      `войн ${String(wars).padStart(2)} | пар-соперников ${String(rivals.size).padStart(3)} | ` +
      `пар-союзов ${String(allies.size).padStart(3)} | стран с соперником ${String(withRival).padStart(3)} | ` +
      `с союзником ${String(withAlly).padStart(3)} | БЕЗ ТОГО И ДРУГОГО ${String(withNeither).padStart(3)}`
  );
}

/**
 * Перепись кандидатов Правила B (`AiBehaviorTick.applyThreatResponse`) — единственного
 * места, где ИИ-страны сближаются ДРУГ С ДРУГОМ (контр-блок `COALITION_STEP`).
 *
 * Условие ветки воспроизведено здесь, а не вызвано: тик ничего не возвращает.
 * Реплика узкая намеренно — те же `calculateBaseInfluence` и `THREAT_LEVEL`, что
 * у тика, и ровно два сравнения. Расхождение с тиком означало бы правку самого
 * условия, и её видно в diff рядом.
 */
function ruleBCensus(game: GameState, month: number): void {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  if (!player) return;
  const ai = game.countries.filter(c => c.id !== player.id);

  let dominated = 0;
  let balancing = 0;
  for (const c of ai) {
    const dom = calculateBaseInfluence(player, c);
    if (!(dom > THREAT_LEVEL) || player.diplomacy.allies.includes(c.id)) continue;
    dominated++;
    if ((c.diplomacy.relations[player.id] ?? 0) < 0) balancing++;
  }
  console.log(
    `           Правило B: угрожаемых ${String(dominated).padStart(3)} | ` +
      `из них балансируют (контр-блок) ${balancing} | бандвагонят ${dominated - balancing}` +
      (month === 0 ? "  ← старт" : "")
  );
}

/**
 * Разбор ПРИЧИНЫ по каждой кандидатной паре: сравнение цели дрейфа
 * (`structuralAffinity` — потолок, к которому отношения идут САМИ) с порогом
 * перехода. Цель ниже порога союза означает, что союз недостижим дрейфом ни за
 * какое время: это свойство констант и данных, а не длины партии.
 */
function reachability(game: GameState, label: string): void {
  const byId = new Map(game.countries.map(c => [c.id, c] as [string, Country]));
  const standings = collectPairStandings(game, byId);

  let allianceReachable = 0;
  let rivalReachable = 0;
  const allyGaps: number[] = [];
  const targets: number[] = [];

  for (const [, standing] of standings) {
    const target = structuralAffinity(standing);
    const formation = allianceThreshold(standing.ideologyDistance, standing.commonEnemyPressure);
    targets.push(target);
    allyGaps.push(formation - target);
    if (target > formation) allianceReachable++;
    if (target < RIVAL_RELATION_THRESHOLD) rivalReachable++;
  }

  targets.sort((a, b) => a - b);
  allyGaps.sort((a, b) => a - b);

  console.log(
    `\n[${label}] кандидатных пар ${standings.size} | ` +
      `цель дрейфа выше порога СОЮЗА у ${allianceReachable} | ` +
      `ниже порога СОПЕРНИЧЕСТВА (${RIVAL_RELATION_THRESHOLD}) у ${rivalReachable}`
  );
  console.log(
    `  цель дрейфа: мин ${fmt(quantile(targets, 0))} | медиана ${fmt(quantile(targets, 0.5))} | ` +
      `95-й проц ${fmt(quantile(targets, 0.95))} | макс ${fmt(quantile(targets, 1))}`
  );
  console.log(
    `  недобор до порога союза (порог − цель): лучший ${fmt(quantile(allyGaps, 0))} | ` +
      `медиана ${fmt(quantile(allyGaps, 0.5))}`
  );
}

function main(): void {
  const game = createGame("1946", PLAYER);
  console.log(
    `сценарий 1946, игрок ${PLAYER}, ${game.countries.length} стран, ` +
      `${game.regions.length} регионов, горизонт ${HORIZON} мес, БЕЗ LLM`
  );

  reachability(game, "старт");
  observe(game);

  const warsSeen = new Set<string>();
  for (let month = 1; month <= HORIZON; month++) {
    simulateMonth(game);
    observe(game);
    for (const key of warPairs(game)) warsSeen.add(key);
    if (CHECKPOINTS.has(month)) {
      report(game, month);
      ruleBCensus(game, month);
    }
  }

  reachability(game, `месяц ${HORIZON}`);

  const total = game.countries.length;
  const neverEither = game.countries.filter(
    c => !everHadRival.has(c.id) && !everHadAlly.has(c.id)
  );
  console.log(
    `\nЗА ВЕСЬ ГОРИЗОНТ (${HORIZON} мес):\n` +
      `  войн начиналось (пар-участников): ${warsSeen.size}\n` +
      `  стран, хоть раз имевших соперника: ${everHadRival.size} из ${total}\n` +
      `  стран, хоть раз имевших союзника:  ${everHadAlly.size} из ${total}\n` +
      `  стран БЕЗ соперника и союзника ни разу: ${neverEither.length} из ${total}`
  );

  const peaks = [...peakRelation.values()].sort((a, b) => a - b);
  console.log(
    `\nпиковые отношения по парам (${peaks.length} пар с записью): ` +
      `мин ${fmt(quantile(peaks, 0))} | медиана ${fmt(quantile(peaks, 0.5))} | ` +
      `99-й проц ${fmt(quantile(peaks, 0.99))} | макс ${fmt(quantile(peaks, 1))}`
  );

  const rivals = [...rivalPairs(game)].sort();
  console.log(`\nпары-соперники на ${HORIZON}-м месяце (${rivals.length}):`);
  for (const key of rivals) {
    const [a, b] = key.split("|") as [string, string];
    const relation = game.countries.find(c => c.id === a)?.diplomacy.relations[b];
    console.log(`  ${key.padEnd(9)} отношения ${fmt(relation ?? Number.NaN)}`);
  }

  const allies = [...allyPairs(game)].sort();
  console.log(`\nпары-союзы на ${HORIZON}-м месяце (${allies.length}):`);
  for (const key of allies) console.log(`  ${key}`);

  // Порог распада — вторая половина вопроса о союзах: союз, чей порог распада
  // выше достижимого отношения, рассыпался бы сразу после создания.
  const byId = new Map(game.countries.map(c => [c.id, c] as [string, Country]));
  const standings = collectPairStandings(game, byId);
  const breakGaps: number[] = [];
  for (const [, standing] of standings) {
    breakGaps.push(structuralAffinity(standing) - allianceBreakThreshold(standing.ideologyDistance));
  }
  breakGaps.sort((a, b) => a - b);
  console.log(
    `\nцель дрейфа минус порог РАСПАДА союза: макс ${fmt(quantile(breakGaps, 1))} | ` +
      `медиана ${fmt(quantile(breakGaps, 0.5))} (положительное — союз, однажды созданный, держится сам)`
  );

  console.log(`\nигрок: ${countryLine(game, PLAYER)}`);
}

main();
