import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";
import { UnitType } from "@shared/types/military/UnitType";

export const USSR = createCountry({

  id: "USSR",

  name: "Soviet Union",

  shortName: "USSR",

  color: "#d62828",

  capitalRegionId: 1,

  population: 170_000_000,

  regionIds: [],

  economyType: EconomyType.Planned,

  economy: {

    gdp: 90000,

    treasury: 5000,

    taxRevenue: 900,

    exportIncome: 150,

    stateEnterpriseIncome: 700,

    otherIncome: 100,

    militarySpending: 400,

    researchSpending: 80,

    educationSpending: 120,

    infrastructureSpending: 300,

    welfareSpending: 150,

    debtInterest: 0,

    otherExpenses: 100,

    inflation: 2,

    unemployment: 1,

    tradeBalance: 3,

    budgetBalance: 700
  },

  technology: {

    domains: {

      nuclear: 1,

      rocketry: 1,

      electronics: 1,

      aviation: 1,

      biology: 1,

      armor: 1,

      naval: 1,

      infantry: 1
    },

    projects: []
  },

  researchedTechnologyIds: [],

  military: {

    manpower: 5000000,

    activePersonnel: 5000000,

    reservePersonnel: 10000000,

    militaryBudget: 30000,

    armyStrength: 95,

    navyStrength: 45,

    airStrength: 55,

    nuclearWarheads: 0,

    units: [

      {
        id: "ussr_army_1",

        name: "1st Guards Army",

        type: UnitType.Infantry,

        strength: 100,

        experience: 50,

        regionId: 1
      },

      {
        id: "ussr_tank_1",

        name: "2nd Guards Tank Army",

        type: UnitType.Armor,

        strength: 100,

        experience: 60,

        regionId: 2
      }
    ],

    equipment: {

      rifles: 5000000,

      trucks: 200000,

      tanks: 25000,

      fighters: 12000,

      bombers: 4000,

      artillery: 60000,

      destroyers: 80,

      submarines: 250
    }
  },

  diplomacy: {

    allies: [],

    rivals: ["USA"],

    puppets: [],

    sphereOfInfluence: [],

    relations: {}
  },

  politics: {

    stability: 80,

    governmentType: "Communist",

    ideology: "Communism",

    legitimacy: 90,

    corruption: 15,

    governmentSupport: 85
  },
  stockpile: {
    oil: 5000,

    coal: 8000,

    iron: 3000,

    bauxite: 2000,

    uranium: 1000,

    rareEarths: 500,

    food: 10000,

    timber: 7000,

    gold: 200,

    copper: 1500,

    aluminum: 1200,

    lithium: 300,

    gas: 4000
  },

  goals: []
});