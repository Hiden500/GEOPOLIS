import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

export const UK = createCountry({

  id: "UK",

  name: "United Kingdom",

  shortName: "UK",

  color: "#7c3aed",

  capitalRegionId: 3,

  population: 50_000_000,

  economyType: EconomyType.Market,

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

    units: [],

    equipment: {
      rifles: 500000,
      trucks: 50000,
      tanks: 1000,
      fighters: 800,
      bombers: 300,
      artillery: 5000,
      destroyers: 60,
      submarines: 30
    }
  },

  diplomacy: {

    allies: [],

    rivals: [],

    puppets: [],
    sphereOfInfluence: [],
    relations: {
    },
    influence: {},
    guarantees: [],
    sanctions: {}

  },

  politics: {

    stability: 75,

    governmentType: "Constitutional Monarchy",

    ideology: "Center-Right",

    legitimacy: 85,

    corruption: 8,

    governmentSupport: 70
  },

  stockpile: { oil: 400, coal: 200, gas: 50, iron: 100, copper: 40, gold: 20, tin: 0, nickel: 0, bauxite: 80, tungsten: 0, manganese: 0, chromium: 0, uranium: 20, rareEarths: 10, lithium: 10, food: 500, timber: 300, cotton: 0, rubber: 0, nitrates: 0 },

  goals: []
});