import { describe, it, expect } from "vitest";
import { computeWarScore, sumSideCasualties, warScoreLabel } from "./warScore";
import { type War } from "@shared/types/War";

/**
 * warScore (docs/plans/08_WAR_WAVE1.md, Шаг 2a) — детерминированная оценка
 * преимущества, −100..100 от лица атакующих. Компоненты: нетто-флипы
 * оккупации (WARSCORE_PER_NET_FLIP=15) + доминирование по потерям
 * (WARSCORE_CASUALTY_WEIGHT=40), итог капается.
 */
function makeWar(overrides: Partial<War> = {}): War {
  return {
    id: "war-1",
    attackers: ["USA"],
    defenders: ["USSR"],
    supporters: [],
    startDate: "1946-01-01",
    active: true,
    territoryFlips: { toAttackers: 0, toDefenders: 0 },
    casualties: {},
    ...overrides,
  };
}

describe("computeWarScore", () => {
  it("нет флипов, нет потерь → 0 (равновесие)", () => {
    expect(computeWarScore(makeWar())).toBe(0);
  });

  it("нетто-флипы атакующих дают положительный счёт (15 за флип)", () => {
    const war = makeWar({ territoryFlips: { toAttackers: 3, toDefenders: 0 } });
    expect(computeWarScore(war)).toBe(45);
  });

  it("нетто-флипы обороны дают отрицательный счёт", () => {
    const war = makeWar({ territoryFlips: { toAttackers: 1, toDefenders: 4 } });
    expect(computeWarScore(war)).toBe(-45); // (1-4)*15
  });

  it("обороняющиеся потеряли больше → преимущество атакующих (компонента потерь)", () => {
    // attacker 0, defender 100 000 → (100k-0)/100k * 40 = +40
    const war = makeWar({ casualties: { USA: 0, USSR: 100_000 } });
    expect(computeWarScore(war)).toBe(40);
  });

  it("атакующие потеряли больше → преимущество обороны", () => {
    const war = makeWar({ casualties: { USA: 100_000, USSR: 0 } });
    expect(computeWarScore(war)).toBe(-40);
  });

  it("территория и потери складываются", () => {
    const war = makeWar({
      territoryFlips: { toAttackers: 2, toDefenders: 0 }, // +30
      casualties: { USA: 0, USSR: 100_000 }, // +40
    });
    expect(computeWarScore(war)).toBe(70);
  });

  it("итог капается на 100", () => {
    const war = makeWar({
      territoryFlips: { toAttackers: 10, toDefenders: 0 }, // 150 до капа
      casualties: { USA: 0, USSR: 100_000 }, // +40
    });
    expect(computeWarScore(war)).toBe(100);
  });

  it("итог капается на −100", () => {
    const war = makeWar({
      territoryFlips: { toAttackers: 0, toDefenders: 10 }, // -150 до капа
      casualties: { USA: 100_000, USSR: 0 }, // -40
    });
    expect(computeWarScore(war)).toBe(-100);
  });

  it("равные потери не двигают счёт", () => {
    const war = makeWar({ casualties: { USA: 50_000, USSR: 50_000 } });
    expect(computeWarScore(war)).toBe(0);
  });

  it("суммирует потери коалиции по сторонам", () => {
    const war = makeWar({
      attackers: ["USA", "GBR"],
      defenders: ["USSR"],
      casualties: { USA: 30_000, GBR: 20_000, USSR: 10_000 },
    });
    expect(sumSideCasualties(war, war.attackers)).toBe(50_000);
    expect(sumSideCasualties(war, war.defenders)).toBe(10_000);
  });
});

describe("warScoreLabel", () => {
  it("шкала ярлыков по счёту", () => {
    expect(warScoreLabel(80)).toBe("attackers decisively winning");
    expect(warScoreLabel(30)).toBe("attackers winning");
    expect(warScoreLabel(0)).toBe("roughly even");
    expect(warScoreLabel(-30)).toBe("defenders winning");
    expect(warScoreLabel(-80)).toBe("defenders decisively winning");
  });
});
