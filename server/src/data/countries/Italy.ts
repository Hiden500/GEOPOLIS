import { createCountry } from "./templates/CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

// Италия 1946 — республика после падения фашизма
export const Italy = createCountry({
  // id должен совпадать с ownerCountryId в data/scenarios/1946/regions.json
  // ("ITA"), иначе страна не владеет ни одним регионом (gdp=0, найдено при
  // верификации Q9 — см. docs/DECISIONS.md 2026-06-26).
  id: "ITA",
  name: "Italy",
  shortName: "ITA",
  color: "#16a34a",
  capitalRegionId: 0,
  population: 47_000_000,
  economyType: EconomyType.Mixed,
  technology: {
    domains: { nuclear: 0, rocketry: 0, electronics: 0, aviation: 0, biology: 0, armor: 0, naval: 0, infantry: 0 }
  },
  researchedTechnologyIds: [],
  military: {
    manpower: 2_000_000,
    activePersonnel: 250_000,
    reservePersonnel: 1_500_000,
    militaryBudget: 400,
    armyStrength: 30,
    navyStrength: 25,
    airStrength: 20,
    nuclearWarheads: 0,
    units: [],
    equipment: { rifles: 2000000, trucks: 80000, tanks: 2000, fighters: 800, bombers: 200, artillery: 5000, destroyers: 30, submarines: 15 }
  },
  diplomacy: { allies: [], rivals: [], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
  politics: {
    stability: 60,
    governmentType: "Republic",
    ideology: "Democracy",
    legitimacy: 70,
    corruption: 20,
    governmentSupport: 55
  },
  stockpile: { oil: 200, coal: 300, gas: 100, iron: 150, copper: 50, gold: 30, tin: 0, nickel: 0, bauxite: 80, tungsten: 0, manganese: 0, chromium: 0, uranium: 0, rareEarths: 0, lithium: 0, food: 500, timber: 80, cotton: 0, rubber: 0, nitrates: 0 },
  goals: []
});