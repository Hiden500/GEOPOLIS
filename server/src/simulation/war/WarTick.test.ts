import { describe, it, expect } from "vitest";
import { warTick } from "./WarTick";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { type War } from "@shared/types/War";
import { TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";

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

  it("combined-arms бонус может решить исход при равной численности (2026-07-06)", () => {
    const strongArms = {
      armor: TIER_PROGRESS_THRESHOLD * 11,
      infantry: TIER_PROGRESS_THRESHOLD * 11,
      aviation: TIER_PROGRESS_THRESHOLD * 11,
      naval: TIER_PROGRESS_THRESHOLD * 11,
    }; // тир 11 в каждом военном домене → мультипликатор 1.55 (1 + 11*0.05)

    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", technology: { domains: strongArms } }),
        createTestCountry({ id: "USSR" }), // домены пустые — мультипликатор 1
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    // При равном activePersonnel (фикстура) один combined-arms бонус (1.55x
    // vs 1x) превышает FLIP_THRESHOLD_RATIO=1.5 — регион обороны флипается.
    expect(game.regions[1]!.ownerCountryId).toBe("USA");
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
  });

  it("экипировка (War Phase 2) может решить исход при равной activePersonnel (2026-07-06)", () => {
    const equippedCountry = createTestCountry({
      id: "USA",
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 1000 },
      },
    });

    const game = createTestGameState({
      countries: [
        equippedCountry,
        createTestCountry({ id: "USSR" }), // экипировка по нулям (фикстура)
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", neighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", neighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    // 1000 танков × EQUIPMENT_STRENGTH_WEIGHT=500 = 500 000 доп. силы — при
    // равном activePersonnel (500 000 у обеих сторон, фикстура) это удваивает
    // силу США, превышая FLIP_THRESHOLD_RATIO=1.5.
    expect(game.regions[1]!.ownerCountryId).toBe("USA");
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
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
