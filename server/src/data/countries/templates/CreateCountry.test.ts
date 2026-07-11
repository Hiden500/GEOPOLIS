import { describe, it, expect } from "vitest";
import { createCountry } from "./CreateCountry";
import { EconomyType } from "@shared/types/EconomyType";

/**
 * createCountry дефолтит все рантайм-блоки нулевыми значениями поверх
 * авторских оверрайдов (docs/plans/05_DATA_LAYOUT.md, Срез 2) — единый путь
 * сборки для 12 рукописных TS-стран (1836/2000) и JSON-авторских стран (1946).
 */
describe("createCountry (план 05, Срез 2 — авторский ввод без нулевых блоков)", () => {
  function minimalInput() {
    return {
      id: "TST",
      name: "Testland",
      shortName: "Testland",
      color: "#123456",
      capitalRegionId: 1,
      economyType: EconomyType.Mixed,
      politics: { ideology: "Liberal Democracy" },
    };
  }

  it("минимальный ввод собирает полностью нулевые рантайм-блоки", () => {
    const country = createCountry(minimalInput());

    expect(country.population).toBe(0);
    expect(country.technology).toEqual({ domains: {} });
    expect(country.researchedTechnologyIds).toEqual([]);
    expect(country.goals).toEqual([]);
    expect(country.military.manpower).toBe(0);
    expect(country.military.units).toEqual([]);
    expect(country.military.equipment).toEqual({
      rifles: 0, trucks: 0, tanks: 0, fighters: 0, bombers: 0, artillery: 0, destroyers: 0, submarines: 0,
    });
    expect(country.diplomacy).toEqual({
      allies: [], rivals: [], puppets: [], sphereOfInfluence: [],
      relations: {}, influence: {}, guarantees: [], sanctions: {},
    });
    expect(country.stockpile.oil).toBe(0);
    expect(country.stockpile.uranium).toBe(0);
  });

  it("politics: ideology обязательна, остальное дефолтится (50/50/30/50/Unknown)", () => {
    const country = createCountry(minimalInput());
    expect(country.politics).toEqual({
      ideology: "Liberal Democracy",
      governmentType: "Unknown",
      stability: 50,
      legitimacy: 50,
      corruption: 30,
      governmentSupport: 50,
    });
  });

  it("авторские оверрайды (puppets/manpower/domains) переживают дефолтизацию", () => {
    const country = createCountry({
      ...minimalInput(),
      technology: { domains: { armor: 2, naval: 1 } },
      military: { manpower: 5000, equipment: { tanks: 10 } },
      diplomacy: { puppets: ["SUB"], sphereOfInfluence: ["SUB"] },
    });

    expect(country.technology.domains).toEqual({ armor: 2, naval: 1 });
    expect(country.military.manpower).toBe(5000);
    expect(country.military.equipment.tanks).toBe(10);
    expect(country.military.equipment.rifles).toBe(0); // остальное оборудование всё равно нулевое
    expect(country.diplomacy.puppets).toEqual(["SUB"]);
    expect(country.diplomacy.allies).toEqual([]); // не тронуто оверрайдом — дефолт
  });

  it("economy.inflation/unemployment/tradeBalance выводятся из economyProfile (единый путь и для 1946, и для 1836/2000)", () => {
    const country = createCountry(minimalInput());
    // economyType "mixed" -> архетип economyArchetypes.ts, inflation/unemployment ненулевые.
    expect(country.economy.inflation).toBe(country.economyProfile.inflation);
    expect(country.economy.unemployment).toBe(country.economyProfile.unemployment);
  });
});
