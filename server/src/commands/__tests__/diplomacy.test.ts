import { describe, it, expect } from "vitest";
import * as commands from "../diplomacy";
import { createTestGameState, createTestCountry } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

function gameWithUsaSun(): GameState {
  return createTestGameState({
    countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "SUN" })],
  });
}

describe("commands/diplomacy", () => {
  describe("setRelation", () => {
    it("применяет дельту и реципрокную половину (DiplomacyService.changeRelation)", () => {
      const game = gameWithUsaSun();
      const result = commands.setRelation(game, "USA", "SUN", 20);

      expect(result).toEqual({ success: true });
      expect(game.countries[0]!.diplomacy.relations["SUN"]).toBe(20);
      expect(game.countries[1]!.diplomacy.relations["USA"]).toBe(10);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.setRelation(game, "USA", "GHOST", 20);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("setInfluence", () => {
    it("применяет дельту с клампом [0,100]", () => {
      const game = gameWithUsaSun();
      commands.setInfluence(game, "USA", "SUN", 150);
      expect(game.countries[0]!.diplomacy.influence["SUN"]).toBe(100);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.setInfluence(game, "GHOST", "SUN", 10);
      expect(result.success).toBe(false);
    });
  });

  describe("applySanction", () => {
    it("добавляет тип санкции", () => {
      const game = gameWithUsaSun();
      commands.applySanction(game, "USA", "SUN", "trade_embargo");
      expect(game.countries[0]!.diplomacy.sanctions["SUN"]).toEqual(["trade_embargo"]);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.applySanction(game, "USA", "GHOST", "trade_embargo");
      expect(result.success).toBe(false);
    });
  });

  describe("setGuarantee", () => {
    it("добавляет гарантию независимости", () => {
      const game = gameWithUsaSun();
      commands.setGuarantee(game, "USA", "SUN");
      expect(game.countries[0]!.diplomacy.guarantees).toContain("SUN");
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.setGuarantee(game, "GHOST", "SUN");
      expect(result.success).toBe(false);
    });
  });

  describe("nudgeRelationOneSided", () => {
    it("сдвигает отношение только у fromId, без реципрокного эффекта у toId", () => {
      const game = gameWithUsaSun();
      commands.nudgeRelationOneSided(game, "USA", "SUN", 5);

      expect(game.countries[0]!.diplomacy.relations["SUN"]).toBe(5);
      expect(game.countries[1]!.diplomacy.relations["USA"]).toBeUndefined();
    });

    it("клампит к [-100, 100]", () => {
      const game = gameWithUsaSun();
      const usa = game.countries[0]!;
      usa.diplomacy.relations["SUN"] = 98;

      commands.nudgeRelationOneSided(game, "USA", "SUN", 10);
      expect(usa.diplomacy.relations["SUN"]).toBe(100);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.nudgeRelationOneSided(game, "USA", "GHOST", 5);
      expect(result.success).toBe(false);
    });
  });

  describe("nudgeInfluenceTowardTarget", () => {
    it("интерполирует влияние к target с заданной скоростью", () => {
      const game = gameWithUsaSun();
      const usa = game.countries[0]!;
      usa.diplomacy.influence["SUN"] = 0;

      commands.nudgeInfluenceTowardTarget(game, "USA", "SUN", 50, 0.1);
      expect(usa.diplomacy.influence["SUN"]).toBeCloseTo(5, 5);
    });

    it("клампит к [0, 100]", () => {
      const game = gameWithUsaSun();
      const usa = game.countries[0]!;
      usa.diplomacy.influence["SUN"] = 0;

      commands.nudgeInfluenceTowardTarget(game, "USA", "SUN", -50, 5);
      expect(usa.diplomacy.influence["SUN"]).toBe(0);
    });

    it("отклоняет неизвестную страну", () => {
      const game = gameWithUsaSun();
      const result = commands.nudgeInfluenceTowardTarget(game, "GHOST", "SUN", 50, 0.1);
      expect(result.success).toBe(false);
    });
  });
});
