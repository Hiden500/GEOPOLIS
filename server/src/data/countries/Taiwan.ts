import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Республика Китай (Националисты) — 1946, Тайвань
export const Taiwan = createCountry({
  id: "Taiwan",
  name: "Republic of China",
  shortName: "ROC",
  color: "#0ea5e9",
  capitalRegionId: 42,
  population: 6_000_000,
  economyType: EconomyType.Mixed,
  economy: {
    gdp: 8000,
    treasury: 1500,
    taxRevenue: 300,
    exportIncome: 50,
    stateEnterpriseIncome: 30,
    otherIncome: 20,
    militarySpending: 150,
    researchSpending: 20,
    educationSpending: 40,
    infrastructureSpending: 30,
    welfareSpending: 50,
    debtInterest: 30,
    otherExpenses: 30,
    inflation: 10,
    unemployment: 8,
    tradeBalance: 1,
    budgetBalance: -20
  },
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 },
    projects: []
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 1_500_000,
    activePersonnel: 600_000,
    reservePersonnel: 900_000,
    militaryBudget: 300,
    armyStrength: 35,
    navyStrength: 15,
    airStrength: 15,
    nuclearWarheads: 0,
    units: [],
    equipment: { rifles: 1500000, trucks: 30000, tanks: 800, fighters: 300, bombers: 50, artillery: 3000, destroyers: 10, submarines: 5 }
  },
  diplomacy: { allies: ["USA"], rivals: ["China"], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
  politics: {
    stability: 50,
    governmentType: "Republic",
    ideology: "Nationalism",
    legitimacy: 40,
    corruption: 25,
    governmentSupport: 45
  },
  stockpile: { oil: 50, coal: 100, iron: 30, uranium: 0, gas: 20, food: 200, copper: 10, timber: 30, bauxite: 5, gold: 20, aluminum: 10, rareEarths: 0, lithium: 0 },
  goals: []
});