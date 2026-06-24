import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

export const FRA = createCountry({
  id: "FRA",
  name: "France",
  shortName: "FRA",
  color: "#6366f1",
  capitalRegionId: 26,
  population: 42_000_000,
  economyType: EconomyType.Market,
  economy: {
    gdp: 48000,
    treasury: 3000,
    taxRevenue: 700,
    exportIncome: 300,
    stateEnterpriseIncome: 80,
    otherIncome: 50,
    militarySpending: 250,
    researchSpending: 60,
    educationSpending: 100,
    infrastructureSpending: 90,
    welfareSpending: 150,
    debtInterest: 120,
    otherExpenses: 50,
    inflation: 2.5,
    unemployment: 5,
    tradeBalance: 1,
    budgetBalance: 220
  },
  technology: {
    domains: {
      nuclear: 1,
      rocketry: 1,
      electronics: 1,
      aviation: 1,
      biology: 1,
      armor: 1,
      naval: 2,
      infantry: 1
    },
    projects: []
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 3_000_000,
    activePersonnel: 800_000,
    reservePersonnel: 2_200_000,
    militaryBudget: 3500,
    armyStrength: 65,
    navyStrength: 70,
    airStrength: 60,
    nuclearWarheads: 0,
    units: [],
    equipment: {
      rifles: 400000,
      trucks: 40000,
      tanks: 800,
      fighters: 600,
      bombers: 200,
      artillery: 4000,
      destroyers: 40,
      submarines: 20
    }
  },
  diplomacy: {
    allies: [],
    rivals: [],
    puppets: [],
    sphereOfInfluence: [],
    relations: {},
    influence: {},
    guarantees: [],
    sanctions: {}
  },
  politics: {
    stability: 70,
    governmentType: "Republic",
    ideology: "Center-Left",
    legitimacy: 75,
    corruption: 12,
    governmentSupport: 65
  },
  stockpile: {
    oil: 300,
    coal: 150,
    iron: 80,
    bauxite: 40,
    uranium: 30,
    aluminum: 25,
    rareEarths: 5,
    food: 400,
    timber: 200,
    gold: 15,
    copper: 30,
    lithium: 8,
    gas: 60
  },
  goals: []
});