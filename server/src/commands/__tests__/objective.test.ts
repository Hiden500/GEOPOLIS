import { describe, it, expect } from "vitest";
import { setPlayerGoals } from "../objective";
import { createTestGameState, createTestCountry } from "../../test-utils/fixtures";
import { type StrategicGoal } from "@shared/types/GrandStrategy";

describe("commands/objective — setPlayerGoals", () => {
  it("устанавливает цели игрока и сбрасывает completed в false", () => {
    const game = createTestGameState({
      playerCountryId: "PLR",
      countries: [createTestCountry({ id: "PLR" }), createTestCountry({ id: "AI" })],
    });
    const goals: StrategicGoal[] = [
      { id: "g1", kind: "reach_gdp", target: 1_000_000_000_000, completed: true }, // completed придёт true — команда сбросит
    ];

    const result = setPlayerGoals(game, goals);

    expect(result).toEqual({ success: true });
    expect(game.countries[0]!.goals).toHaveLength(1);
    expect(game.countries[0]!.goals[0]!.completed).toBe(false); // движок владеет completed
  });

  it("не трогает цели ИИ-стран", () => {
    const game = createTestGameState({
      playerCountryId: "PLR",
      countries: [createTestCountry({ id: "PLR" }), createTestCountry({ id: "AI" })],
    });

    setPlayerGoals(game, [{ id: "g1", kind: "control_regions", targetCount: 5, completed: false }]);

    expect(game.countries[1]!.goals).toEqual([]); // AI не затронут
  });

  it("заменяет весь список целей", () => {
    const player = createTestCountry({
      id: "PLR",
      goals: [{ id: "old", kind: "reach_gdp", target: 1, completed: false }],
    });
    const game = createTestGameState({ playerCountryId: "PLR", countries: [player] });

    setPlayerGoals(game, [{ id: "new", kind: "reach_power_rank", targetRank: 3, completed: false }]);

    expect(game.countries[0]!.goals).toHaveLength(1);
    expect(game.countries[0]!.goals[0]!.id).toBe("new");
  });
});
