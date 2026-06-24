import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Советская зона оккупации 1946
export const GermanyUSSR = createCountry({
  id: "DEU-USSR",
  name: "Германия (Советская зона)",
  shortName: "DEU-USSR",
  color: "#CC0000",
  capitalRegionId: 0,
  population: 18_000_000,
  economyType: EconomyType.Planned,
  economy: {
    gdp: 8000,
    treasury: 500,
    taxRevenue: 150,
    exportIncome: 50,
    stateEnterpriseIncome: 20,
    otherIncome: 10,
    militarySpending: 0,
    researchSpending: 15,
    educationSpending: 30,
    infrastructureSpending: 40,
    welfareSpending: 50,
    debtInterest: 30,
    otherExpenses: 30,
    inflation: 30,
    unemployment: 35,
    tradeBalance: -2,
    budgetBalance: -50
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
    stability: 25,
    governmentType: "Occupied",
    ideology: "Communist",
    legitimacy: 0,
    corruption: 45,
    governmentSupport: 15
  },
  stockpile: { oil: 30, coal: 150, iron: 60, uranium: 0, gas: 15, food: 100, copper: 15, timber: 30, bauxite: 5, gold: 15, aluminum: 10, rareEarths: 0, lithium: 0 },
  goals: []
});
