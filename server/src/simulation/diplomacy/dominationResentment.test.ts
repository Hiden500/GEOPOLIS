import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { diplomacyTick, collectPairStandings, subordinationTo } from "./DiplomacyTick";
import { structuralAffinity, directedAffinity, type PairStanding } from "./affinity";
import {
  DOMINATION_RESENTMENT,
  DEPENDENCY_AFFINITY,
  IDEOLOGY_AFFINITY_SPAN,
  RIVAL_RELATION_THRESHOLD,
  IDEOLOGY_INDIFFERENCE_DISTANCE,
} from "@shared/defines/diplomacy";
import { type GameState } from "@shared/types/GameState";

/**
 * ОБИДА ЗА ПОДЧИНЕНИЕ: КОРИДОР КОНСТАНТЫ И ЕЁ РАБОТА НА ЖИВОМ МИРЕ.
 *
 * Два яруса, и они проверяют разное. Инварианты считаются на самих КОНСТАНТАХ —
 * так же, как четыре инварианта идеологического модификатора: их предмет в том,
 * что число выбрано не на глаз, а зажато двумя границами, каждая со своим
 * смыслом. Живой ярус проверяет, что механизм на поставляемых данных доходит до
 * порога: константа внутри коридора и мёртвая — ровно тот случай, который эта
 * задача уже один раз поймала замером (первая версия `= DEPENDENCY_AFFINITY`
 * оставляла колонии на −0,54 при пороге −2,5 и давала НОЛЬ новых соперничеств).
 */

/** Полное подчинение при полной формальной связи — предельный случай обоих ярусов. */
function fullySubordinated(ideologyDistance: number): PairStanding {
  return {
    ideologyDistance,
    contact: 1,
    dependency: 1,
    commonEnemyPressure: 0,
    atWarWithEachOther: false,
  };
}

describe("инварианты обиды за подчинение (на константах)", () => {
  it("СНИЗУ: полностью подчинённый при идеологическом безразличии уходит в соперники", () => {
    // Без этой границы механизм есть, а поведения нет — ровно то, что показал
    // замер первой версии константы.
    const target = directedAffinity(fullySubordinated(IDEOLOGY_INDIFFERENCE_DISTANCE), 1);
    expect(target).toBeLessThan(RIVAL_RELATION_THRESHOLD);
  });

  it("СВЕРХУ: полностью подчинённый ЕДИНОМЫШЛЕННИК остаётся лоялен", () => {
    // Сателлит с тем же режимом не восстаёт оттого, что он сателлит. Без этой
    // границы обида просто заменила бы одну крайность другой.
    const target = directedAffinity(fullySubordinated(0), 1);
    expect(target).toBeGreaterThan(RIVAL_RELATION_THRESHOLD);
  });

  it("константа лежит строго внутри своего коридора", () => {
    const lower = DEPENDENCY_AFFINITY + Math.abs(RIVAL_RELATION_THRESHOLD);
    const upper = lower + IDEOLOGY_AFFINITY_SPAN / 2;
    expect(DOMINATION_RESENTMENT).toBeGreaterThan(lower);
    expect(DOMINATION_RESENTMENT).toBeLessThan(upper);
  });

  it("обида направлена: тяготит подчинённого, а не того, кто подчинил", () => {
    const standing = fullySubordinated(IDEOLOGY_INDIFFERENCE_DISTANCE);
    const subject = directedAffinity(standing, 1);
    const dominator = directedAffinity(standing, 0);
    expect(dominator).toBeGreaterThan(subject);
    expect(dominator).toBe(structuralAffinity(standing));
  });
});

describe("обида за подчинение на живом сценарии 1946", () => {
  /**
   * Живой ярус отвечает на вопрос, которого фикстура не задаёт: есть ли в
   * поставляемых данных кому обижаться. Механизм, у которого ноль входов, все
   * инварианты выше проходит.
   */
  it("подчинённость в мире 1946 различает пары, а не стоит константой", () => {
    const game = createGame("1946", "USA");
    const byId = new Map(game.countries.map(c => [c.id, c]));

    const degrees = new Set<number>();
    let felt = 0;
    for (const key of collectPairStandings(game, byId).keys()) {
      const [aId, bId] = key.split("|") as [string, string];
      for (const [subjectId, dominator] of [
        [aId, byId.get(bId)!],
        [bId, byId.get(aId)!],
      ] as const) {
        const degree = subordinationTo(dominator, subjectId);
        if (degree > 0) {
          felt++;
          degrees.add(Number(degree.toFixed(2)));
        }
      }
    }

    expect(felt).toBeGreaterThan(0);
    // Вход, принимающий одно значение, — это константа под видом формулы.
    expect(degrees.size).toBeGreaterThan(1);
  });

  it("обида создаёт соперничества, которых симметричное тяготение дать не могло", () => {
    // Утверждение выбрано так, чтобы его нельзя было выполнить БЕЗ механизма:
    // просто «соперники появились» верно и без обиды (у мира и раньше было
    // несколько пар идеологических антиподов с общей границей). Поэтому ищется
    // соперничество, чьё СИММЕТРИЧНОЕ тяготение выше порога входа, — такую пару
    // способен создать только направленный член.
    const game = createGame("1946", "USA");
    expect(game.countries.reduce((n, c) => n + c.diplomacy.rivals.length, 0)).toBe(0);

    for (let month = 0; month < 12; month++) diplomacyTick(game);

    const byId = new Map(game.countries.map(c => [c.id, c]));
    const standings = collectPairStandings(game, byId);
    const fromResentment: string[] = [];
    for (const country of game.countries) {
      for (const rivalId of country.diplomacy.rivals) {
        const key = country.id < rivalId ? `${country.id}|${rivalId}` : `${rivalId}|${country.id}`;
        const standing = standings.get(key);
        if (standing && structuralAffinity(standing) > RIVAL_RELATION_THRESHOLD) {
          fromResentment.push(key);
        }
      }
    }

    expect(fromResentment.length).toBeGreaterThan(0);
  });
});
