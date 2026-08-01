import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type Locale, DEFAULT_LOCALE } from "@shared/types/i18n/LocalizedText";
import { updateAllRegionsAndAggregate } from "@shared/utils/aggregateCountryData";
import { generateInitialMapFeatures } from "../scenarios/generateMapFeatures";
import { RegionEconomyService } from "../services/RegionEconomyService";
import { assignInitialTiers } from "../simulation/tier/TierTick";
import { nextRandom } from "@shared/utils/rng";
import { AI_TRAIT_MIN, AI_TRAIT_MAX } from "@shared/defines/ai";
import {
  STARTING_MANPOWER_POPULATION_SHARE,
  ACTIVE_PERSONNEL_SHARE,
  RESERVE_PERSONNEL_SHARE,
} from "@shared/defines/military";
import { computePlayerStanding } from "@shared/utils/nationalPower";
import { corruptionBase, legitimacyBase, stabilityBase } from "@shared/utils/politics";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";
import { activeCampaign } from "@shared/types/Campaign";

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

  // Расходы калибруются от ВНУТРЕННЕГО дохода, без exportIncome. Причина не
  // экономическая, а механическая: `exportIncome` здесь — оценка из профиля
  // (3–6% ВВП), но на ПЕРВОМ же тике `tradeTick` перезаписывает его физически
  // посчитанным числом, а `stockpile` стартует нулевым, поэтому фактическое
  // отношение падает до ~0,0001 ВВП и таким остаётся. Расходы, назначенные от
  // дохода с экспортом, оставались бы завышенными навсегда: замер до правки —
  // баланс −3,9% ВВП в месяц и 156 стран из 157 в долгах к концу первого года
  // (`.agent/audits/formula-audit-2026-07-30.md`, «Бюджетная петля»).
  // Экспорт — премия сверху, а не база бюджета.
  const domesticIncome = e.taxRevenue + e.stateEnterpriseIncome + e.otherIncome;

  e.militarySpending = domesticIncome * p.spending.military;
  e.researchSpending = domesticIncome * p.spending.research;
  e.educationSpending = domesticIncome * p.spending.education;
  e.infrastructureSpending = domesticIncome * p.spending.infrastructure;
  e.welfareSpending = domesticIncome * p.spending.welfare;
  e.otherExpenses = domesticIncome * p.spending.other;
  e.debtInterest = domesticIncome * (p.debtInterestShare ?? 0);

  // Баланс считается от ПОЛНОГО дохода: экспорт стартового месяца — реальные
  // деньги, просто не основание для обязательств.
  const income = domesticIncome + e.exportIncome;

  e.treasury = gdp * (p.treasuryShare ?? 0.05);

  const expenses =
    e.militarySpending + e.researchSpending + e.educationSpending +
    e.infrastructureSpending + e.welfareSpending + e.debtInterest + e.otherExpenses;
  e.budgetBalance = income - expenses;

  // Снимок пола дискреционных расходов (50% старта) для ИИ-аустерити (Правило A).
  // Доли расходов — источник истины для КАЖДОЙ страны, не только игрока
  // (2026-08-01). Расходы ИИ раньше были абсолютными числами, которые правила
  // умели только уменьшать: доход рос, расходы стояли, доля military падала
  // 16,00% → 6,95% за 120 месяцев, а Правило C умирало за первый год. Теперь
  // `economyTick` пересчитывает суммы из долей каждый тик — и у игрока, и у ИИ.
  //
  // Доли берутся из АВТОРСКОГО профиля, а не из посчитанных выше сумм: суммы
  // выведены от внутреннего дохода без экспорта, а доли обязаны означать ровно
  // то, что записал автор данных.
  e.spendingShares = {
    military: p.spending.military,
    research: p.spending.research,
    education: p.spending.education,
    infrastructure: p.spending.infrastructure,
    welfare: p.spending.welfare,
  };

  // Пол аустерити — половина стартовой ДОЛИ (шкала сменилась вместе с расходами:
  // фиксированная сумма перестала быть полом, как только доход стал расти).
  e.spendingFloor = {
    militarySpending: p.spending.military * 0.5,
    researchSpending: p.spending.research * 0.5,
    educationSpending: p.spending.education * 0.5,
    infrastructureSpending: p.spending.infrastructure * 0.5,
    welfareSpending: p.spending.welfare * 0.5,
  };
}

