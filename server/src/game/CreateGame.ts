import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Locale, DEFAULT_LOCALE } from "@shared/types/i18n/LocalizedText";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";
import { generateInitialMapFeatures } from "../scenarios/generateMapFeatures";
import { RegionEconomyService } from "../services/RegionEconomyService";
import { assignInitialTiers } from "../simulation/tier/TierTick";

/**
 * Выводит денежные поля economy из economyProfile (масштаб-свободные доли,
 * авторский источник истины) × gdp (известен только после агрегации регионов
 * в createGame). taxRate авторится напрямую в профиле — не нужно выводить
 * его из отношения, как раньше. См. docs/ECONOMY.md ("Модель единиц"),
 * docs/DECISIONS.md (2026-06-26, Q9).
 */
function deriveCountryEconomy(country: Country): void {
  const e = country.economy;
  const p = country.economyProfile;
  const gdp = e.gdp;

  e.taxRate = p.taxRate;
  e.taxRevenue = gdp * p.taxRate;
  e.exportIncome = gdp * (p.exportShare ?? 0);
  e.stateEnterpriseIncome = gdp * (p.stateEnterpriseShare ?? 0);
  e.otherIncome = gdp * (p.otherIncomeShare ?? 0);

  const income = e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;

  e.militarySpending = income * p.spending.military;
  e.researchSpending = income * p.spending.research;
  e.educationSpending = income * p.spending.education;
  e.infrastructureSpending = income * p.spending.infrastructure;
  e.welfareSpending = income * p.spending.welfare;
  e.otherExpenses = income * p.spending.other;
  e.debtInterest = income * (p.debtInterestShare ?? 0);

  e.treasury = gdp * (p.treasuryShare ?? 0.05);

  const expenses =
    e.militarySpending + e.researchSpending + e.educationSpending +
    e.infrastructureSpending + e.welfareSpending + e.debtInterest + e.otherExpenses;
  e.budgetBalance = income - expenses;

  // Снимок пола дискреционных расходов (50% старта) для ИИ-аустерити (Правило A).
  e.spendingFloor = {
    militarySpending: e.militarySpending * 0.5,
    researchSpending: e.researchSpending * 0.5,
    educationSpending: e.educationSpending * 0.5,
    infrastructureSpending: e.infrastructureSpending * 0.5,
    welfareSpending: e.welfareSpending * 0.5,
  };
}

export function createGame(
  scenarioId: keyof typeof ScenarioRegistry,
  playerCountryId: string,
  locale: Locale = DEFAULT_LOCALE,
  // Сид детерминированного RNG (docs/plans/01_PERSISTENCE_STATE.md). Дефолт
  // Date.now() — разовая инициализация новой партии, не тик симуляции, вне
  // зоны действия правила детерминизма (то запрещает Math.random/время
  // только внутри simulation/**, services/**, не при создании игры).
  seed: number = Date.now()
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

  for (const country of countries) {
    deriveCountryEconomy(country);
  }

  // Выставляем начальные тиры (исторические для 1946, иначе minor)
  assignInitialTiers(countries, scenarioId);

  // Создаём базовое состояние игры
  const game: GameState = {
    currentDate: scenario.startDate,
    playerCountryId,
    era: structuredClone(scenario.technologyEra),
    countries,
    regions,
    rngState: seed,
    nextFeatureId: 0,
    locale,
    playerIntent: "",
    eventHistory: [],
    chronicle: [],
    mapFeatures: [],
    wars: [],
    pendingWorldFacts: [],
    hingePointShowCount: {},
    llmRespondedThisTurn: false
  };

  // Генерируем начальные Map Features
  game.mapFeatures = generateInitialMapFeatures(game);

  return game;
}