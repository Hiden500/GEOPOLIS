import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Британская зона оккупации 1946
export const GermanyUK = createCountry({
  id: "DEU-UK",
  name: "Германия (Британская зона)",
  shortName: "DEU-UK",
  color: "#003366",
  capitalRegionId: 0,
  population: 20_000_000,
  economyType: EconomyType.Market,
  economy: {
    gdp: 10000,
    treasury: 700,
    taxRevenue: 180,
    exportIncome: 70,
    stateEnterpriseIncome: 10,
    otherIncome: 15,
    militarySpending: 0,
    researchSpending: 18,
    educationSpending: 35,
    infrastructureSpending: 50,
    welfareSpending: 60,
    debtInterest: 35,
    otherExpenses: 35,
    inflation: 22,
    unemployment: 28,
    tradeBalance: -1,
    budgetBalance: -40
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
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 38,
    governmentSupport: 18
  },
  stockpile: { oil: 35, coal: 160, iron: 70, uranium: 0, gas: 18, food: 110, copper: 18, timber: 35, bauxite: 7, gold: 18, aluminum: 11, rareEarths: 0, lithium: 0 },
  goals: []
});
