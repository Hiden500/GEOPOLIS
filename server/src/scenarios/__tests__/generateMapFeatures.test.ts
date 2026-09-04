import { describe, it, expect } from "vitest";
import { generateInitialMapFeatures } from "../generateMapFeatures";
import { createTestGameState, createTestRegion } from "../../test-utils/fixtures";

describe("generateInitialMapFeatures — порты по adjacentWaterIds", () => {
  it("создаёт порт для региона с непустым adjacentWaterIds", () => {
    const region = createTestRegion({ id: 1, adjacentWaterIds: [1500] });
    const game = createTestGameState({ regions: [region] });

    const ports = generateInitialMapFeatures(game).filter(f => f.type === "port");

    expect(ports).toHaveLength(1);
    expect(ports[0]?.regionId).toBe(1);
  });

  it("не создаёт порт для региона без выхода к воде", () => {
    const region = createTestRegion({ id: 1, adjacentWaterIds: [] });
    const game = createTestGameState({ regions: [region] });

    const ports = generateInitialMapFeatures(game).filter(f => f.type === "port");

    expect(ports).toHaveLength(0);
  });
});
