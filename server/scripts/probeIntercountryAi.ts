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
import {
  RIVAL_RELATION_THRESHOLD,
  INFLUENCE_SCALE_MAX,
  DOMINATION_RESENTMENT,
  SPHERE_INFLUENCE_ENTER_THRESHOLD,
  DEPENDENCY_PUPPET_STRENGTH,
  DEPENDENCY_GUARANTEE_STRENGTH,
  DEPENDENCY_SPHERE_STRENGTH,
} from "@shared/defines/diplomacy";
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
 * РАСПРЕДЕЛЕНИЕ КОНКУРЕНЦИИ ЗА КЛИЕНТОВ — вход будущего члена тяготения
 * (вариант A плана `.agent/plans/intercountry-ai.md`).
 *
 * Меряется ДО правки формулы, потому что константу веса брать неоткуда, кроме
 * как из живого распределения: назначенное «на глаз» число либо мертво (порог
 * выше края данных), либо сваливает мир в блоки на первом тике. Тот же приём,
 * которым выбирались `INFLUENCE_ECONOMIC_FULL_RATIO` и
 * `RIVAL_RELATION_THRESHOLD`.
 *
 * Присутствие державы в третьей стране — та же величина, что уже считает
 * `dependencyStrength` в тике (максимум по видам связи), а спор за клиента —
 * `min` присутствий: слабейшее присутствие ограничивает спор, потому что спорят
 * там, где ОБЕ стороны реально есть.
 */
function presenceMap(
  country: Country,
  neighbours: Map<string, Set<string>>,
  borderPresence: number
): Map<string, number> {
  const d = country.diplomacy;
  const out = new Map<string, number>();
  const put = (id: string, value: number): void => {
    out.set(id, Math.max(out.get(id) ?? 0, value));
  };
  for (const [id, value] of Object.entries(d.influence)) {
    if (value > 0) put(id, Math.min(1, value / INFLUENCE_SCALE_MAX));
  }
  for (const id of d.puppets) put(id, DEPENDENCY_PUPPET_STRENGTH);
  for (const id of d.guarantees) put(id, DEPENDENCY_GUARANTEE_STRENGTH);
  for (const id of d.sphereOfInfluence) put(id, DEPENDENCY_SPHERE_STRENGTH);
  if (borderPresence > 0) {
    for (const id of neighbours.get(country.id) ?? []) put(id, borderPresence);
  }
  return out;
}

/**
 * Соседи по суше — реплика `borderingPairs` из тика, развёрнутая в список на
 * страну. Реплика названа реплкой: тик её наружу не отдаёт, а замеру нужен тот
 * же граф. Правило то же, что там — по ЛЕГАЛЬНОМУ владению регионом.
 */
function landNeighbours(game: GameState): Map<string, Set<string>> {
  const ownerOf = new Map(game.regions.map(r => [r.id, r.ownerCountryId]));
  const out = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    const set = out.get(a) ?? new Set<string>();
    set.add(b);
    out.set(a, set);
  };
  for (const region of game.regions) {
    const owner = region.ownerCountryId;
    if (!owner) continue;
    for (const neighbourId of region.neighboringRegionIds) {
      const other = ownerOf.get(neighbourId);
      if (!other || other === owner) continue;
      link(owner, other);
      link(other, owner);
    }
  }
  return out;
}

