import { describe, it, expect } from "vitest";
import { objectiveTick } from "./ObjectiveTick";
import { createTestGameState, createTestCountry, createTestRegion } from "../test-utils/fixtures";
import { type StrategicGoal } from "@shared/types/GrandStrategy";

describe("objectiveTick", () => {
  it("пересчитывает позицию игрока в рейтинге силы", () => {
    const game = createTestGameState({
      playerCountryId: "MID",
      countries: [
        createTestCountry({ id: "BIG", economy: { ...createTestCountry().economy, gdp: 900_000_000_000 } }),
        createTestCountry({ id: "MID", economy: { ...createTestCountry().economy, gdp: 100_000_000_000 } }),
        createTestCountry({ id: "SML", economy: { ...createTestCountry().economy, gdp: 1_000_000_000 } }),
      ],
    });

    objectiveTick(game);

    expect(game.playerStanding.rank).toBe(2); // MID между BIG и SML
    expect(game.playerStanding.total).toBe(3);
    expect(game.playerStanding.power).toBeGreaterThan(0);
  });

  it("игрок-сильнейший получает ранг 1", () => {
    const game = createTestGameState({
      playerCountryId: "BIG",
      countries: [
        createTestCountry({ id: "BIG", economy: { ...createTestCountry().economy, gdp: 900_000_000_000 } }),
        createTestCountry({ id: "SML", economy: { ...createTestCountry().economy, gdp: 1_000_000_000 } }),
      ],
    });

    objectiveTick(game);

    expect(game.playerStanding.rank).toBe(1);
  });

  describe("оценка целей игрока", () => {
    function gameWithGoal(goal: StrategicGoal, over: Parameters<typeof createTestCountry>[0] = {}) {
      const player = createTestCountry({ id: "PLR", goals: [goal], ...over });
      return createTestGameState({ playerCountryId: "PLR", countries: [player] });
    }

    it("reach_gdp выполняется, когда ВВП достигает цели", () => {
      const goal: StrategicGoal = { id: "g1", kind: "reach_gdp", target: 400_000_000_000, completed: false };
      const game = gameWithGoal(goal); // фикстура gdp = 500B ≥ 400B

      objectiveTick(game);

      expect(game.countries[0]!.goals[0]!.completed).toBe(true);
      expect(game.pendingWorldFacts.some(f => f.text.includes("strategic goal"))).toBe(true);
    });

    it("reach_gdp не выполняется, пока ВВП ниже цели", () => {
      const goal: StrategicGoal = { id: "g1", kind: "reach_gdp", target: 900_000_000_000, completed: false };
      const game = gameWithGoal(goal); // 500B < 900B

      objectiveTick(game);

      expect(game.countries[0]!.goals[0]!.completed).toBe(false);
      expect(game.pendingWorldFacts).toHaveLength(0);
    });

    it("reach_power_rank выполняется по позиции игрока", () => {
      const goal: StrategicGoal = { id: "g1", kind: "reach_power_rank", targetRank: 1, completed: false };
      const player = createTestCountry({ id: "PLR", goals: [goal], economy: { ...createTestCountry().economy, gdp: 900_000_000_000 } });
      const weak = createTestCountry({ id: "WK", economy: { ...createTestCountry().economy, gdp: 1_000_000_000 } });
      const game = createTestGameState({ playerCountryId: "PLR", countries: [player, weak] });

      objectiveTick(game);

      expect(game.countries[0]!.goals[0]!.completed).toBe(true);
    });

    it("control_regions считает легально владеемые регионы (оккупация не в счёт)", () => {
      const goal: StrategicGoal = { id: "g1", kind: "control_regions", targetCount: 2, completed: false };
      const game = gameWithGoal(goal);
      game.regions.push(
        createTestRegion({ id: 1, ownerCountryId: "PLR" }),
        createTestRegion({ id: 2, ownerCountryId: "PLR" }),
        createTestRegion({ id: 3, ownerCountryId: "OTHER", occupiedBy: "PLR" }), // оккупирован, но не владеем
      );

      objectiveTick(game);

      expect(game.countries[0]!.goals[0]!.completed).toBe(true); // ровно 2 легальных
    });

    it("reach_tech_tier выполняется по тиру домена", () => {
      const goal: StrategicGoal = { id: "g1", kind: "reach_tech_tier", domain: "industry", targetTier: 3, completed: false };
      const game = gameWithGoal(goal, { technology: { domains: { industry: 350 } } }); // тир = floor(350/100)=3

      objectiveTick(game);

      expect(game.countries[0]!.goals[0]!.completed).toBe(true);
    });

    it("уже выполненная цель не порождает факт повторно", () => {
      const goal: StrategicGoal = { id: "g1", kind: "reach_gdp", target: 1, completed: true };
      const game = gameWithGoal(goal);

      objectiveTick(game);

      expect(game.pendingWorldFacts).toHaveLength(0);
    });
  });
});
