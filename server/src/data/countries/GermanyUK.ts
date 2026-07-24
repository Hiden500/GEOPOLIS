import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Британская зона оккупации 1946
export const GermanyUK = createCountry({
  id: "DEU-UK",
  name: { ru: "Германия (Британская зона)" },
  shortName: { ru: "DEU-UK" },
  color: "#003366",
  capitalRegionId: 0,
  population: 20_000_000,
  economyType: EconomyType.Market,
  // Оккупированная зона: без вооружённых сил, высокая инфляция/безработица —
  // см. docs/SCENARIOS.md (страны-фикстуры).
  economyProfile: {
    spending: { military: 0 },
    inflation: 22,
    unemployment: 28,
  },
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 }
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
    stability: 30,
    governmentType: "Occupied",
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 38,
    governmentSupport: 18
  },
  stockpile: { oil: 35, coal: 160, gas: 18, iron: 70, copper: 18, gold: 18, tin: 0, nickel: 0, bauxite: 18, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 110, timber: 35, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});
