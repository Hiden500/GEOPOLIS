import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия 1946 — оккупированная, без вооружённых сил
export const Germany = createCountry({
  id: "Germany",
  name: "Germany (Occupied)",
  shortName: "DEU",
  color: "#808080",
  capitalRegionId: 0,
  population: 65_000_000,
  economyType: EconomyType.Mixed,
  economy: {
    gdp: 30000,
    treasury: 2000,
    taxRevenue: 500,
    exportIncome: 200,
    stateEnterpriseIncome: 30,
    otherIncome: 50,
    militarySpending: 0,
    researchSpending: 50,
    educationSpending: 100,
    infrastructureSpending: 150,
    welfareSpending: 200,
    debtInterest: 100,
    otherExpenses: 100,
    inflation: 25,
    unemployment: 30,
    tradeBalance: -5,
    budgetBalance: -200
  },
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 },
    projects: []
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 0,
    activePersonnel: 0,
    reservePersonnel: 0,
    militaryBudget: 0,
    armyStrength: 0,
    navyStrength: 0,
    airStrength: 0,
    nuclearWarheads: 0,
    units: [],
    equipment: { rifles: 0, trucks: 0, tanks: 0, fighters: 0, bombers: 0, artillery: 0, destroyers: 0, submarines: 0 }
  },
  diplomacy: { allies: [], rivals: [], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
  politics: {
    stability: 30,
    governmentType: "Occupied",
    ideology: "None",
    legitimacy: 0,
    corruption: 40,
    governmentSupport: 10
  },
  stockpile: { oil: 100, coal: 500, iron: 200, uranium: 0, gas: 50, food: 300, copper: 50, timber: 100, bauxite: 20, gold: 50, aluminum: 30, rareEarths: 0, lithium: 0 },
  goals: []
});