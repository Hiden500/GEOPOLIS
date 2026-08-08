import { describe, it, expect } from "vitest";
import { diplomacyTick } from "./DiplomacyTick";
import { createGame } from "../../game/CreateGame";
import { createTestCountry, createTestRegion, createTestGameState } from "../../test-utils/fixtures";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import {
  PRESENCE_FLOOR_COMMITMENT,
  PRESENCE_FLOOR_VASSAL,
  SPHERE_INFLUENCE_ENTER_THRESHOLD,
} from "@shared/defines/diplomacy";

/**
 * ПРИСУТСТВИЕ, ОБЕСПЕЧЕННОЕ ОБЯЗАТЕЛЬСТВОМ, НЕ ИСТАИВАЕТ.
 *
 * До 2026-08-08 затухание влияния было безусловным и с капом, то есть у малых
 * величин линейным: оно доводило связь до ровного нуля за конечное число
 * месяцев. Ни один тест этого не ловил, потому что все они проверяли ОДИН тик
 * («затухание уменьшает влияние» — верно и тогда, и сейчас), а дефект живёт на
 * горизонте партии: замер 240 месяцев показал, что мир теряет 96% присутствия и
 * 108 сфер влияния из 114.
 *
 * Поэтому тесты ниже устроены двумя ярусами. Фикстура доказывает, что пол вообще
 * считается и держит; ЖИВОЙ мир доказывает, что на поставляемых данных ему есть
 * что держать, — а это разные утверждения (`AGENTS.md`: константа у всех стран и
 * недостижимый порог зелёным тестам не видны).
 *
 * Ни один тест не знает величины пола числом — все сравнивают с константой,
 * потому что предмет проверки здесь свойство, а не калибровка.
 */

function worldOf(countries: Country[]): GameState {
  const regions = countries.map((c, i) =>
    createTestRegion({ id: i + 1, geoJsonId: `R${i + 1}`, ownerCountryId: c.id })
  );
  return createTestGameState({ countries, regions, playerCountryId: countries[0]!.id });
}

function withDiplomacy(id: string, overrides: Partial<Country["diplomacy"]>): Country {
  const base = createTestCountry();
  return createTestCountry({ id, diplomacy: { ...base.diplomacy, ...overrides } });
}

function runTicks(game: GameState, count: number): void {
  for (let i = 0; i < count; i++) diplomacyTick(game);
}

/** Заведомо больше, чем нужно затуханию, чтобы дойти до дна: 25 лет. */
const LONG_HORIZON = 300;

