import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Французская зона оккупации 1946
export const GermanyFRA = createCountry({
  id: "DEU-FRA",
  name: "Германия (Французская зона)",
  shortName: "DEU-FRA",
  color: "#0055AA",
  capitalRegionId: 0,
  population: 5_000_000,
  economyType: EconomyType.Mixed,
  // Оккупированная зона: без вооружённых сил, высокая инфляция/безработица —
  // см. docs/SCENARIOS.md (страны-фикстуры).
  economyProfile: {
    spending: { military: 0 },
    inflation: 25,
    unemployment: 30,
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
    stability: 28,
    governmentType: "Occupied",
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 40,
    governmentSupport: 15
  },
  stockpile: { oil: 10, coal: 50, gas: 5, iron: 20, copper: 5, gold: 5, tin: 0, nickel: 0, bauxite: 5, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 30, timber: 10, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});
