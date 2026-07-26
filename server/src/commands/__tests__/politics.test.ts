import { describe, it, expect } from "vitest";
import { addGroupImpact } from "../politics";
import { discontentTick } from "../../simulation/politics/DiscontentTick";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
} from "../../test-utils/discontentFixtures";

/**
 * Командный слой политики — единственная дверь к памяти воздействий. Здесь
 * проверяется её санитарный контроль: неконечная дельта не должна попасть в
 * состояние.
 *
 * Почему это не мелочь: `GroupImpactMemory` — вход формулы недовольства, а
 * `clamp01(NaN) === NaN`. NaN-недовольство делает ЛОЖНЫМИ обе ветки кризисного
 * латча (`DiscontentTick.ts`: `discontent >= порог` и `discontent < порог −
 * гистерезис`), то есть регион молча перестаёт и входить в кризис, и выходить
 * из него — без исключения, без факта, без единой жалобы в логе. Тип
 * `Partial<Record<ImpactField, number>>` при этом допускает `undefined`, а
 * `память + undefined` — это NaN.
 */
describe("commands/politics — addGroupImpact отклоняет неконечную дельту", () => {
  const nonFinite: [string, unknown][] = [
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["строку", "0.5"],
  ];

  it.each(nonFinite)("отказывает на %s и не создаёт запись памяти", (_label, value) => {
    const game = createDiscontentTestGame();

    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      emboldenment: value as number,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finite/i);
    // Ни записи, ни частично применённого следа: команда отказала до записи.
    expect(game.groupImpactMemory).toHaveLength(0);
  });

  it("не портит уже существующую память частично применённой дельтой", () => {
    const game = createDiscontentTestGame();
    expect(addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { suppression: 0.3 }))
      .toEqual({ success: true });
    const before = structuredClone(game.groupImpactMemory);

    // Первое поле корректно, второе — нет: не должно примениться ни одно.
    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      suppression: 0.2,
      alienation: Number.NaN,
    });

    expect(result.success).toBe(false);
    expect(game.groupImpactMemory).toEqual(before);
  });

  it("недовольство остаётся числом, а кризисный латч продолжает работать", () => {
    const game = createDiscontentTestGame();
    addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      emboldenment: Number.NaN,
    });

    discontentTick(game);

    const region = game.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
    expect(Number.isNaN(regionDiscontent(game, region))).toBe(false);
    // Регион и без воздействия стоит выше порога — латч обязан его увидеть.
    expect(game.regionCrisisLatch).toContain(TEST_REGION_NATIONAL);
  });

  it("конечная дельта по-прежнему применяется", () => {
    const game = createDiscontentTestGame();

    expect(addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { concession: 0.25 }))
      .toEqual({ success: true });

    expect(game.groupImpactMemory).toHaveLength(1);
    expect(game.groupImpactMemory[0]!.concession).toBeCloseTo(0.25, 10);
  });
});
