/**
 * Замер дипломатической динамики на ЖИВОМ сценарии 1946.
 *
 * ЗАЧЕМ. Порог перехода (соперничество, союз, война) — это ветка, которая при
 * недостижимом пороге просто не берётся: код выглядит исправным, поведения нет.
 * Поэтому вопрос здесь не «работает ли функция», а «сколько раз мир реально
 * пересёк порог за партию» — и обратимо ли пересечение.
 *
 * Появился при независимой проверке ветки `claude/diplomacy-thresholds`
 * (2026-07-31) и сразу показал то, чего не видел ни один отчёт: числа
 * дипломатии, снятые ДО влития правок экономики, после них не воспроизводятся.
 * Причина — `nationalPower` считается от бюджета, а от неё зависит, кого
 * «доминирует игрок» в Правиле B, то есть кому раздаётся контр-блок. Дипломатию
 * нужно мерить на актуальной базе, а не ссылаться на прошлый замер.
 *
 * РАСШИРЕН 2026-07-31 (ветка `claude/rivalry-reversibility`). Прежний срез по
 * четырём контрольным точкам отвечал на вопрос «сколько пар СЕЙЧАС в
 * соперничестве», а обратимость требует другого: эпизод, начавшийся и
 * закончившийся между контрольными точками, в срезе невидим. Теперь состояние
 * снимается КАЖДЫЙ месяц, и вход, выход, длительность считаются по эпизодам.
 * Плюс два вывода, которых не было:
 *
 *  - структурное тяготение каждой незакрытой пары рядом с порогом примирения:
 *    именно оно, а не глубина сдвига, решает, возможен ли выход в принципе;
 *  - процентили отношений мира — тот самый достижимый диапазон, по которому
 *    калибруются пороги соперничества и (вне этой области) войны.
 *
 * Запуск:  npx tsx scripts/probeDiplomacy.ts [--diplomacy-only]
 *
 * `--diplomacy-only` гоняет один `diplomacyTick` вместо полного `simulateMonth`:
 * полный движок подмешивает контр-блок Правила B (`AiBehaviorTick`, +5/тик между
 * всеми, кого доминирует игрок), и структурная дипломатия сама по себе видна
 * только без него.
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { collectPairStandings, diplomacyTick } from "../src/simulation/diplomacy/DiplomacyTick";
import { structuralAffinity } from "../src/simulation/diplomacy/affinity";
import {
  RIVAL_RELATION_THRESHOLD,
  RIVAL_RECONCILE_THRESHOLD,
  RELATION_DRIFT_CAP,
} from "@shared/defines/diplomacy";
import { type GameState } from "@shared/types/GameState";

const HORIZON = 120;
const diplomacyOnly = process.argv.includes("--diplomacy-only");

function advance(game: GameState): void {
  if (diplomacyOnly) diplomacyTick(game);
  else simulateMonth(game);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Пара считается соперничеством, если хотя бы одна сторона записала другую:
 * `rivals` односторонний по построению (`docs/DIPLOMACY.md`), а вопрос
 * обратимости — про пару.
 */
function rivalPairs(game: GameState): Set<string> {
  const pairs = new Set<string>();
  for (const country of game.countries) {
    for (const rival of country.diplomacy.rivals ?? []) pairs.add(pairKey(country.id, rival));
  }
  return pairs;
}

function affinities(game: GameState): Map<string, number> {
  const byId = new Map(game.countries.map(c => [c.id, c]));
  const out = new Map<string, number>();
  for (const [key, standing] of collectPairStandings(game, byId)) {
    out.set(key, structuralAffinity(standing));
  }
  return out;
}

