import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { collectPairStandings, diplomacyTick } from "./DiplomacyTick";
import { structuralAffinity, allianceThreshold, type PairStanding } from "./affinity";
import {
  RIVAL_RELATION_THRESHOLD,
  RIVAL_RECONCILE_THRESHOLD,
  RELATION_MATERIALIZE_MIN,
  RELATION_DRIFT_CAP,
  COMMON_ENEMY_RIVAL_PRESSURE,
} from "@shared/defines/diplomacy";
import { type GameState } from "@shared/types/GameState";

/**
 * ДОСТИЖИМ ЛИ ПОРОГ ПЕРЕХОДА ТЕМ ЧИСЛОМ, КОТОРОЕ В НЕГО ВХОДИТ.
 *
 * Сравнения такого рода в проекте не было нигде, и ровно поэтому
 * `RIVAL_RELATION_THRESHOLD = −70` прожил незамеченным при полностью зелёном
 * прогоне (`.agent/audits/formula-audit-2026-07-30.md`). Каждый отдельный тест
 * был прав: формула считала то, что обещала, пороги стояли в правильном
 * порядке, инварианты модификатора выполнялись. Не проверялось единственное —
 * что вход перехода вообще способен дойти до его порога. Недостижимый порог
 * выглядит как исправный код: ветка просто никогда не берётся.
 *
 * ДИАПАЗОН СЧИТАЕТСЯ ПО ЖИВОМУ СЦЕНАРИЮ, А НЕ ПО КОНСТАНТАМ. Это не
 * придирчивость: теоретический пол тяготения (−`IDEOLOGY_AFFINITY_SPAN`/2 = −20)
 * достижим только при идеологической дистанции 1, а в поставляемых данных 1946
 * максимум дистанции 0,778, то есть фактический пол −11,12. Порог, выбранный по
 * теоретической границе (аудит предлагал −15…−18), остался бы таким же мёртвым
 * числом, как −70. Диапазон обязан приходить из данных.
 *
 * Тест не знает ни одного идентификатора страны и ни одного значения
 * константы — он утверждает ОТНОШЕНИЯ между измеренным диапазоном и порогами.
 */

function liveStandings(game: GameState): PairStanding[] {
  const byId = new Map(game.countries.map(c => [c.id, c]));
  return [...collectPairStandings(game, byId).values()];
}

/** Мир января 1946: войн нет, поэтому давление общего врага у всех нулевое. */
function peacefulAffinities(standings: PairStanding[]): number[] {
  return standings.map(structuralAffinity).sort((a, b) => a - b);
}

describe("достижимость порогов соперничества на данных 1946", () => {
  it("фактический диапазон тяготения накрывает оба порога соперничества", () => {
    const game = createGame("1946", "SUN", "ru");
    const affinities = peacefulAffinities(liveStandings(game));
    expect(affinities.length).toBeGreaterThan(0);

    const floor = affinities[0]!;
    const ceiling = affinities[affinities.length - 1]!;

    // Вход: соперничество наступает, когда отношения падают НИЖЕ порога, а
    // тянет их к себе тяготение. Пол выше порога означает, что ветка мертва.
    expect(floor).toBeLessThan(RIVAL_RELATION_THRESHOLD);

    // Выход: примирение наступает ВЫШЕ порога — значит потолок обязан его
    // перекрывать, иначе соперничество, однажды возникнув, необратимо.
    expect(ceiling).toBeGreaterThan(RIVAL_RECONCILE_THRESHOLD);

    // Гистерезис: без него пара входила бы и выходила в одном проходе тика.
    expect(RIVAL_RELATION_THRESHOLD).toBeLessThan(RIVAL_RECONCILE_THRESHOLD);
  });

  it("запас до пола больше одного шага дрейфа — порог берётся за конечное время", () => {
    // Дрейф закрывает ДОЛЮ оставшегося разрыва, поэтому к самой цели отношения
    // подходят асимптотически. Порог, прижатый к полу, формально достижим и
    // практически нет: пересечение уезжает за длину кампании. Полный шаг
    // дрейфа — дешёвый нижний барьер; настоящее доказательство пересечения —
    // прогон на 120 месяцев ниже.
    const game = createGame("1946", "SUN", "ru");
    const floor = peacefulAffinities(liveStandings(game))[0]!;

    expect(RIVAL_RELATION_THRESHOLD - floor).toBeGreaterThan(RELATION_DRIFT_CAP);
  });

  it("порог примирения не проваливается в полосу шума, где запись стирается", () => {
    // Примирение проверяется обходом `relations`, а запись оттуда удаляется,
    // когда И значение, И цель по модулю ниже порога материализации. Порог
    // выхода внутри этой полосы означал бы соперничество, которое нечем снять:
    // условие выхода проверяется по записи, которой уже нет.
    expect(Math.abs(RIVAL_RECONCILE_THRESHOLD)).toBeGreaterThan(RELATION_MATERIALIZE_MIN);
  });
});