/**
 * Сеет стартовые legitimacy/corruption/stability из структурных базисов вместо
 * литералов 50/30/50 в шаблоне страны (`CreateCountry.ts`).
 *
 * ЗАЧЕМ. Базисы (`legitimacyBase` по координатам + происхождению власти,
 * `corruptionBase` по механизму удержания власти) уже влиты и уже работают —
 * но только как РАВНОВЕСИЕ, к которому `PoliticsTick` дрейфует со скоростью
 * 0,005/0,003 в месяц. Стартуя от одинаковых 50/30, мир выражает влитую
 * разметку на 6% за первый игровой год и на 26% за пять лет
 * (`.agent/audits/formula-audit-2026-07-30.md`, «Стартовые 50/30»). Легитимность
 * — главный вход каналов `repress`/`grant_autonomy`/`condemn`, то есть весь
 * первый год партии эти каналы работали на почти одинаковых числах у всех.
 *
 * Страна без разметки формы власти получает фолбэк ТЕХ ЖЕ функций, а не прежний
 * литерал: «не размечено» решается в одном месте, а не двумя разными числами.
 *
 * СТАБИЛЬНОСТЬ ДОБАВЛЕНА 2026-08-01 по той же причине и с той же ценой ошибки.
 * Авторская стабильность сценария лежит в `region.stability` (155 различных
 * значений на 157 стран), а страна стартовала литералом 50 у всех — разброс
 * РОВНО 0. Без посева `politicsTick` дотянул бы мир до сценарных значений за
 * два игровых года дрейфом 0,05/мес, то есть первый год партии игрок видел бы
 * не стартовое состояние сценария, а его литеральную замену.
 */
function seedPoliticsFromStructure(countries: Country[], regions: Region[]): void {
  for (const country of countries) {
    const p = country.politics;
    p.legitimacy = legitimacyBase(resolveIdeologyCoordinates(p), p.powerStructure);
    p.corruption = corruptionBase(p.powerStructure);
    p.stability = stabilityBase(regions.filter(r => r.ownerCountryId === country.id));
  }
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
/**
 * Сеет стартовую армию из населения страны.
 *
 * ЗАЧЕМ. Сценарий 1946 военных полей не содержит (схема их допускает, данных
 * нет), поэтому мир начинал партию с нулевыми армиями у всех 157 стран — через
 * полгода после мировой войны. Разбор и замер — у
 * `STARTING_MANPOWER_POPULATION_SHARE` в `shared/src/defines/military.ts`.
 *
 * Величина уважает данные, если они появятся: страна, у которой сценарий задал
 * `manpower` явно, не трогается. Сегодня таких нет — но разметка армий стоит в
 * очереди, и механика не должна её потом перетирать.
 */
function seedStartingArmies(countries: Country[]): void {
  for (const country of countries) {
    const military = country.military;
    if (military.manpower > 0) continue;

    military.manpower = Math.floor(country.population * STARTING_MANPOWER_POPULATION_SHARE);
    military.activePersonnel = Math.floor(military.manpower * ACTIVE_PERSONNEL_SHARE);
    military.reservePersonnel = Math.floor(military.manpower * RESERVE_PERSONNEL_SHARE);
  }
}

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

  seedPoliticsFromStructure(countries, regions);
  seedStartingArmies(countries);

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
    campaign: activeCampaign(),
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
    ideologyAnchors: structuredClone(scenario.ideologyAnchors ?? []),
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