function relationValues(game: GameState): number[] {
  const values: number[] = [];
  for (const country of game.countries) {
    for (const value of Object.values(country.diplomacy.relations ?? {})) {
      if (typeof value === "number") values.push(value);
    }
  }
  return values.sort((a, b) => a - b);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

interface Episode {
  pair: string;
  start: number;
  end: number | null;
}

/** Помесячная летопись эпизодов соперничества за весь горизонт. */
function trackEpisodes(game: GameState, onMonth?: (month: number) => void): Episode[] {
  const episodes: Episode[] = [];
  const open = new Map<string, Episode>();
  let previous = new Set<string>();

  for (let month = 1; month <= HORIZON; month++) {
    advance(game);
    onMonth?.(month);

    const current = rivalPairs(game);
    for (const pair of current) {
      if (open.has(pair)) continue;
      const episode: Episode = { pair, start: month, end: null };
      open.set(pair, episode);
      episodes.push(episode);
    }
    for (const pair of previous) {
      if (current.has(pair)) continue;
      const episode = open.get(pair);
      if (!episode) continue;
      episode.end = month;
      open.delete(pair);
    }
    previous = current;
  }
  return episodes;
}

/**
 * Опыт на обратимость: пару со СТРУКТУРНО невраждебным положением загоняют в
 * соперничество и смотрят, за сколько месяцев она из него выйдет.
 *
 * Толчок задан порогом входа минус полный шаг дрейфа: меньший провал дрейф
 * отыграл бы в том же тике, и перехода бы не случилось. Так меряется цена САМОГО
 * ярлыка — отдельно от глубины события, которое пару туда столкнуло.
 */
function reversibilityExperiment(): void {
  const game = createGame("1946", "USA");
  const affinity = affinities(game);
  // Сортировка добита ключом: тяготений-дублей много, и без этого выбор
  // «типовой» пары зависел бы от порядка обхода.
  const friendly = [...affinity.entries()]
    .filter(([, value]) => value >= 0)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  if (!friendly.length) {
    console.log("\nневраждебных пар не найдено — опыт на обратимость невозможен");
    return;
  }

  const edge = friendly[0]!;
  const typical = friendly[Math.floor(friendly.length / 2)]!;
  const shock = RIVAL_RELATION_THRESHOLD - RELATION_DRIFT_CAP;
  const byId = new Map(game.countries.map(c => [c.id, c]));
  for (const [key] of [edge, typical]) {
    const [a, b] = key.split("|") as [string, string];
    byId.get(a)!.diplomacy.relations[b] = shock;
    byId.get(b)!.diplomacy.relations[a] = shock;
  }

  const episodes = trackEpisodes(game);
  console.log(`\nопыт на обратимость: толчок ${fmt(shock)} двум невраждебным парам`);
  for (const [label, entry] of [["край   ", edge], ["типовая", typical]] as const) {
    const [key, value] = entry;
    const episode = episodes.find(e => e.pair === key);
    const span = episode?.end != null ? `${episode.end - episode.start} мес` : "не вышла";
    console.log(
      `  ${label} ${key.padEnd(9)} тяготение ${fmt(value).padStart(7)} | ` +
      `вход мес ${episode ? String(episode.start).padStart(3) : "  —"} | эпизод ${span}`
    );
  }
}

function main(): void {
  const game = createGame("1946", "USA");
  const checkpoints = new Set([12, 60, HORIZON]);

  console.log(`режим: ${diplomacyOnly ? "только diplomacyTick" : "полный simulateMonth"}`);
  const report = (month: number): void => {
    const spread = relationValues(game);
    const rivals = game.countries.reduce((n, c) => n + (c.diplomacy.rivals?.length ?? 0), 0);
    const allies = game.countries.reduce((n, c) => n + (c.diplomacy.allies?.length ?? 0), 0);
    const wars = game.wars?.filter(war => war.active !== false).length ?? 0;
    console.log(
      `месяц ${String(month).padStart(3)}: ` +
      `соперничеств ${String(rivals).padStart(4)} | союзов ${String(allies).padStart(4)} | ` +
      `войн ${wars} | записей ${String(spread.length).padStart(5)} | ` +
      `диапазон ${fmt(quantile(spread, 0))}…${fmt(quantile(spread, 1))}`
    );
  };

  const episodes = trackEpisodes(game, month => {
    if (checkpoints.has(month)) report(month);
  });

  const closed = episodes.filter(e => e.end !== null);
  const durations = closed.map(e => e.end! - e.start).sort((a, b) => a - b);
  console.log(
    `\nэпизодов соперничества: ${episodes.length} | ` +
    `закрылось примирением: ${closed.length} | осталось открытыми: ${episodes.length - closed.length}`
  );
  if (durations.length) {
    console.log(
      `длительность закрытых, мес: мин ${durations[0]} | ` +
      `медиана ${quantile(durations, 0.5)} | макс ${durations[durations.length - 1]}`
    );
  }

  // Достижимый диапазон отношений — вход не только порогов соперничества, но и
  // порога войны (`shared/src/defines/ai.ts`, вне этой области). Порог, стоящий
  // ниже этих чисел, недостижим по построению.
  const values = relationValues(game);
  console.log(
    `\nотношения на ${HORIZON}-м месяце (${values.length} записей): ` +
    `мин ${fmt(quantile(values, 0))} | 1-й проц ${fmt(quantile(values, 0.01))} | ` +
    `5-й проц ${fmt(quantile(values, 0.05))} | медиана ${fmt(quantile(values, 0.5))} | ` +
    `макс ${fmt(quantile(values, 1))}`
  );

  // Обратимость: соперничество, из которого никто не выходит, — не отношение, а
  // несмываемая метка. Тяготение пары рядом с порогом примирения показывает,
  // возможен ли выход в принципе: равновесие ниже порога выхода не пересечёт его
  // ни при каком сдвиге.
  const affinity = affinities(game);
  const stuck = episodes.filter(e => e.end === null);
  const structural = stuck.filter(e => (affinity.get(e.pair) ?? 0) < RIVAL_RECONCILE_THRESHOLD);
  console.log(
    `\nиз ${stuck.length} незакрытых эпизодов у ${structural.length} ` +
    `тяготение ниже порога примирения (${RIVAL_RECONCILE_THRESHOLD}) — ` +
    `их соперничество структурно, а не наведено сдвигом`
  );
  for (const episode of stuck.sort((a, b) => (affinity.get(a.pair) ?? 0) - (affinity.get(b.pair) ?? 0))) {
    const [a, b] = episode.pair.split("|") as [string, string];
    const relation = game.countries.find(c => c.id === a)?.diplomacy.relations[b];
    console.log(
      `  ${episode.pair.padEnd(9)} тяготение ${fmt(affinity.get(episode.pair) ?? Number.NaN).padStart(7)} | ` +
      `вход мес ${String(episode.start).padStart(3)} | отношения ${fmt(relation ?? Number.NaN)}`
    );
  }

  reversibilityExperiment();
}

main();
