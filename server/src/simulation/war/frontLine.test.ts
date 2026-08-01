import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { applyPrimitiveBatch } from "../../primitives/PrimitiveEngine";
import { type Primitive } from "../../primitives/types";
import { effectiveController } from "@shared/utils/regionControl";
import { type GameState } from "@shared/types/GameState";
import { warTick } from "./WarTick";
import { createTestCountry, createTestGameState, createTestRegion } from "../../test-utils/fixtures";

/**
 * ФРОНТ ДВИЖЕТСЯ, А НЕ ОБВАЛИВАЕТСЯ.
 *
 * До 2026-07-31 условие флипа сравнивало ГЛОБАЛЬНУЮ силу стороны с глобальной
 * силой противника — выражение, в котором сам регион не участвовал. Решение
 * получалось одинаковым для всех контактных регионов сразу: фронт не двигался,
 * он падал целиком за один тик. Вдобавок сценарий не размечает армии вовсе, и
 * первые месяцы обе стороны сравнивали нули, где исход решала случайная
 * разница в тысячу человек.
 *
 * Проверяются СВОЙСТВА на живых данных: у сопоставимых соседей фронт остаётся
 * живым и двигается в обе стороны, а армии на старте не нулевые. Числа
 * конкретных стран не фиксируются — они изменятся с наполнением сценария.
 */

/** Начинает войну примитивом и возвращает игру. */
function warBetween(attacker: string, defender: string): GameState {
  const game = createGame("1946", "USA");
  applyPrimitiveBatch(game, [
    { verb: "war", sourceCountryId: attacker, target: { countryId: defender } },
  ] as Primitive[]);
  return game;
}

function controlledBy(game: GameState, id: string): number {
  return game.regions.filter(r => effectiveController(r) === id).length;
}

describe("стартовые армии засеяны", () => {
  /**
   * Сценарий 1946 военных полей не содержит: схема их допускает, данных нет.
   * Без сева весь мир начинал январь 1946 — через полгода после мировой войны —
   * с армией ровно ноль, и любая война была сравнением нулей.
   */
  it("ни одна страна с населением не начинает партию с нулевой армией", () => {
    const game = createGame("1946", "USA");
    const populated = game.countries.filter(c => c.population > 0);

    expect(populated.length).toBeGreaterThan(100);
    expect(populated.every(c => c.military.activePersonnel > 0)).toBe(true);
    expect(populated.every(c => c.military.manpower > c.military.activePersonnel)).toBe(true);
  });

  it("размер армии следует за населением, а не одинаков у всех", () => {
    const game = createGame("1946", "USA");
    const armies = game.countries.filter(c => c.population > 0).map(c => c.military.activePersonnel);

    // Вход не выродился в константу — тот же класс проверки, что
    // liveInputGuards.test.ts: разных значений должно быть много.
    expect(new Set(armies).size).toBeGreaterThan(50);
  });
});

describe("живой сценарий: война сопоставимых соседей не решается за один тик", () => {
  /**
   * ROU против YUG — соседи, равные по населению почти точно (15,80 против
   * 15,80 млн). До правки Румыния теряла ВСЕ шесть своих регионов за шесть
   * месяцев, и решала это разница в тысячу манпауэра на первом месяце.
   *
   * Порог «не более половины» намеренно грубый: тест ловит ОБВАЛ, а не
   * фиксирует исход. Кто победит при следующей калибровке — не его дело.
   */
  it("сторона не теряет весь свой фронт за первый месяц", () => {
    const game = warBetween("ROU", "YUG");
    const before = controlledBy(game, "ROU");

    simulateMonth(game);

    expect(controlledBy(game, "ROU")).toBeGreaterThan(before / 2);
  }, 60_000);

  it("за пять лет фронт двигается в ОБЕ стороны, а не в одну", () => {
    const game = warBetween("ROU", "YUG");
    for (let month = 0; month < 60; month++) simulateMonth(game);

    const war = game.wars.find(w => w.active)!;
    expect(war.territoryFlips.toAttackers).toBeGreaterThan(0);
    expect(war.territoryFlips.toDefenders).toBeGreaterThan(0);
  }, 120_000);
});

