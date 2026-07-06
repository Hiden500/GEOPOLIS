import { describe, it, expect } from "vitest";
import { getGdpPerCapita, getLivingStandardIndex } from "@shared/utils/countryMetrics";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

describe("getGdpPerCapita", () => {
  it("делит ВВП на население", () => {
    const country = createTestCountry({
      population: 10_000_000,
      economy: { ...createTestCountry().economy, gdp: 500_000_000_000 },
    });
    expect(getGdpPerCapita(country)).toBe(50_000);
  });

  it("возвращает 0 при нулевом населении (без деления на 0)", () => {
    const country = createTestCountry({ population: 0 });
    expect(getGdpPerCapita(country)).toBe(0);
  });
});

describe("getLivingStandardIndex", () => {
  it("выше у страны с большим ВВП/чел при прочих равных", () => {
    const rich = createTestCountry({
      id: "RICH",
      population: 10_000_000,
      economy: { ...createTestCountry().economy, gdp: 6_000_000_000 }, // $600/чел
    });
    const poor = createTestCountry({
      id: "POOR",
      population: 10_000_000,
      economy: { ...createTestCountry().economy, gdp: 1_000_000_000 }, // $100/чел
    });

    expect(getLivingStandardIndex(rich, [])).toBeGreaterThan(getLivingStandardIndex(poor, []));
  });

  it("учитывает урбанизацию/инфраструктуру регионов страны", () => {
    const country = createTestCountry({ id: "USA" });
    const developed = createTestRegion({ id: 1, ownerCountryId: "USA", urbanization: 0.9, infrastructure: 0.9 });
    const undeveloped = createTestRegion({ id: 2, ownerCountryId: "USA", urbanization: 0.1, infrastructure: 0.1 });

    const withDeveloped = getLivingStandardIndex(country, [developed]);
    const withUndeveloped = getLivingStandardIndex(country, [undeveloped]);

    expect(withDeveloped).toBeGreaterThan(withUndeveloped);
  });

  it("остаётся в диапазоне 0-100", () => {
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, gdp: 50_000_000_000_000, welfareSpending: 1e15 },
    });
    const index = getLivingStandardIndex(country, []);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThanOrEqual(100);
  });
});
