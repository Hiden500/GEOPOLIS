import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Китайская Народная Республика (Коммунисты) — 1946
export const China = createCountry({
  id: "China",
  name: { en: "People's Republic of China" },
  shortName: { en: "PRC" },
  color: "#b91c1c",
  capitalRegionId: 33,
  population: 540_000_000,
  economyType: EconomyType.Planned,
  economyProfile: { inflation: 15, unemployment: 20 },
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 }
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 20_000_000,
    activePersonnel: 5_000_000,
    reservePersonnel: 15_000_000,
    militaryBudget: 2000,
    armyStrength: 60,
    navyStrength: 10,
    airStrength: 10,
    nuclearWarheads: 0,
    units: [],
    equipment: { rifles: 8000000, trucks: 100000, tanks: 3000, fighters: 500, bombers: 100, artillery: 20000, destroyers: 10, submarines: 5 }
  },
  diplomacy: { allies: ["USSR"], rivals: ["Taiwan"], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
  politics: {
    stability: 40,
    governmentType: "Communist State",
    ideology: "Communism",
    legitimacy: 50,
    corruption: 30,
    governmentSupport: 60
  },
  stockpile: { oil: 200, coal: 2000, gas: 50, iron: 500, copper: 100, gold: 100, tin: 0, nickel: 0, bauxite: 100, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 3000, timber: 500, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});