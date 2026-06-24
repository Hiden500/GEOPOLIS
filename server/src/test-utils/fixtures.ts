import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type ResearchProject } from "@shared/types/research/ResearchProject";
import { type GameState } from "@shared/types/GameState";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { ResourceType } from "@shared/types/resources/ResourcesType";

export function createTestCountry(overrides: Partial<Country> = {}): Country {
  return {
    id: "TEST",
    name: "Test Country",
    shortName: "TEST",
    color: "#FF0000",
    capitalRegionId: 1,
    population: 10_000_000,
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
      projects: [],
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
      equipment: {
        rifles: 500_000,
        trucks: 25_000,
        tanks: 2_500,
        fighters: 1_000,
        bombers: 500,
        ships: 250,
        artillery: 1_500,
        destroyers: 100,
        submarines: 75,
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
    stockpile: {
      oil: 500_000,
      coal: 1_000_000,
      iron: 500_000,
      bauxite: 250_000,
      uranium: 10_000,
      rareEarths: 50_000,
      food: 5_000_000,
      timber: 1_000_000,
      gold: 250_000,
      copper: 500_000,
      aluminum: 250_000,
      lithium: 100_000,
      gas: 1_500_000,
    } as Record<ResourceType, number>,
    goals: [],
    ...overrides,
  };
}

export function createTestRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 1,
    geoJsonId: "TEST-1",
    name: "Test Region",
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
    playerActions: [],
    eventHistory: [],
    mapFeatures: [],
    ...overrides,
  };
}

export function createTestResearchProject(overrides: Partial<ResearchProject> = {}): ResearchProject {
  return {
    id: "project-1",
    technologyId: "tech-1",
    name: "Test Project",
    domain: "Industry",
    progress: 0,
    requiredProgress: 100,
    progressPerMonth: 10,
    // Matches the default fixture's researchSpending so progress/tick stays small
    // and predictable instead of completing the project in a single tick.
    cost: 20_000_000_000,
    requiredTechnologyIds: [],
    requiredResources: {},
    startDate: "1946-01-01",
    estimatedMonths: 10,
    completed: false,
    ...overrides,
  };
}
