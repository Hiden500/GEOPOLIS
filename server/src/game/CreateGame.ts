import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Locale, DEFAULT_LOCALE } from "@shared/types/i18n/LocalizedText";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";
import { generateInitialMapFeatures } from "../scenarios/generateMapFeatures";
import { RegionEconomyService } from "../services/RegionEconomyService";
import { assignInitialTiers } from "../simulation/tier/TierTick";
import { nextRandom } from "@shared/utils/rng";
import { AI_TRAIT_MIN, AI_TRAIT_MAX } from "@shared/defines/ai";
import { computePlayerStanding } from "@shared/utils/nationalPower";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";

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

/**
 * Сеет Country.aiTraits (вариативность характера, docs/AI_RULES.md
 * §"Искусственный интеллект стран") через seeded RNG — один раз при
 * создании партии, не в тике (правило детерминизма конституции всё равно
 * соблюдено: game.rngState — единственный источник случайности, не
 * Math.random). Возвращает продвинутое состояние RNG для game.rngState —
 * посев не должен "тратить" сид молча, следующий реальный потребитель
 * game.rng продолжит с этого места, не с исходного seed.
 */
function seedAiTraits(countries: Country[], seed: number): number {
  let state = seed;
  const range = AI_TRAIT_MAX - AI_TRAIT_MIN;

  for (const country of countries) {
    const aggressiveness = nextRandom(state);
    state = aggressiveness.nextState;
    const riskTolerance = nextRandom(state);
    state = riskTolerance.nextState;

    country.aiTraits = {
      aggressiveness: AI_TRAIT_MIN + aggressiveness.value * range,
      riskTolerance: AI_TRAIT_MIN + riskTolerance.value * range,
    };
  }

  return state;
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

  // Домены исследований текущей эры, отсутствующие у страны (авторские данные
  // задают только реально ненулевой прогресс, см. CreateCountry.ts/план 05) —
  // ResearchTick.ts берёт список доменов из ключей technology.domains, поэтому
  // домен без явного 0 никогда не получил бы прогресса.
  for (const country of countries) {
    for (const domain of scenario.technologyEra.technologyDomains) {
      if (!(domain in country.technology.domains)) {
        country.technology.domains[domain] = 0;
      }
    }
  }

  for (const country of countries) {
    deriveCountryEconomy(country);
  }

  // Выставляем начальные тиры (исторические для 1946, иначе minor)
  assignInitialTiers(countries, scenarioId);

  // Вариативность характера ИИ — сеется один раз здесь, не молча тратит seed:
  // rngState продвигается, следующий реальный потребитель game.rng продолжит
  // с этого места (docs/AI_RULES.md §"Искусственный интеллект стран").
  const rngState = seedAiTraits(countries, seed);

  // Создаём базовое состояние игры
  const game: GameState = {
    currentDate: scenario.startDate,
    playerCountryId,
    era: structuredClone(scenario.technologyEra),
    countries,
    regions,
    rngState,
    nextFeatureId: 0,
    locale,
    playerIntent: "",
    eventHistory: [],
    chronicle: [],
    mapFeatures: [],
    wars: [],
    modifiers: [],
    pendingWorldFacts: [],
    // Фундамент недовольства (docs/CONCEPT.md §4.1): каталог групп приходит из
    // сценария (у 1836/2000 его нет — пустой, и это не ошибка), память
    // воздействий и латч кризисов стартуют пустыми — прошлого у новой партии нет.
    ethnicGroups: structuredClone(scenario.ethnicGroups ?? []),
    groupImpactMemory: [],
    regionCrisisLatch: [],
    // Журналы idempotency-ключей батчей примитивов (docs/CONCEPT.md §7.2) — у
    // новой партии батчей нет ни применённых, ни пустых. Кольца раздельные,
    // чтобы пустые не вытесняли ключи применённых (docs/PRIMITIVES.md §3).
    primitiveBatchKeys: [],
    primitiveNoopBatchKeys: [],
    // Бюджет капов примитивов на первый ход (docs/PRIMITIVES.md §4) — пустой,
    // но с датой старта: он ключуется датой, а не «первым использованием».
    primitiveTurnBudget: emptyPrimitiveTurnBudget(scenario.startDate),
    hingePointShowCount: {},
    llmRespondedThisTurn: false,
    // Стартовая позиция игрока в рейтинге силы (docs/OBJECTIVES.md) —
    // пересчитывается каждый ход в SimulationEngine, здесь задаём начальную.
    playerStanding: computePlayerStanding(countries, playerCountryId, regions),
  };

  // Генерируем начальные Map Features
  game.mapFeatures = generateInitialMapFeatures(game);

  return game;
}