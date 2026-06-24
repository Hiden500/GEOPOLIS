import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Французская зона оккупации 1946
export const GermanyFRA = createCountry({
  id: "DEU-FRA",
  name: "Германия (Французская зона)",
  shortName: "DEU-FRA",
  color: "#0055AA",
  capitalRegionId: 0,
  population: 5_000_000,
  economyType: EconomyType.Mixed,
  economy: {
    gdp: 2000,
    treasury: 150,
    taxRevenue: 40,
    exportIncome: 15,
    stateEnterpriseIncome: 5,
    otherIncome: 5,
    militarySpending: 0,
    researchSpending: 5,
    educationSpending: 10,
    infrastructureSpending: 15,
    welfareSpending: 15,
    debtInterest: 10,
    otherExpenses: 10,
    inflation: 25,
    unemployment: 30,
    tradeBalance: -1,
    budgetBalance: -15
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
    stability: 28,
    governmentType: "Occupied",
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 40,
    governmentSupport: 15
  },
  stockpile: { oil: 10, coal: 50, iron: 20, uranium: 0, gas: 5, food: 30, copper: 5, timber: 10, bauxite: 2, gold: 5, aluminum: 3, rareEarths: 0, lithium: 0 },
  goals: []
});
