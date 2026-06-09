import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

export const UK = createCountry({

  id: "UK",

  name: "United Kingdom",

  shortName: "UK",

  color: "#7c3aed",

  capitalRegionId: 3,

  population: 50_000_000,

  regionIds: [],

  economyType: EconomyType.Market,

  economy: {

    gdp: 32000,

    treasury: 2500,

    taxRevenue: 450,

    exportIncome: 250,

    stateEnterpriseIncome: 50,

    otherIncome: 50,

    militarySpending: 180,

    researchSpending: 40,

    educationSpending: 70,

    infrastructureSpending: 80,

    welfareSpending: 120,

    debtInterest: 100,

    otherExpenses: 40,

    inflation: 3,

    unemployment: 4,

    tradeBalance: -2,

    budgetBalance: 170
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

    manpower: 4_000_000,

    activePersonnel: 900_000,

    reservePersonnel: 3_100_000,

    militaryBudget: 4000,

    armyStrength: 65,

    navyStrength: 85,

    airStrength: 75,

    nuclearWarheads: 0,

    units: []

  },

  diplomacy: {

    allies: [],

    rivals: [],

    puppets: [],
    sphereOfInfluence: [],
    relations: {
    }

  },

  politics: {

    stability: 75,

    governmentType: "Constitutional Monarchy",

    ideology: "Center-Right",

    legitimacy: 85,

    corruption: 8,

    governmentSupport: 70
  },

  stockpile: {

    oil: 400,

    coal: 200,

    iron: 100,

    bauxite: 50,

    uranium: 20,

    aluminum: 30,

    rareEarths: 10,

    food: 500,

    timber: 300,

    gold: 20,

    copper: 40,

    lithium: 10,
    
    gas: 50
  },

  goals: []
});