function contestCensus(game: GameState, label: string, borderPresence = 0): void {
  const byId = new Map(game.countries.map(c => [c.id, c] as [string, Country]));
  const candidates = new Set(collectPairStandings(game, byId).keys());

  const neighbours = landNeighbours(game);
  const presence = new Map<string, Map<string, number>>();
  for (const country of game.countries) {
    const map = presenceMap(country, neighbours, borderPresence);
    if (map.size) presence.set(country.id, map);
  }

  const sources = [...presence.keys()].sort();
  const contests: Array<[string, number]> = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const aId = sources[i]!;
      const bId = sources[j]!;
      const aMap = presence.get(aId)!;
      const bMap = presence.get(bId)!;
      let sum = 0;
      for (const [targetId, aValue] of aMap) {
        if (targetId === aId || targetId === bId) continue;
        const bValue = bMap.get(targetId);
        if (bValue === undefined) continue;
        sum += Math.min(aValue, bValue);
      }
      if (sum > 0) contests.push([pairKey(aId, bId), sum]);
    }
  }

  contests.sort((x, y) => y[1] - x[1]);
  const values = contests.map(([, value]) => value).sort((a, b) => a - b);
  const fresh = contests.filter(([key]) => !candidates.has(key)).length;
  console.log(
    `\n[${label}${borderPresence > 0 ? `, соседство=${borderPresence}` : ", только связи"}] ` +
      `источников присутствия ${sources.length} | ` +
      `пар, спорящих хотя бы за одного клиента: ${contests.length} | ` +
      `из них НЕ кандидаты сегодня: ${fresh}`
  );
  if (values.length) {
    console.log(
      `  сила спора: медиана ${fmt(quantile(values, 0.5))} | 75-й проц ${fmt(quantile(values, 0.75))} | ` +
        `90-й проц ${fmt(quantile(values, 0.9))} | 99-й проц ${fmt(quantile(values, 0.99))} | ` +
        `макс ${fmt(quantile(values, 1))}`
    );
    console.log("  верх списка:");
    for (const [key, value] of contests.slice(0, 12)) {
      console.log(`    ${key.padEnd(9)} ${fmt(value).padStart(6)}${candidates.has(key) ? "" : "   (не кандидат)"}`);
    }
  }
}

/**
 * ДОХОДИТ ЛИ ОБИДА ЗА ПОДЧИНЕНИЕ ДО ПОРОГА СОПЕРНИЧЕСТВА.
 *
 * Член направленный, поэтому считается по УПОРЯДОЧЕННЫМ парам: у каждой пары
 * два разных ответа. Сравниваются три величины — сколько направленных пар вообще
 * ощущают доминирование, сколько из них уходит ниже порога соперничества и
 * сколько ушло бы без обиды. Разность последних двух и есть вся работа
 * механизма; ноль в ней означает, что член формулы написан, а поведения не
 * прибавил.
 */
function resentmentCensus(game: GameState, label: string): void {
  const byId = new Map(game.countries.map(c => [c.id, c] as [string, Country]));
  const standings = collectPairStandings(game, byId);

  let felt = 0;
  let belowWith = 0;
  let belowWithout = 0;
  const pressures: number[] = [];
  const shifted: Array<[string, number, number, number]> = [];

  for (const [key, standing] of standings) {
    const [aId, bId] = key.split("|") as [string, string];
    const a = byId.get(aId)!;
    const b = byId.get(bId)!;
    const symmetric = structuralAffinity(standing);

    for (const [subject, dominator] of [[a, b], [b, a]] as const) {
      // Реплика `subordinationTo` из тика: гарантия не считается подчинением.
      const d = dominator.diplomacy;
      const pressure = Math.max(
        d.puppets.includes(subject.id) ? DEPENDENCY_PUPPET_STRENGTH : 0,
        d.sphereOfInfluence.includes(subject.id) ? DEPENDENCY_SPHERE_STRENGTH : 0,
        Math.min(1, (d.influence[subject.id] ?? 0) / INFLUENCE_SCALE_MAX)
      );
      const directed = symmetric - DOMINATION_RESENTMENT * pressure;

      if (pressure > 0) {
        felt++;
        pressures.push(pressure);
        shifted.push([`${subject.id}→${dominator.id}`, pressure, symmetric, directed]);
      }
      if (directed < RIVAL_RELATION_THRESHOLD) belowWith++;
      if (symmetric < RIVAL_RELATION_THRESHOLD) belowWithout++;
    }
  }

  pressures.sort((x, y) => x - y);
  shifted.sort((x, y) => x[3] - y[3]);
  console.log(
    `\n[${label}] направленных пар, ощущающих доминирование: ${felt} | ` +
      `ниже порога соперничества С обидой ${belowWith}, БЕЗ обиды ${belowWithout} ` +
      `(вклад механизма: ${belowWith - belowWithout})`
  );
  if (pressures.length) {
    console.log(
      `  сила ощущения: медиана ${fmt(quantile(pressures, 0.5))} | ` +
        `макс ${fmt(quantile(pressures, 1))}`
    );
    console.log("  самые тяготящиеся (цель дрейфа после обиды):");
    for (const [pair, pressure, symmetric, directed] of shifted.slice(0, 10)) {
      console.log(
        `    ${pair.padEnd(9)} подчинённость ${fmt(pressure)} | ` +
          `тяготение ${fmt(symmetric).padStart(7)} → ${fmt(directed).padStart(7)}`
      );
    }
  }
}