describe("пол присутствия: обязательство держит связь", () => {
  it("гарантия не даёт присутствию истаять", () => {
    const patron = withDiplomacy("A", { guarantees: ["B"], influence: { B: 40 } });
    const client = withDiplomacy("B", {});

    runTicks(worldOf([patron, client]), LONG_HORIZON);

    expect(patron.diplomacy.influence["B"]).toBeGreaterThanOrEqual(PRESENCE_FLOOR_COMMITMENT);
  });

  it("союз держит присутствие так же, как гарантия", () => {
    // Отношения заданы выше порога распада намеренно: союз при нулевых
    // отношениях тик снимает первым же проходом (`allianceBreakThreshold`), и
    // тогда тест мерил бы не пол, а распад союза.
    const a = withDiplomacy("A", { allies: ["B"], influence: { B: 40 }, relations: { B: 80 } });
    const b = withDiplomacy("B", { allies: ["A"], relations: { A: 80 } });

    const game = worldOf([a, b]);
    runTicks(game, LONG_HORIZON);

    expect(a.diplomacy.allies).toContain("B");
    expect(a.diplomacy.influence["B"]).toBeGreaterThanOrEqual(PRESENCE_FLOOR_COMMITMENT);
  });

  it("вассалитет держит присутствие выше, чем прочие обязательства", () => {
    const suzerain = withDiplomacy("A", { puppets: ["B"], influence: { B: 90 } });
    const vassal = withDiplomacy("B", {});

    runTicks(worldOf([suzerain, vassal]), LONG_HORIZON);

    expect(suzerain.diplomacy.influence["B"]).toBeGreaterThanOrEqual(PRESENCE_FLOOR_VASSAL);
    expect(PRESENCE_FLOOR_VASSAL).toBeGreaterThan(PRESENCE_FLOOR_COMMITMENT);
  });

  it("связь БЕЗ обязательства по-прежнему уходит вниз — присутствие не даётся даром", () => {
    const source = withDiplomacy("A", { influence: { B: 90 } });
    const target = withDiplomacy("B", {});

    runTicks(worldOf([source, target]), LONG_HORIZON);

    expect(source.diplomacy.influence["B"]).toBeLessThan(PRESENCE_FLOOR_COMMITMENT);
  });

  it("сфера влияния полом НЕ является: выведенный движком ярлык не держит собственный вход", () => {
    const source = withDiplomacy("A", {
      sphereOfInfluence: ["B"],
      influence: { B: SPHERE_INFLUENCE_ENTER_THRESHOLD + 10 },
    });
    const target = withDiplomacy("B", {});

    runTicks(worldOf([source, target]), LONG_HORIZON);

    expect(source.diplomacy.influence["B"]).toBeLessThan(PRESENCE_FLOOR_COMMITMENT);
  });

  it("пол только удерживает и не поднимает: присутствие ниже пола не растёт", () => {
    const start = PRESENCE_FLOOR_VASSAL / 2;
    const suzerain = withDiplomacy("A", { puppets: ["B"], influence: { B: start } });
    const vassal = withDiplomacy("B", {});

    runTicks(worldOf([suzerain, vassal]), LONG_HORIZON);

    expect(suzerain.diplomacy.influence["B"]).toBeLessThanOrEqual(start);
  });
});

describe("пол присутствия на живом сценарии 1946", () => {
  /**
   * Фикстура выше доказывает, что пол СЧИТАЕТСЯ. Здесь проверяется, что ему
   * есть что держать на поставляемых данных: вассальные связи января 1946
   * должны пережить партию, а не раствориться, как это было до правки (замер:
   * связей выше порога сферы 107 → 6 за 240 месяцев).
   */
  it("вассальные связи, начавшиеся не ниже своего пола, живы через 25 лет", () => {
    const game = createGame("1946", "USA");

    const startedHigh: Array<[string, string]> = [];
    for (const country of game.countries) {
      for (const puppetId of country.diplomacy.puppets) {
        if ((country.diplomacy.influence[puppetId] ?? 0) >= PRESENCE_FLOOR_VASSAL) {
          startedHigh.push([country.id, puppetId]);
        }
      }
    }
    // Предпосылка самого теста: если таких связей в данных нет, он ничего не
    // проверяет и обязан об этом сказать, а не молча пройти.
    expect(startedHigh.length).toBeGreaterThan(0);

    runTicks(game, LONG_HORIZON);

    const byId = new Map(game.countries.map(c => [c.id, c]));
    const survived = startedHigh.filter(
      ([sourceId, targetId]) =>
        (byId.get(sourceId)!.diplomacy.influence[targetId] ?? 0) >= PRESENCE_FLOOR_VASSAL
    );
    expect(survived.length).toBe(startedHigh.length);
  });

  it("сферы влияния мира не обваливаются к концу партии", () => {
    const game = createGame("1946", "USA");
    const before = game.countries.reduce((n, c) => n + c.diplomacy.sphereOfInfluence.length, 0);
    expect(before).toBeGreaterThan(0);

    runTicks(game, LONG_HORIZON);

    const after = game.countries.reduce((n, c) => n + c.diplomacy.sphereOfInfluence.length, 0);
    // Половина — не калибровка, а граница между «слой поредел» и «слоя не
    // стало»: до правки от 114 сфер оставалось 6, то есть 5%.
    expect(after).toBeGreaterThan(before / 2);
  });
});
