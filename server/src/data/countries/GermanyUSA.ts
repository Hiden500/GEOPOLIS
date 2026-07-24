import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Германия - Американская зона оккупации 1946
export const GermanyUSA = createCountry({
  id: "DEU-USA",
  name: { ru: "Германия (Американская зона)" },
  shortName: { ru: "DEU-USA" },
  color: "#0066CC",
  capitalRegionId: 0,
  population: 22_000_000,
  economyType: EconomyType.Market,
  // Оккупированная зона: без вооружённых сил, высокая инфляция/безработица —
  // см. docs/SCENARIOS.md (страны-фикстуры).
  economyProfile: {
    spending: { military: 0 },
    inflation: 20,
    unemployment: 25,
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
    stability: 35,
    governmentType: "Occupied",
    ideology: "Democratic",
    legitimacy: 0,
    corruption: 35,
    governmentSupport: 20
  },
  stockpile: { oil: 40, coal: 180, gas: 20, iron: 80, copper: 20, gold: 20, tin: 0, nickel: 0, bauxite: 20, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 120, timber: 40, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});
