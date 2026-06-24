import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Американская зона оккупации 1946
export const GermanyUSA = createCountry({
  id: "DEU-USA",
  name: "Германия (Американская зона)",
  shortName: "DEU-USA",
  color: "#0066CC",
  capitalRegionId: 0,
  population: 22_000_000,
  economyType: EconomyType.Market,
  economy: {
    gdp: 12000,
    treasury: 800,
    taxRevenue: 200,
    exportIncome: 80,
    stateEnterpriseIncome: 10,
    otherIncome: 20,
    militarySpending: 0,
    researchSpending: 20,
    educationSpending: 40,
    infrastructureSpending: 60,
    welfareSpending: 70,
    debtInterest: 40,
    otherExpenses: 40,
    inflation: 20,
    unemployment: 25,
    tradeBalance: -1,
    budgetBalance: -30
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
    stability: 35,
    governmentType: "Occupied",
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 35,
    governmentSupport: 20
  },
  stockpile: { oil: 40, coal: 180, iron: 80, uranium: 0, gas: 20, food: 120, copper: 20, timber: 40, bauxite: 8, gold: 20, aluminum: 12, rareEarths: 0, lithium: 0 },
  goals: []
});
