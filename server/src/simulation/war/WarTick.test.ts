import { describe, it, expect } from "vitest";
import { warTick } from "./WarTick";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { type War } from "@shared/types/War";

function makeWar(overrides: Partial<War> = {}): War {
  return {
    id: "war-1",
    attackers: ["USA"],
    defenders: ["USSR"],
    supporters: [],
    startDate: "1946-01-01",
    active: true,
    territoryFlips: { toAttackers: 0, toDefenders: 0 },
    ...overrides,
  };
}

describe("warTick", () => {
  it("ничего не делает без контактных границ (регионы не соседи)", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 0 });
    expect(game.regions[0]!.ownerCountryId).toBe("USA");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.mapFeatures).toHaveLength(0);
  });

  it("при равной силе на контакте — фронт стоит, но battalion размещается", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })], // activePersonnel равны (фикстура)
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 0 });
    expect(game.regions[0]!.ownerCountryId).toBe("USA");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.mapFeatures.filter(f => f.type === "battalion")).toHaveLength(2);
  });

  it("решающий перевес атакующих — регион обороны флипается к атакующим", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.regions[1]!.ownerCountryId).toBe("USA");
    expect(game.regions[0]!.ownerCountryId).toBe("USA"); // не откатился — сам не был под угрозой
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
  });

  it("решающий перевес обороны — регион атакующих флипается к обороне", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.regions[0]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 1 });
  });

  it("игнорирует неактивные войны", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar({ active: false })],
    });

    warTick(game);

    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.mapFeatures).toHaveLength(0);
  });

  it("не дублирует battalion на повторном вызове без изменения фронта", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);
    warTick(game);

    expect(game.mapFeatures.filter(f => f.type === "battalion")).toHaveLength(2);
  });
});
