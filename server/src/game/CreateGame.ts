import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type GameState } from "@shared/types/GameState";

export function createGame(
  scenarioId: keyof typeof ScenarioRegistry,
  playerCountryId: string
): GameState {

  const scenario =
    ScenarioRegistry[scenarioId];

  return {

    currentDate:
      scenario.startDate,

    playerCountryId,

    countries:
      structuredClone(
        scenario.countries
      ),

    regions:
      structuredClone(
        scenario.regions
      ),

    playerActions: [],
    eventHistory: []
  };
}