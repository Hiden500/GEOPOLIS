import { describe, it, expect } from "vitest";
import { militaryTick } from "./MilitaryTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { UnitType } from "@shared/types/military/UnitType";

describe("militaryTick", () => {
  it("grows manpower based on owned regions' population", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, population: 10_000_000 });
    const manpowerBefore = country.military.manpower;

    militaryTick(country, [region]);

    expect(country.military.manpower).toBeGreaterThan(manpowerBefore);
  });

  it("halves manpower gain when political stability is below 50", () => {
    const stableCountry = createTestCountry({ id: "STABLE", politics: { ...createTestCountry().politics, stability: 80 } });
    const unstableCountry = createTestCountry({ id: "UNSTABLE", politics: { ...createTestCountry().politics, stability: 10 } });
    const stableRegion = createTestRegion({ id: 1, ownerCountryId: "STABLE", population: 10_000_000 });
    const unstableRegion = createTestRegion({ id: 2, ownerCountryId: "UNSTABLE", population: 10_000_000 });

    militaryTick(stableCountry, [stableRegion]);
    militaryTick(unstableCountry, [unstableRegion]);

    const stableGain = stableCountry.military.manpower - createTestCountry().military.manpower;
    const unstableGain = unstableCountry.military.manpower - createTestCountry().military.manpower;

    expect(unstableGain).toBeLessThan(stableGain);
  });

  it("recovers damaged unit strength up to a cap of 100", () => {
    const country = createTestCountry();
    country.military.units = [
      { id: "u1", name: "1st Infantry", type: UnitType.Infantry, strength: 50, experience: 0, regionId: 1 },
    ];

    militaryTick(country, []);

    expect(country.military.units[0]!.strength).toBeGreaterThan(50);
    expect(country.military.units[0]!.strength).toBeLessThanOrEqual(100);
  });

  it("derives activePersonnel and reservePersonnel from manpower", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id });

    militaryTick(country, [region]);

    expect(country.military.activePersonnel).toBe(Math.floor(country.military.manpower * 0.1));
    expect(country.military.reservePersonnel).toBe(Math.floor(country.military.manpower * 0.9));
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => militaryTick(country, [])).not.toThrow();
  });

  describe("производство техники (War Phase 2, 2026-07-06)", () => {
    it("без явного productionAllocation все 8 категорий получают равную долю", () => {
      const country = createTestCountry();

      militaryTick(country, []);

      const gains = Object.values(country.military.equipment);
      expect(gains.every(g => g > 0)).toBe(true);
      const first = gains[0]!;
      for (const g of gains) {
        expect(g).toBeCloseTo(first);
      }
    });

    it("явная доля в productionAllocation даёт этой категории больше остальных", () => {
      const country = createTestCountry({
        military: {
          ...createTestCountry().military,
          productionAllocation: { tanks: 0.7 },
        },
      });

      militaryTick(country, []);

      expect(country.military.equipment.tanks).toBeGreaterThan(country.military.equipment.rifles);
    });

    it("прирост техники растёт с militarySpending", () => {
      const lowSpend = createTestCountry({
        id: "LOW",
        economy: { ...createTestCountry().economy, militarySpending: 5_000_000_000 },
      });
      const highSpend = createTestCountry({
        id: "HIGH",
        economy: { ...createTestCountry().economy, militarySpending: 50_000_000_000 },
      });

      militaryTick(lowSpend, []);
      militaryTick(highSpend, []);

      expect(highSpend.military.equipment.rifles).toBeGreaterThan(lowSpend.military.equipment.rifles);
    });

    it("не производит технику при нулевом militarySpending (страна без территории)", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, militarySpending: 0 },
      });

      militaryTick(country, []);

      expect(Object.values(country.military.equipment).every(v => v === 0)).toBe(true);
    });
  });
});
