import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type GameState } from "@shared/types/GameState";
import { buildRegionIndex } from "@shared/utils/buildRegionIndex";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";

export function createGame(
  scenarioId: keyof typeof ScenarioRegistry,
  playerCountryId: string
): GameState {
  const scenario = ScenarioRegistry[scenarioId];
  const regions = structuredClone(scenario.regions);
  const countries = structuredClone(scenario.countries);

  // Инициализируем ВВП регионов и агрегируем данные к странам
  updateAllRegionsAndAggregate(countries, regions);

  return {
    currentDate: scenario.startDate,
    playerCountryId,
    era: structuredClone(scenario.technologyEra),
    countries,
    regions,
    regionIndex: buildRegionIndex(regions),
    playerActions: [],
    eventHistory: []
  };
}