describe("живой сценарий: перевес решает, но не мгновенно", () => {
  /**
   * ITA против FRA — Франция вдвое сильнее, и разгром Италии правильный исход.
   * Проверяется не он, а СКОРОСТЬ: наступление идёт волной по контактным
   * участкам, а не забирает весь фронт одним тиком. До правки условие флипа
   * было общим для всей стороны, и «постепенно» означало лишь то, что новые
   * регионы становились контактными.
   */
  it("сильнейший не забирает весь фронт слабейшего за один месяц", () => {
    const game = warBetween("ITA", "FRA");
    const before = controlledBy(game, "ITA");

    simulateMonth(game);

    const after = controlledBy(game, "ITA");
    expect(after).toBeLessThan(before);          // наступление идёт
    expect(after).toBeGreaterThan(before / 2);   // но не обвал
  }, 60_000);
});

describe("исход решает ЛОКАЛЬНАЯ обстановка участка", () => {
  /**
   * Прямая проверка того, ради чего модель менялась: при одной и той же
   * расстановке сил разные участки одного фронта обязаны решаться по-разному.
   * До 2026-07-31 сравнивались глобальные силы сторон — выражение, одинаковое
   * для всех регионов, поэтому фронт мог только упасть целиком.
   *
   * Здесь у обороны два региона: один зажат тремя вражескими, другой граничит с
   * одним. Силы сторон равны, различается только геометрия — и этого должно
   * хватить, чтобы судьба участков разошлась.
   */
  it("зажатый с трёх сторон участок падает, а участок с одним контактом держится", () => {
    const game = createTestGameState({
      countries: [
        // Перевес атакующего вдвое. Он выбран не на глаз: у обороны фронт вдвое
        // у́же, поэтому она концентрирует ту же армию на меньшем числе точек, и
        // разница участков различима только в коридоре перевеса 1,3…3,9. Ниже —
        // держатся оба, выше — падают оба; тест меряет РАЗНИЦУ, а не силу.
        createTestCountry({
          id: "ATK",
          military: { ...createTestCountry().military, activePersonnel: 200_000 },
        }),
        createTestCountry({
          id: "DEF",
          military: { ...createTestCountry().military, activePersonnel: 100_000 },
        }),
      ],
      regions: [
        // Оборона: 1 — окружён тремя, 2 — граничит с одним.
        createTestRegion({ id: 1, ownerCountryId: "DEF", neighboringRegionIds: [10, 11, 12] }),
        createTestRegion({ id: 2, ownerCountryId: "DEF", neighboringRegionIds: [13] }),
        createTestRegion({ id: 10, ownerCountryId: "ATK", neighboringRegionIds: [1] }),
        createTestRegion({ id: 11, ownerCountryId: "ATK", neighboringRegionIds: [1] }),
        createTestRegion({ id: 12, ownerCountryId: "ATK", neighboringRegionIds: [1] }),
        createTestRegion({ id: 13, ownerCountryId: "ATK", neighboringRegionIds: [2] }),
      ],
      wars: [{
        id: "w1", attackers: ["ATK"], defenders: ["DEF"], supporters: [],
        startDate: "1946-01-01", active: true,
        territoryFlips: { toAttackers: 0, toDefenders: 0 }, casualties: {},
      }],
    });

    warTick(game);

    const squeezed = game.regions.find(r => r.id === 1)!;
    const calm = game.regions.find(r => r.id === 2)!;

    expect(squeezed.occupiedBy, "зажатый участок обязан пасть").toBe("ATK");
    expect(calm.occupiedBy, "участок с одним контактом обязан удержаться").toBeUndefined();
  });
});

describe("живой сценарий: война идёт годами, а не решается за месяц", () => {
  /**
   * СВОЙСТВО ВЫБРАНО ПО ЗАМЕРУ, а не по ожиданию. Первая редакция требовала,
   * чтобы сопоставимый сосед СОХРАНИЛ часть территории за пять лет, — и это
   * оказалось неверным требованием: Румыния в итоге проигрывает Югославии, и
   * поражение слабейшего нормальный исход войны. Ненормальным было другое —
   * что оно наступало за шесть месяцев и решалось разницей в тысячу человек на
   * первом тике.
   *
   * Поэтому проверяется ДЛИТЕЛЬНОСТЬ и подвижность: за пять лет фронт должен
   * пережить десятки переходов в обе стороны. Замер после правки — 152 флипа к
   * атакующим и 158 к обороне; до неё было 6 в одну сторону и тишина.
   */
  it("фронт переходит из рук в руки десятки раз за пять лет", () => {
    const game = warBetween("ROU", "YUG");
    for (let month = 0; month < 60; month++) simulateMonth(game);

    const war = game.wars.find(w => w.attackers.includes("ROU"))!;
    expect(war.territoryFlips.toAttackers).toBeGreaterThan(20);
    expect(war.territoryFlips.toDefenders).toBeGreaterThan(20);
  }, 120_000);
});
