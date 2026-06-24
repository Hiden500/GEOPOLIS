import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Италия 1946 — республика после падения фашизма
export const Italy = createCountry({
  id: "Italy",
  name: "Italy",
  shortName: "ITA",
  color: "#16a34a",
  capitalRegionId: 0,
  population: 47_000_000,
  economyType: EconomyType.Mixed,
  economy: {
    gdp: 45000,
    treasury: 5000,
    taxRevenue: 800,
    exportIncome: 400,
    stateEnterpriseIncome: 100,
    otherIncome: 100,
    militarySpending: 200,
    researchSpending: 80,
    educationSpending: 150,
    infrastructureSpending: 150,
    welfareSpending: 300,
    debtInterest: 100,
    otherExpenses: 100,
    inflation: 5,
    unemployment: 12,
    tradeBalance: 2,
    budgetBalance: -30
  },
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 },
    projects: []
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 2_000_000,
    activePersonnel: 250_000,
    reservePersonnel: 1_500_000,
    militaryBudget: 400,
    armyStrength: 30,
    navyStrength: 25,
    airStrength: 20,
    nuclearWarheads: 0,
    units: [],
    equipment: { rifles: 2000000, trucks: 80000, tanks: 2000, fighters: 800, bombers: 200, artillery: 5000, destroyers: 30, submarines: 15 }
  },
  diplomacy: { allies: [], rivals: [], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
  politics: {
    stability: 60,
    governmentType: "Republic",
    ideology: "Democracy",
    legitimacy: 70,
    corruption: 20,
    governmentSupport: 55
  },
  stockpile: { oil: 200, coal: 300, iron: 150, uranium: 0, gas: 100, food: 500, copper: 50, timber: 80, bauxite: 30, gold: 30, aluminum: 50, rareEarths: 0, lithium: 0 },
  goals: []
});