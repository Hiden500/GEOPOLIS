import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { collectPairStandings, diplomacyTick } from "./DiplomacyTick";
import { structuralAffinity } from "./affinity";
import {
  RIVAL_RELATION_THRESHOLD,
  RIVAL_RECONCILE_THRESHOLD,
  RIVAL_ENTRY_RELATION_SHIFT,
  RELATION_DRIFT_CAP,
} from "@shared/defines/diplomacy";
import { type GameState } from "@shared/types/GameState";

/**
 * ОБРАТИМО ЛИ СОПЕРНИЧЕСТВО — И ЗА КАКОЙ СРОК.
 *
 * Соседний `thresholdReach.test.ts` проверяет, что порог перехода лежит внутри
 * диапазона своего входа. Достижимость входа — не то же самое, что достижимость
 * ВЫХОДА: замер 2026-07-31 (`scripts/probeDiplomacy.ts`, 120 месяцев на живом
 * сценарии) показал 18 вошедших пар и НИ ОДНОЙ вышедшей, то есть исправный по
 * всем прежним тестам слой производил состояние без выхода.
 *
 * ПРИЧИН ОКАЗАЛОСЬ ДВЕ, И ОНИ РАЗНОЙ ПРИРОДЫ.
 *
 *  1. Структурная и ПРАВИЛЬНАЯ. У всех 18 пар цель дрейфа (`structuralAffinity`,
 *     −11,12…−3,11) лежит ниже порога примирения: их равновесие под условием
 *     выхода. Пока структура враждебна — соседи с чужим режимом остаются
 *     соперниками, и это ровно то, что должна означать модель. Никакая
 *     калибровка сдвига этого не меняет и не должна.
 *  2. Дефект. Сам ярлык двигал собственный вход на −40 (итог −60 у обеих сторон,
 *     см. `RIVAL_ENTRY_RELATION_SHIFT`), то есть пара, попавшая в соперничество
 *     СОБЫТИЕМ при невраждебной структуре, выбиралась обратно годами вместо
 *     месяцев.
 *
 * Поэтому проверяемое свойство формулируется по причине, а не по факту выхода:
 * соперничество держится, пока держится его причина. Наведённое событием —
 * рассасывается за единицы лет; структурное — не рассасывается вовсе.
 *
 * Тест не знает ни одного идентификатора страны: пары выбираются по СВОЙСТВУ
 * (структурное тяготение), мир — из сценария, толчок — из констант порога и
 * дрейфа.
 */

/** Горизонт наблюдения — те же 10 игровых лет, что у соседних тестов. */
const HORIZON = 120;

/**
 * Толчок, которым пара загоняется в соперничество: порог входа минус ПОЛНЫЙ шаг
 * дрейфа. Меньший провал дрейф отыграл бы в том же тике, и перехода бы не
 * случилось; больший мерил бы уже глубину толчка, а не цену ярлыка.
 */
const SHOCK = RIVAL_RELATION_THRESHOLD - RELATION_DRIFT_CAP;

/**
 * «Разумный срок» назван числом здесь, один раз, и обоснован игрой, а не
 * замером: ссора, из которой невозможно выйти за срок правления одного
 * поколения, перестаёт быть отношением и становится свойством карты. Двадцать
 * четыре месяца для типовой пары — те самые «единицы лет»; шесть снизу —
 * граница, ниже которой соперничество мигает и не успевает ничего значить.
 */
const TYPICAL_MIN_MONTHS = 6;
const TYPICAL_MAX_MONTHS = 24;

/**
 * Паре на самом краю невраждебности (тяготение чуть выше нуля) отпущено втрое
 * больше: её равновесие почти касается порога выхода, и дрейф подходит к нему
 * асимптотически. Шесть лет — всё ещё срок партии, а не срок эпохи.
 */
const EDGE_MAX_MONTHS = 72;

interface Episode {
  pair: string;
  start: number;
  end: number | null;
}

