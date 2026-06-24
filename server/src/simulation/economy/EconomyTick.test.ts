import { describe, it, expect } from "vitest";
import { economyTick } from "./EconomyTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

describe("economyTick", () => {
  it("computes budgetBalance as income minus expenses and applies it to treasury", () => {
    const country = createTestCountry();
    const treasuryBefore = country.economy.treasury;
    const income =
      country.economy.taxRevenue +
      country.economy.exportIncome +
      country.economy.stateEnterpriseIncome +
      country.economy.otherIncome;
    const expenses =
      country.economy.militarySpending +
      country.economy.researchSpending +
      country.economy.educationSpending +
      country.economy.infrastructureSpending +
      country.economy.welfareSpending +
      country.economy.debtInterest +
      country.economy.otherExpenses;

    economyTick(country, []);

    expect(country.economy.budgetBalance).toBe(income - expenses);
    expect(country.economy.treasury).toBe(treasuryBefore + (income - expenses));
  });

  it("recomputes taxRevenue from gdp × taxRate (доход следует за ВВП)", () => {
    // Свежий ВВП выше, taxRevenue устарел — тик должен пересчитать его по ставке.
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, gdp: 1_000_000_000_000, taxRate: 0.25, taxRevenue: 1 },
    });

    economyTick(country, []);

    expect(country.economy.taxRevenue).toBe(1_000_000_000_000 * 0.25);
  });

  it("leaves taxRevenue untouched when taxRate is undefined", () => {
    const economy = createTestCountry().economy;
    delete economy.taxRate;
    const country = createTestCountry({ economy: { ...economy, taxRevenue: 42 } });

    economyTick(country, []);

    expect(country.economy.taxRevenue).toBe(42);
  });

  it("is deterministic for identical inputs", () => {
    const countryA = createTestCountry();
    const countryB = createTestCountry();
    const regionsA = [createTestRegion()];
    const regionsB = [createTestRegion()];

    economyTick(countryA, regionsA);
    economyTick(countryB, regionsB);

    expect(countryA.economy).toEqual(countryB.economy);
    expect(regionsA[0]!.gdp).toBe(regionsB[0]!.gdp);
  });

  it("grows region GDP when infrastructure and development are positive", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, infrastructure: 0.8, development: 0.8 });
    const gdpBefore = region.gdp;

    economyTick(country, [region]);

    expect(region.gdp).toBeGreaterThan(gdpBefore);
  });

  it("ignores regions owned by other countries", () => {
    const country = createTestCountry();
    const foreignRegion = createTestRegion({ ownerCountryId: "OTHER" });
    const gdpBefore = foreignRegion.gdp;

    economyTick(country, [foreignRegion]);

    expect(foreignRegion.gdp).toBe(gdpBefore);
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => economyTick(country, [])).not.toThrow();
  });
});
