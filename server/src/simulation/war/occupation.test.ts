import { describe, it, expect } from "vitest";
import { setRegionOccupation, revertOccupationForWar } from "./occupation";
import { createTestGameState, createTestRegion } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

function gameWithRegion(overrides: Parameters<typeof createTestRegion>[0] = {}) {
  const region = createTestRegion({ id: 1, ownerCountryId: "USA", stability: 70, ...overrides });
  const game = createTestGameState({ regions: [region] });
  return { game, region };
}

describe("setRegionOccupation", () => {
  it("выставляет occupiedBy и вешает add-модификатор -20 на stability региона", () => {
    const { game, region } = gameWithRegion();

    setRegionOccupation(game, region, "USSR");

    expect(region.occupiedBy).toBe("USSR");
    expect(region.ownerCountryId).toBe("USA");
    expect(game.modifiers).toHaveLength(1);
    expect(game.modifiers[0]).toMatchObject({
      target: { kind: "region", id: 1 },
      attribute: "stability",
      op: "add",
      value: -20,
    });
  });

  it("освобождение (newController === ownerCountryId) снимает occupiedBy и модификатор", () => {
    const { game, region } = gameWithRegion();
    setRegionOccupation(game, region, "USSR");

    setRegionOccupation(game, region, "USA");

    expect(region.occupiedBy).toBeUndefined();
    expect(game.modifiers).toHaveLength(0);
  });

  it("повторная оккупация другим контроллёром заменяет модификатор, не дублирует", () => {
    const { game, region } = gameWithRegion();
    setRegionOccupation(game, region, "USSR");

    setRegionOccupation(game, region, "GBR");

    expect(region.occupiedBy).toBe("GBR");
    expect(game.modifiers).toHaveLength(1);
    expect(game.modifiers[0]!.source).toBe("occupation:region-1");
  });

  it("не создаёт модификатор, если регион уже принадлежит newController по праву (нет-оп)", () => {
    const { game, region } = gameWithRegion();

    setRegionOccupation(game, region, "USA");

    expect(region.occupiedBy).toBeUndefined();
    expect(game.modifiers).toHaveLength(0);
  });
});

describe("revertOccupationForWar", () => {
  function gameWithTwoRegions(): GameState {
    const r1 = createTestRegion({ id: 1, ownerCountryId: "USA" });
    const r2 = createTestRegion({ id: 2, ownerCountryId: "GBR" });
    return createTestGameState({ regions: [r1, r2] });
  }

  it("снимает оккупацию региона, чей владелец и оккупант — по разные стороны этой войны", () => {
    const game = gameWithTwoRegions();
    const region = game.regions[0]!; // USA
    setRegionOccupation(game, region, "USSR");

    revertOccupationForWar(game, { attackers: ["USSR"], defenders: ["USA"] });

    expect(region.occupiedBy).toBeUndefined();
    expect(game.modifiers).toHaveLength(0);
  });

  it("не трогает оккупацию от другой (параллельной) войны", () => {
    const game = gameWithTwoRegions();
    const region = game.regions[1]!; // GBR, оккупирован France в отдельной войне
    setRegionOccupation(game, region, "FRA");

    revertOccupationForWar(game, { attackers: ["USSR"], defenders: ["USA"] });

    expect(region.occupiedBy).toBe("FRA");
    expect(game.modifiers).toHaveLength(1);
  });

  it("ничего не делает, если оккупированных регионов этой войны нет", () => {
    const game = gameWithTwoRegions();

    expect(() => revertOccupationForWar(game, { attackers: ["USSR"], defenders: ["USA"] })).not.toThrow();
  });
});
