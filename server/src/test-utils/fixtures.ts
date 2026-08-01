import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type GameState } from "@shared/types/GameState";
import { DEFAULT_LOCALE } from "@shared/types/i18n/LocalizedText";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import { MAX_EXTRACTION_LEVEL } from "@shared/defines/resources";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";
import { activeCampaign } from "@shared/types/Campaign";

export function createTestCountry(overrides: Partial<Country> = {}): Country {
  return {
    id: "TEST",
    name: { en: "Test Country" },
    shortName: { en: "TEST" },
    color: "#FF0000",
    tier: "minor",
    capitalRegionId: 1,
    population: 10_000_000,
    // Не источник истины для тиков (они читают economy напрямую) — нужен только
    // чтобы Country оставался валиден по типу и для тестов createGame-деривации.
    economyProfile: {
      taxRate: 0.2,
      spending: {
        military: 0.3,
        research: 0.2,
        education: 0.2,
        infrastructure: 0.1,
        welfare: 0.15,
        other: 0.05,
      },
      treasuryShare: 0.2,
      exportShare: 0.1,
      stateEnterpriseShare: 0.04,
      otherIncomeShare: 0.02,
      inflation: 2.0,
      unemployment: 5.0,
      tradeBalance: -10_000_000_000,
    },
    economy: {
      gdp: 500_000_000_000,
      treasury: 100_000_000_000,
      taxRevenue: 100_000_000_000,
      taxRate: 0.2, // = taxRevenue/gdp, чтобы пересчёт в EconomyTick давал ту же сумму

      exportIncome: 50_000_000_000,
      importSpending: 0,
      stateEnterpriseIncome: 20_000_000_000,
      otherIncome: 10_000_000_000,
      militarySpending: 30_000_000_000,
      researchSpending: 20_000_000_000,
      educationSpending: 20_000_000_000,
      infrastructureSpending: 10_000_000_000,
      welfareSpending: 15_000_000_000,
      debt: 0,
      debtInterest: 5_000_000_000,
      otherExpenses: 5_000_000_000,
      inflation: 2.0,
      unemployment: 5.0,
      tradeBalance: -10_000_000_000,
      budgetBalance: 0,
      // ДОЛИ дохода, не суммы (шкала сменилась 2026-08-01 вместе с переводом
      // расходов ИИ на доли). Половина стартовых долей типового профиля.
      // Доли согласованы с суммами выше при доходе 180e9: фикстура, где доля и
      // сумма говорят разное, ловила бы ошибки, которых нет в продакшне.
      spendingFloor: {
        militarySpending: 30 / 180 / 2,
        researchSpending: 20 / 180 / 2,
        educationSpending: 20 / 180 / 2,
        infrastructureSpending: 10 / 180 / 2,
        welfareSpending: 15 / 180 / 2,
      },
      spendingShares: {
        military: 30 / 180,
        research: 20 / 180,
        education: 20 / 180,
        infrastructure: 10 / 180,
        welfare: 15 / 180,
      },
    },
    economyType: "market",
    technology: {
      domains: {},
    },
    researchedTechnologyIds: [],
    military: {
      manpower: 1_000_000,
      activePersonnel: 500_000,
      reservePersonnel: 500_000,
      militaryBudget: 30_000_000_000,
      armyStrength: 0.7,
      navyStrength: 0.6,
      airStrength: 0.5,
      nuclearWarheads: 0,
      units: [],
      // Нули по всем 8 реальным категориям EquipmentType — как и в реальных
      // данных сценария (server/data/scenarios/1946/countries.json). Раньше
      // здесь были ненулевые placeholder-значения (плюс лишний ключ "ships",
      // не входящий в EquipmentType) — безобидно, пока equipment нигде не
      // читался; War Phase 2 (2026-07-06) начал использовать его в боевой
      // формуле, где нереалистичный дефолт ломал тесты решительной победы.
      equipment: {
        rifles: 0,
        trucks: 0,
        tanks: 0,
        fighters: 0,
        bombers: 0,
        artillery: 0,
        destroyers: 0,
        submarines: 0,
      } as Record<EquipmentType, number>,
    },
    diplomacy: {
      allies: [],
      rivals: [],
      puppets: [],
      sphereOfInfluence: [],
      relations: {},
      influence: {},
      guarantees: [],
      sanctions: {},
    },
    politics: {
      ideology: "democracy",
      stability: 70,
      legitimacy: 60,
      corruption: 30,
      governmentSupport: 50,
    },
    stockpile: { oil: 500_000, coal: 1_000_000, gas: 1_500_000, iron: 500_000, copper: 500_000, gold: 250_000, tin: 0, nickel: 0, bauxite: 500000, tungsten: 0, manganese: 0, chromium: 0, uranium: 10_000, rareEarths: 50_000, lithium: 100_000, food: 5_000_000, timber: 1_000_000, cotton: 0, rubber: 0, nitrates: 0 } as Record<ResourceType, number>,
    goals: [],
    // Нейтральный темперамент по умолчанию (docs/AI_RULES.md) — тесты Правила D
    // переопределяют явно, где вариативность характера важна.
    aiTraits: { aggressiveness: 1, riskTolerance: 1 },
    ...overrides,
  };
}

