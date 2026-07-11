import { describe, it, expect } from "vitest";
import { populationTick } from "./PopulationTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

describe("populationTick", () => {
  it("grows region population when births exceed deaths", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, population: 1_000_000, stability: 80 });
    const populationBefore = region.population;

    populationTick(country, [region]);

    expect(region.population).toBeGreaterThan(populationBefore);
  });

  it("is deterministic for identical inputs", () => {
    const countryA = createTestCountry();
    const countryB = createTestCountry();
    const regionA = createTestRegion({ ownerCountryId: countryA.id });
    const regionB = createTestRegion({ ownerCountryId: countryB.id });

    populationTick(countryA, [regionA]);
    populationTick(countryB, [regionB]);

    expect(regionA.population).toBe(regionB.population);
  });

  it("never drops region population below the 1000 floor", () => {
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, gdp: 1, educationSpending: 0, welfareSpending: 0 },
    });
    const region = createTestRegion({ ownerCountryId: country.id, population: 500, stability: 0 });

    populationTick(country, [region]);

    expect(region.population).toBeGreaterThanOrEqual(1000);
  });

  it("ignores regions owned by other countries", () => {
    const country = createTestCountry();
    const foreignRegion = createTestRegion({ ownerCountryId: "OTHER" });
    const populationBefore = foreignRegion.population;

    populationTick(country, [foreignRegion]);

    expect(foreignRegion.population).toBe(populationBefore);
  });

  it("бедная аграрная страна не теряет население в мире (демографический переход, калибровка CHN)", () => {
    // Очень низкий ВВП/чел (как CHN 1946, ~$83 против ориентира $850) при
    // мизерных тратах на образование/welfare. До калибровки формула тройно
    // подавляла рождаемость и страна убывала; теперь бедность не штрафует
    // фертильность ниже аграрной нормы — население не падает.
    const poor = createTestCountry({
      population: 100_000_000,
      economy: {
        ...createTestCountry().economy,
        gdp: 8_000_000_000, // ВВП/чел = 80, глубоко ниже ориентира 850
        educationSpending: 0,
        welfareSpending: 0,
      },
    });
    const region = createTestRegion({ ownerCountryId: poor.id, population: 100_000_000, stability: 50 });
    const populationBefore = region.population;

    populationTick(poor, [region]);

    expect(region.population).toBeGreaterThanOrEqual(populationBefore);
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => populationTick(country, [])).not.toThrow();
  });
});
