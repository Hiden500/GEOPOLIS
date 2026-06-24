import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type GameState } from "@shared/types/GameState";
import { buildRegionIndex } from "@shared/utils/buildRegionIndex";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";
import { generateInitialMapFeatures } from "../scenarios/generateMapFeatures";
import { RegionEconomyService } from "../services/RegionEconomyService";

export function createGame(
  scenarioId: keyof typeof ScenarioRegistry,
  playerCountryId: string
): GameState {
  const scenario = ScenarioRegistry[scenarioId];
  const regions = structuredClone(scenario.regions);
  const countries = structuredClone(scenario.countries);

  // Инициализируем региональную экономику
  const regionEconomyService = new RegionEconomyService();
  for (const region of regions) {
    regionEconomyService.initializeRegionEconomy(region);
  }

  // Инициализируем ВВП регионов и агрегируем данные к странам
  updateAllRegionsAndAggregate(countries, regions);

  // Выводим эффективную налоговую ставку (taxRevenue/gdp) на старте партии.
  // Далее EconomyTick держит taxRevenue = gdp × taxRate, чтобы доход следовал
  // за ВВП. Считаем после агрегации — gdp уже = Σ region.gdp. См. docs/DECISIONS.md.
  for (const country of countries) {
    const e = country.economy;
    e.taxRate = e.gdp > 0 ? e.taxRevenue / e.gdp : 0;

    // Снимок пола дискреционных расходов (50% старта) для ИИ-аустерити (Правило A).
    e.spendingFloor = {
      militarySpending: e.militarySpending * 0.5,
      researchSpending: e.researchSpending * 0.5,
      educationSpending: e.educationSpending * 0.5,
      infrastructureSpending: e.infrastructureSpending * 0.5,
      welfareSpending: e.welfareSpending * 0.5,
    };
  }

  // Создаём базовое состояние игры
  const game: GameState = {
    currentDate: scenario.startDate,
    playerCountryId,
    era: structuredClone(scenario.technologyEra),
    countries,
    regions,
    regionIndex: buildRegionIndex(regions),
    playerActions: [],
    eventHistory: [],
    mapFeatures: []
  };

  // Генерируем начальные Map Features
  game.mapFeatures = generateInitialMapFeatures(game);

  return game;
}