export function createTestRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 1,
    geoJsonId: "TEST-1",
    names: { ru: "Test Region", en: "Test Region" },
    ownerCountryId: "TEST",
    population: 1_000_000,
    area: 100_000,
    urbanization: 0.5,
    // Шкала 0..1, как у urbanization/development рядом и как в схеме сценария
    // (`scenario1946Schemas.ts`). Прежние `70` были из конвенции
    // `country.politics.stability` (0..100) и делали фикстуру написанной ПОД БАГ
    // `region.stability / 100` в PopulationTick (исправлен 2026-07-31).
    stability: 0.7,
    infrastructure: 0.6,
    development: 0.5,
    gdp: 50_000_000_000,
    deposits: {
      oil: 100_000,
      coal: 200_000,
    },
    extraction: {
      oil: MAX_EXTRACTION_LEVEL,
      coal: MAX_EXTRACTION_LEVEL,
    },
    neighboringRegionIds: [],
    ...overrides,
  };
}

/**
 * Мир для теста. По умолчанию — МИНИМАЛЬНО ВАЛИДНЫЙ, а не пустой.
 *
 * До Милстоуна 1 (сессия жизненного цикла) умолчанием было `countries: []` при
 * `playerCountryId: "TEST"`, то есть партия за страну, которой в мире нет. Пока
 * ссылочную целостность никто не проверял, это было безобидно; с инвариантом
 * «ноль висячих ссылок» (`CONCEPT.md` §7.1) такой сейв не грузится — и
 * правильно делает. Поэтому ростер по умолчанию содержит страну игрока: тест,
 * которому она мешает, передаёт свой `countries` явно, как и раньше.
 */
export function createTestGameState(overrides: Partial<GameState> = {}): GameState {
  // Страна игрока по умолчанию — первая из переданного ростера, а не константа
  // "TEST": тест, который перечислил страны и не назвал игрока, почти всегда
  // имеет в виду первую из них, а не четвёртую несуществующую.
  const playerCountryId =
    overrides.playerCountryId ?? overrides.countries?.[0]?.id ?? "TEST";
  return {
    currentDate: "1946-01-01",
    playerCountryId,
    campaign: activeCampaign(),
    countries: [createTestCountry({ id: playerCountryId })],
    era: {
      id: "1946",
      name: "Test Era",
      startYear: 1946,
      endYear: 2000,
      technologyDomains: [],
    },
    regions: [],
    rngState: 1,
    nextFeatureId: 0,
    locale: DEFAULT_LOCALE,
    playerIntent: "",
    eventHistory: [],
    chronicle: [],
    mapFeatures: [],
    wars: [],
    modifiers: [],
    pendingWorldFacts: [],
    ethnicGroups: [],
    ideologyAnchors: [],
    groupImpactMemory: [],
    regionCrisisLatch: [],
    primitiveBatchKeys: [],
    primitiveNoopBatchKeys: [],
    primitiveTurnBudget: emptyPrimitiveTurnBudget("1946-01-01"),
    hingePointShowCount: {},
    llmRespondedThisTurn: true,
    playerStanding: { power: 0, rank: 0, total: 0 },
    ...overrides,
  };
}