interface Observation {
  /**
   * Тяготение НА КОНЕЦ прогона, а не на старт, и это не мелочь: структура пары
   * за десять лет меняется сама (влияние затухает, зависимость слабеет), и у
   * части пар цель дрейфа успевает уйти из невраждебной области во враждебную.
   * Судить о том, была ли у застрявшего соперничества структурная причина, надо
   * по той структуре, которая держит пару СЕЙЧАС.
   */
  affinity: Map<string, number>;
  episodes: Episode[];
  /** Ключи пар, которым был дан толчок: край невраждебности и типовая. */
  edge: string;
  typical: string;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function affinities(game: GameState): Map<string, number> {
  const byId = new Map(game.countries.map(c => [c.id, c]));
  const out = new Map<string, number>();
  for (const [key, standing] of collectPairStandings(game, byId)) {
    out.set(key, structuralAffinity(standing));
  }
  return out;
}

/** Пара считается соперничеством, если хотя бы одна сторона записала другую. */
function rivalPairs(game: GameState): Set<string> {
  const pairs = new Set<string>();
  for (const country of game.countries) {
    for (const rival of country.diplomacy.rivals) pairs.add(pairKey(country.id, rival));
  }
  return pairs;
}

/**
 * Один прогон мира на весь горизонт с помесячной летописью эпизодов.
 *
 * Помесячно, а не по контрольным точкам: эпизод, начавшийся и закончившийся
 * между срезами, в срезе невидим — а именно длительность эпизода здесь и
 * является предметом проверки.
 *
 * Гоняется ТОЛЬКО дипломатический тик: полный `simulateMonth` подмешивает
 * контр-блок Правила B (`AiBehaviorTick`), и измерялась бы уже не структурная
 * дипломатия. Та же причина и та же граница, что у `thresholdReach.test.ts`.
 */
function observe(): Observation {
  const game = createGame("1946", "SUN", "ru");

  // Обе подопытные пары выбираются по свойству и в одном прогоне: край
  // невраждебности (самое низкое неотрицательное тяготение) и типовая
  // (медиана невраждебных). Сортировка добита ключом — иначе выбор из пар с
  // одинаковым тяготением зависел бы от порядка обхода.
  const friendly = [...affinities(game).entries()]
    .filter(([, value]) => value >= 0)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const edge = friendly[0]![0];
  const typical = friendly[Math.floor(friendly.length / 2)]![0];

  const byId = new Map(game.countries.map(c => [c.id, c]));
  for (const key of [edge, typical]) {
    const [a, b] = key.split("|") as [string, string];
    byId.get(a)!.diplomacy.relations[b] = SHOCK;
    byId.get(b)!.diplomacy.relations[a] = SHOCK;
  }

  const episodes: Episode[] = [];
  const open = new Map<string, Episode>();
  let previous = new Set<string>();
  for (let month = 1; month <= HORIZON; month++) {
    diplomacyTick(game);

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

  return { affinity: affinities(game), episodes, edge, typical };
}

let cached: Observation | undefined;
function observation(): Observation {
  cached ??= observe();
  return cached;
}

function episodeOf(pair: string): Episode {
  const episode = observation().episodes.find(e => e.pair === pair);
  expect(episode, `пара ${pair} не вошла в соперничество после толчка`).toBeDefined();
  return episode!;
}

describe("соперничество обратимо, когда обратима его причина", () => {
  it("типовая пара, загнанная в соперничество событием, мирится за единицы лет", () => {
    const { typical, affinity } = observation();
    const episode = episodeOf(typical);

    // Предпосылка теста, а не его утверждение: структура пары невраждебна,
    // поэтому выход обязан быть возможен.
    expect(affinity.get(typical)!).toBeGreaterThan(RIVAL_RECONCILE_THRESHOLD);
    expect(episode.end, "пара не помирилась за весь горизонт").not.toBeNull();

    const months = episode.end! - episode.start;
    expect(months).toBeLessThanOrEqual(TYPICAL_MAX_MONTHS);
    // Нижняя граница — вторая половина требования: соперничество не должно
    // быть мгновенно обратимым, иначе ярлык ничего не стоит и ничего не значит.
    expect(months).toBeGreaterThanOrEqual(TYPICAL_MIN_MONTHS);
  });

  it("пара на самом краю невраждебности выбирается дольше, но выбирается", () => {
    const { edge, affinity } = observation();
    const episode = episodeOf(edge);

    expect(affinity.get(edge)!).toBeGreaterThan(RIVAL_RECONCILE_THRESHOLD);
    expect(episode.end, "пара не помирилась за весь горизонт").not.toBeNull();
    expect(episode.end! - episode.start).toBeLessThanOrEqual(EDGE_MAX_MONTHS);
  });

  it("структурно враждебная пара НЕ мирится — правка не превратила соперничество в испарение", () => {
    // Обратная сторона той же монеты. «Все помирились» — такой же сломанный
    // слой, как «никто не помирился»: соперничество обязано держаться, пока
    // держится причина.
    const { episodes, affinity } = observation();
    const hostile = episodes.filter(e => (affinity.get(e.pair) ?? 0) < RIVAL_RECONCILE_THRESHOLD);

    expect(hostile.length).toBeGreaterThan(0);
    expect(hostile.every(e => e.end === null)).toBe(true);
  });

  it("ни один эпизод не застревает БЕЗ структурной причины", () => {
    // Свойство, которого не было до правки: незакрытым к концу горизонта
    // остаётся только то соперничество, у которого равновесие пары лежит ниже
    // порога выхода. Всё остальное обязано рассосаться.
    const { episodes, affinity } = observation();
    const stuck = episodes.filter(e => e.end === null);

    expect(stuck.every(e => (affinity.get(e.pair) ?? 0) < RIVAL_RECONCILE_THRESHOLD)).toBe(true);
  });
});

describe("сдвиг соперничества соразмерен шкале, на которой стоит его порог", () => {
  /**
   * Сдвиг применяется ДВАЖДЫ: каждая сторона заводит соперника сама, а
   * `changeRelation` кладёт половину величины встречной стороне. Итог у обеих —
   * полторы величины константы, и калибровать надо именно его.
   */
  const mutualShift = Math.abs(RIVAL_ENTRY_RELATION_SHIFT) * 1.5;

  it("ярлык не уносит пару глубже, чем способна утянуть структура мира", () => {
    // Тот же класс проверки, что «порог внутри диапазона входа», только с
    // другой стороны: величина, которую перекладывают на шкалу, обязана быть
    // соразмерна тому, что эта шкала вообще способна произвести. Пол считается
    // прогоном по живому сценарию — теоретический (−20) недостижим.
    const game = createGame("1946", "SUN", "ru");
    const floor = Math.min(...affinities(game).values());

    expect(mutualShift).toBeLessThan(RIVAL_RELATION_THRESHOLD - floor);
  });

  it("но заметно шире полосы гистерезиса — соперничество не мигает", () => {
    const hysteresis = RIVAL_RECONCILE_THRESHOLD - RIVAL_RELATION_THRESHOLD;

    expect(hysteresis).toBeGreaterThan(0);
    expect(mutualShift).toBeGreaterThan(hysteresis);
  });
});
