import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Советская зона оккупации 1946
export const GermanyUSSR = createCountry({
  id: "DEU-USSR",
  name: "Германия (Советская зона)",
  shortName: "DEU-USSR",
  color: "#CC0000",
  capitalRegionId: 0,
  population: 18_000_000,
  economyType: EconomyType.Planned,
  // Оккупированная зона: без вооружённых сил, высокая инфляция/безработица —
  // см. docs/SCENARIOS.md (страны-фикстуры).
  economyProfile: {
    spending: { military: 0 },
    inflation: 30,
    unemployment: 35,
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
    stability: 25,
    governmentType: "Occupied",
    ideology: "Communist",
    legitimacy: 0,
    corruption: 45,
    governmentSupport: 15
  },
  stockpile: { oil: 30, coal: 150, gas: 15, iron: 60, copper: 15, gold: 15, tin: 0, nickel: 0, bauxite: 15, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 100, timber: 30, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});
