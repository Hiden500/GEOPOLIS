import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";
import { UnitType } from "@shared/types/military/UnitType";

export const USA = createCountry({

  id: "USA",

  name: { en: "United States" },

  shortName: { en: "USA" },

  color: "#2563eb",

  capitalRegionId: 8,

  population: 140_000_000,

  economyType: EconomyType.Market,

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
    }

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

    units: [],

    equipment: {
      rifles: 10000000,
      trucks: 500000,
      tanks: 30000,
      fighters: 15000,
      bombers: 8000,
      artillery: 50000,
      destroyers: 200,
      submarines: 150
    }
  },

  diplomacy: {

    allies: [],

    rivals: ["USSR"],

    puppets: [],

    sphereOfInfluence: [],

    relations: {},

    influence: {},

    guarantees: [],

    sanctions: {}
  },

  politics: {

    stability: 85,

    governmentType: "Democracy",

    ideology: "Capitalism",

    legitimacy: 90,

    corruption: 10,

    governmentSupport: 75
  },

  stockpile: { oil: 3500, coal: 3000, gas: 2000, iron: 2500, copper: 1000, gold: 500, tin: 0, nickel: 0, bauxite: 2000, tungsten: 0, manganese: 0, chromium: 0, uranium: 500, rareEarths: 0, lithium: 0, food: 3500, timber: 1500, cotton: 0, rubber: 0, nitrates: 0 },

  goals: []
});