describe("достижимость порога союза на данных 1946", () => {
  it("без общего врага союз не достаётся никому — мир не сваливается в блоки", () => {
    const game = createGame("1946", "SUN", "ru");
    const overreaching = liveStandings(game).filter(
      s => structuralAffinity(s) > allianceThreshold(s.ideologyDistance, s.commonEnemyPressure)
    );

    expect(overreaching.length).toBe(0);
  });

  it("одного общего соперника хватает, чтобы дверь в союз открылась", () => {
    // Вторая половина цепочки обрушения из аудита. Общий враг — единственный
    // вход в союз, а берётся он либо из совместной войны, либо из общего
    // соперника. Пока соперников не возникало, оба источника были пусты, и
    // недостижимость ОДНОГО порога делала недостижимым и второй.
    const game = createGame("1946", "SUN", "ru");
    const reachable = liveStandings(game).filter(s => {
      const pressure = Math.min(1, s.commonEnemyPressure + COMMON_ENEMY_RIVAL_PRESSURE);
      return (
        structuralAffinity({ ...s, commonEnemyPressure: pressure }) >
        allianceThreshold(s.ideologyDistance, pressure)
      );
    });

    expect(reachable.length).toBeGreaterThan(0);
  });
});

describe("сценарий 1946 без LLM: дипломатический слой не инертен", () => {
  /**
   * Прогон ТОЛЬКО дипломатического тика — намеренно. Полный `simulateMonth`
   * подмешивает контр-блок Правила B (`AiBehaviorTick`, +5/тик между всеми
   * странами, которых доминирует игрок), и его массовые союзы утопили бы
   * сигнал: они возникают и на недостижимых порогах тоже. Здесь проверяется
   * структурная дипломатия сама по себе — то, что до правки не производило
   * ни одного перехода за любое число тиков.
   */
  const HORIZON = 120;

  function run(): { firstRival: number; firstAlly: number; rivals: number; allies: number; records: number } {
    const game = createGame("1946", "SUN", "ru");
    const count = (pick: (c: (typeof game.countries)[number]) => string[]): number =>
      game.countries.reduce((n, c) => n + pick(c).length, 0);

    let firstRival = 0;
    let firstAlly = 0;
    for (let month = 1; month <= HORIZON; month++) {
      diplomacyTick(game);
      if (!firstRival && count(c => c.diplomacy.rivals) > 0) firstRival = month;
      if (!firstAlly && count(c => c.diplomacy.allies) > 0) firstAlly = month;
    }

    return {
      firstRival,
      firstAlly,
      rivals: count(c => c.diplomacy.rivals),
      allies: count(c => c.diplomacy.allies),
      records: count(c => Object.keys(c.diplomacy.relations)),
    };
  }

  it("за 120 месяцев возникают и соперничества, и союзы", () => {
    const result = run();

    expect(result.firstRival).toBeGreaterThan(0);
    expect(result.firstAlly).toBeGreaterThan(0);
    // Порядок причин, а не совпадение: союз без общего врага недостижим, а
    // общий враг берётся из соперничества — значит первое соперничество
    // обязано предшествовать первому союзу.
    expect(result.firstRival).toBeLessThan(result.firstAlly);
  });

  it("переходы остаются редкими — порог опущен, а не снят", () => {
    // Обратная сторона правки. «Соперники появились» выполнилось бы и у порога,
    // при котором соперниками становится весь мир, — а это тот же сломанный
    // слой, только с другой стороны.
    const result = run();

    expect(result.records).toBeGreaterThan(0);
    expect(result.rivals).toBeLessThan(result.records / 4);
    expect(result.allies).toBeLessThan(result.records / 4);
  });
});
