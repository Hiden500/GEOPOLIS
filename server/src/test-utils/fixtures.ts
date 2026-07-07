import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type GameState } from "@shared/types/GameState";
import { DEFAULT_LOCALE } from "@shared/types/i18n/LocalizedText";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { ResourceType } from "@shared/types/resources/ResourcesType";

export function createTestCountry(overrides: Partial<Country> = {}): Country {
  return {
    id: "TEST",
    name: "Test Country",
    shortName: "TEST",
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
      stateEnterpriseIncome: 20_000_000_000,
      otherIncome: 10_000_000_000,
      militarySpending: 30_000_000_000,
      researchSpending: 20_000_000_000,
      educationSpending: 20_000_000_000,
      infrastructureSpending: 10_000_000_000,
      welfareSpending: 15_000_000_000,
      debtInterest: 5_000_000_000,
      otherExpenses: 5_000_000_000,
      inflation: 2.0,
      unemployment: 5.0,
      tradeBalance: -10_000_000_000,
      budgetBalance: 0,
      spendingFloor: {
        militarySpending: 15_000_000_000,
        researchSpending: 10_000_000_000,
        educationSpending: 10_000_000_000,
        infrastructureSpending: 5_000_000_000,
        welfareSpending: 7_500_000_000,
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
      governmentType: "republic",
      stability: 70,
      legitimacy: 60,
      corruption: 30,
      governmentSupport: 50,
    },
    stockpile: { oil: 500_000, coal: 1_000_000, gas: 1_500_000, iron: 500_000, copper: 500_000, gold: 250_000, tin: 0, nickel: 0, bauxite: 500000, tungsten: 0, manganese: 0, chromium: 0, uranium: 10_000, rareEarths: 50_000, lithium: 100_000, food: 5_000_000, timber: 1_000_000, cotton: 0, rubber: 0, nitrates: 0 } as Record<ResourceType, number>,
    goals: [],
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
    stability: 70,
    infrastructure: 0.6,
    development: 0.5,
    gdp: 50_000_000_000,
    resourceProduction: {
      oil: 100_000,
      coal: 200_000,
    },
    neighboringRegionIds: [],
    ...overrides,
  };
}

export function createTestGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    currentDate: "1946-01-01",
    playerCountryId: "TEST",
    countries: [],
    era: {
      id: "1946",
      name: "Test Era",
      startYear: 1946,
      endYear: 2000,
      technologyDomains: [],
    },
    regions: [],
    regionIndex: new Map<string, number[]>(),
    locale: DEFAULT_LOCALE,
    playerIntent: "",
    eventHistory: [],
    mapFeatures: [],
    wars: [],
    pendingWorldFacts: [],
    hingePointShowCount: {},
    llmRespondedThisTurn: true,
    ...overrides,
  };
}
