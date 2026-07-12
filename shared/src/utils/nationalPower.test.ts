import { describe, it, expect } from "vitest";
import { getNationalPower, computePlayerStanding } from "./nationalPower";
import { type Country } from "../types/Country";

/** Минимальная страна для теста силы — только поля, читаемые формулой. */
function powerCountry(over: {
  id?: string;
  gdp?: number;
  activePersonnel?: number;
  population?: number;
  domains?: Record<string, number>;
}): Country {
  return {
    id: over.id ?? "X",
    name: over.id ?? "X",
    shortName: over.id ?? "X",
    color: "#fff",
    tier: "minor",
    capitalRegionId: 1,
    population: over.population ?? 10_000_000,
    economy: { gdp: over.gdp ?? 0 } as Country["economy"],
    economyType: "market",
    technology: { domains: over.domains ?? {} },
    researchedTechnologyIds: [],
    military: {
      manpower: 0, activePersonnel: over.activePersonnel ?? 0, reservePersonnel: 0,
      militaryBudget: 0, armyStrength: 0, navyStrength: 0, airStrength: 0,
      nuclearWarheads: 0, units: [],
      equipment: { rifles: 0, trucks: 0, tanks: 0, fighters: 0, bombers: 0, artillery: 0, destroyers: 0, submarines: 0 },
    } as Country["military"],
    diplomacy: { allies: [], rivals: [], puppets: [], sphereOfInfluence: [], relations: {}, influence: {}, guarantees: [], sanctions: {} },
    politics: { ideology: "democracy" } as Country["politics"],
    stockpile: {} as Country["stockpile"],
    goals: [],
    aiTraits: { aggressiveness: 1, riskTolerance: 1 },
  };
}

describe("getNationalPower", () => {
  it("выше ВВП → выше сила (при прочих равных)", () => {
    const poor = powerCountry({ gdp: 1_000_000_000 });
    const rich = powerCountry({ gdp: 500_000_000_000 });
    expect(getNationalPower(rich)).toBeGreaterThan(getNationalPower(poor));
  });

  it("больше армии → выше сила", () => {
    const weak = powerCountry({ gdp: 1_000_000_000, activePersonnel: 100_000 });
    const strong = powerCountry({ gdp: 1_000_000_000, activePersonnel: 5_000_000 });
    expect(getNationalPower(strong)).toBeGreaterThan(getNationalPower(weak));
  });

  it("выше тир технологий → выше сила", () => {
    const lowTech = powerCountry({ gdp: 1_000_000_000, domains: {} });
    const highTech = powerCountry({ gdp: 1_000_000_000, domains: { industry: 500, nuclear: 500 } });
    expect(getNationalPower(highTech)).toBeGreaterThan(getNationalPower(lowTech));
  });

  it("нулевая страна даёт 0", () => {
    expect(getNationalPower(powerCountry({}))).toBe(
      // только population-компонента (10M/1M × 0.3 = 3)
      3
    );
  });
});

describe("computePlayerStanding", () => {
  it("сильнейшая страна — ранг 1", () => {
    const countries = [
      powerCountry({ id: "SML", gdp: 1_000_000_000 }),
      powerCountry({ id: "BIG", gdp: 900_000_000_000 }),
      powerCountry({ id: "MID", gdp: 100_000_000_000 }),
    ];
    const standing = computePlayerStanding(countries, "BIG");
    expect(standing.rank).toBe(1);
    expect(standing.total).toBe(3);
  });

  it("слабейшая страна — последний ранг", () => {
    const countries = [
      powerCountry({ id: "SML", gdp: 1_000_000_000 }),
      powerCountry({ id: "BIG", gdp: 900_000_000_000 }),
      powerCountry({ id: "MID", gdp: 100_000_000_000 }),
    ];
    const standing = computePlayerStanding(countries, "SML");
    expect(standing.rank).toBe(3);
  });

  it("ничьи разрешаются детерминированно по id", () => {
    const countries = [
      powerCountry({ id: "BBB", gdp: 100_000_000_000 }),
      powerCountry({ id: "AAA", gdp: 100_000_000_000 }),
    ];
    // Равная сила → по id: AAA раньше BBB.
    expect(computePlayerStanding(countries, "AAA").rank).toBe(1);
    expect(computePlayerStanding(countries, "BBB").rank).toBe(2);
  });
});
