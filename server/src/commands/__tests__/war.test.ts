import { describe, it, expect } from "vitest";
import * as commands from "../war";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { setRegionOccupation } from "../../simulation/war/occupation";
import { type GameState } from "@shared/types/GameState";

function gameWithUsaSun(): GameState {
  return createTestGameState({
    countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "SUN" })],
  });
}

describe("commands/war", () => {
  describe("declareWar", () => {
    it("создаёт войну между странами", () => {
      const game = gameWithUsaSun();
      const result = commands.declareWar(game, "USA", "SUN");

      expect(result).toEqual({ success: true });
      expect(game.wars).toHaveLength(1);
      expect(game.wars[0]!.attackers).toEqual(["USA"]);
      expect(game.wars[0]!.defenders).toEqual(["SUN"]);
    });

    it("сохраняет warGoal, если передан", () => {
      const game = gameWithUsaSun();
      commands.declareWar(game, "USA", "SUN", "Contain communism");
      expect(game.wars[0]!.warGoal).toBe("Contain communism");
    });

    it("идемпотентна: повторный вызов не дублирует войну", () => {
      const game = gameWithUsaSun();
      commands.declareWar(game, "USA", "SUN");
      commands.declareWar(game, "USA", "SUN");
      expect(game.wars).toHaveLength(1);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.declareWar(game, "USA", "GHOST");
      expect(result.success).toBe(false);
      expect(game.wars).toHaveLength(0);
    });
  });

  describe("makePeaceBetween", () => {
    it("завершает существующую войну миром", () => {
      const game = gameWithUsaSun();
      commands.declareWar(game, "USA", "SUN");

      const result = commands.makePeaceBetween(game, "USA", "SUN");
      expect(result).toEqual({ success: true });
      expect(game.wars[0]!.active).toBe(false);
    });

    it("отклоняет, если активной войны между странами нет", () => {
      const game = gameWithUsaSun();
      const result = commands.makePeaceBetween(game, "USA", "SUN");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("transferRegion", () => {
    it("передаёт регион новому владельцу и снимает оккупацию", () => {
      const game = gameWithUsaSun();
      const region = createTestRegion({ id: 1, ownerCountryId: "SUN" });
      game.regions.push(region);
      setRegionOccupation(game, region, "USA");
      expect(game.modifiers).toHaveLength(1);

      const result = commands.transferRegion(game, 1, "USA");

      expect(result).toEqual({ success: true });
      expect(region.ownerCountryId).toBe("USA");
      expect(region.occupiedBy).toBeUndefined();
      expect(game.modifiers).toHaveLength(0); // модификатор оккупации снят
    });

    it("отклоняет неизвестный регион", () => {
      const game = gameWithUsaSun();
      const result = commands.transferRegion(game, 999, "USA");
      expect(result.success).toBe(false);
    });

    it("отклоняет неизвестную страну-владельца", () => {
      const game = gameWithUsaSun();
      game.regions.push(createTestRegion({ id: 1, ownerCountryId: "SUN" }));
      const result = commands.transferRegion(game, 1, "GHOST");
      expect(result.success).toBe(false);
    });
  });
});
