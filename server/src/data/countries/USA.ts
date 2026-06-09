import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";
import { UnitType } from "@shared/types/military/UnitType";

export const USA = createCountry({

  id: "USA",

  name: "United States",

  shortName: "USA",

  color: "#2563eb",

  capitalRegionId: 2,

  population: 140_000_000,

  regionIds: [],

  economyType: EconomyType.Market,

  economy: {

    gdp: 228000,

    treasury: 12000,

    taxRevenue: 2500,

    exportIncome: 1000,

    stateEnterpriseIncome: 50,

    otherIncome: 300,

    militarySpending: 900,

    researchSpending: 250,

    educationSpending: 350,

    infrastructureSpending: 250,

    welfareSpending: 400,

    debtInterest: 50,

    otherExpenses: 250,

    inflation: 1.5,

    unemployment: 3,

    tradeBalance: 5,

    budgetBalance: 1950
  },

  technology: {

    domains: {

      nuclear: 2,

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

    manpower: 12_000_000,

    activePersonnel: 3_000_000,

    reservePersonnel: 9_000_000,

    militaryBudget: 5000,

    armyStrength: 80,

    navyStrength: 100,

    airStrength: 90,

    nuclearWarheads: 2,

    units: []
  },

  diplomacy: {

    allies: [],

    rivals: ["USSR"],

    puppets: [],

    sphereOfInfluence: [],

    relations: {}
  },

  politics: {

    stability: 85,

    governmentType: "Democracy",

    ideology: "Capitalism",

    legitimacy: 90,

    corruption: 10,

    governmentSupport: 75
  },

  stockpile: {

    oil: 3500,

    coal: 3000,

    iron: 2500,

    uranium: 500,

    gas: 2000,

    food: 3500,

    copper: 1000,

    timber: 1500,

    bauxite: 800,

    gold: 500,

    aluminum: 1200,

    rareEarths: 0,

    lithium: 0
  },

  goals: []
});