/**
 * Живо ли ПРИСУТСТВИЕ как таковое — авторский слой `influence.json` против
 * безусловного затухания `INFLUENCE_DECAY_RATE`.
 *
 * Замеряется здесь, потому что от этого зависит, можно ли вообще строить
 * межстрановые правила на присутствии: вход, который сходит к нулю за партию,
 * даёт механику, работающую первые годы и мёртвую дальше.
 */
function influenceCensus(game: GameState, month: number): void {
  let links = 0;
  let sum = 0;
  let aboveSphere = 0;
  for (const country of game.countries) {
    for (const value of Object.values(country.diplomacy.influence)) {
      if (value <= 0) continue;
      links++;
      sum += value;
      if (value > 50) aboveSphere++;
    }
  }
  const spheres = game.countries.reduce((n, c) => n + c.diplomacy.sphereOfInfluence.length, 0);
  const puppets = game.countries.reduce((n, c) => n + c.diplomacy.puppets.length, 0);
  console.log(
    `           влияние: связей ${String(links).padStart(4)} | сумма ${String(Math.round(sum)).padStart(6)} | ` +
      `выше порога сферы ${String(aboveSphere).padStart(3)} | сфер ${String(spheres).padStart(3)} | вассалов ${puppets}`
  );

  // Цена ожившей балансировки: угрожаемая страна наращивает военные расходы, а
  // это деньги. Проверяется здесь же, чтобы дипломатическая правка не оплачивалась
  // экономикой молча.
  const solvent = game.countries.filter(c => c.economy.gdp > 0);
  const inDebt = solvent.filter(c => c.economy.debt > 0).length;
  const heavy = solvent.filter(c => c.economy.debt > c.economy.gdp * 0.6).length;
  const militaryShares = solvent
    .map(c => c.economy.spendingShares?.military ?? 0)
    .sort((a, b) => a - b);
  console.log(
    `           экономика: с долгом ${inDebt} из ${solvent.length} ` +
      `(${fmt((100 * inDebt) / solvent.length)}%) | свыше 60% ВВП ${heavy} | ` +
      `доля military: медиана ${fmt(quantile(militaryShares, 0.5))} | макс ${fmt(quantile(militaryShares, 1))}`
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
  contestCensus(game, "старт");
  resentmentCensus(game, "старт");
  observe(game);

  const warsSeen = new Set<string>();
  for (let month = 1; month <= HORIZON; month++) {
    simulateMonth(game);
    observe(game);
    for (const key of warPairs(game)) warsSeen.add(key);
    if (CHECKPOINTS.has(month)) {
      report(game, month);
      influenceCensus(game, month);
      ruleBCensus(game, month);
    }
  }

  reachability(game, `месяц ${HORIZON}`);
  contestCensus(game, `месяц ${HORIZON}`);
  resentmentCensus(game, `месяц ${HORIZON}`);

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
