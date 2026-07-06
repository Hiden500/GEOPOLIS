import { describe, it, expect } from "vitest";
import { researchTick } from "./ResearchTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

describe("researchTick", () => {
  it("растит прогресс доменов при положительном researchSpending, поровну без явного распределения", () => {
    const country = createTestCountry({
      technology: { domains: { armor: 0, naval: 0 } },
    });

    researchTick(country, []);

    expect(country.technology.domains.armor).toBeGreaterThan(0);
    expect(country.technology.domains.naval).toBeGreaterThan(0);
    // Поровну — без явного распределения оба домена получают одинаковую долю.
    expect(country.technology.domains.armor).toBeCloseTo(country.technology.domains.naval!, 5);
  });

  it("не растит прогресс при researchSpending <= 0", () => {
    const country = createTestCountry({
      technology: { domains: { armor: 0 } },
      economy: { ...createTestCountry().economy, researchSpending: 0 },
    });

    researchTick(country, []);

    expect(country.technology.domains.armor).toBe(0);
  });

  it("не падает и не мутирует при пустом наборе доменов", () => {
    const country = createTestCountry({ technology: { domains: {} } });
    expect(() => researchTick(country, [])).not.toThrow();
    expect(country.technology.domains).toEqual({});
  });

  it("явное распределение фокуса ускоряет один домен, остальные делят остаток поровну", () => {
    const country = createTestCountry({
      technology: {
        domains: { armor: 0, naval: 0, aviation: 0 },
        researchAllocation: { armor: 0.7 },
      },
    });

    researchTick(country, []);

    // armor получил 70%, naval/aviation делят оставшиеся 30% поровну (15% каждый)
    expect(country.technology.domains.armor).toBeGreaterThan(country.technology.domains.naval!);
    expect(country.technology.domains.naval).toBeCloseTo(country.technology.domains.aviation!, 5);
  });

  it("исследовательские центры (development > 0.7) ускоряют прогресс", () => {
    const withCenters = createTestCountry({
      id: "WITH_CENTERS",
      technology: { domains: { armor: 0 } },
    });
    const withoutCenters = createTestCountry({
      id: "WITHOUT_CENTERS",
      technology: { domains: { armor: 0 } },
    });
    const centerRegion = createTestRegion({ id: 1, ownerCountryId: "WITH_CENTERS", development: 0.9 });
    const plainRegion = createTestRegion({ id: 2, ownerCountryId: "WITHOUT_CENTERS", development: 0.3 });

    researchTick(withCenters, [centerRegion]);
    researchTick(withoutCenters, [plainRegion]);

    expect(withCenters.technology.domains.armor).toBeGreaterThan(withoutCenters.technology.domains.armor!);
  });

  it("замедляется на более высоком тире (не Victoria — поздний прорыв труднее)", () => {
    const lowTier = createTestCountry({ id: "LOW", technology: { domains: { armor: 0 } } });
    const highTier = createTestCountry({ id: "HIGH", technology: { domains: { armor: 1000 } } });

    researchTick(lowTier, []);
    researchTick(highTier, []);

    const lowGain = lowTier.technology.domains.armor!;
    const highGain = highTier.technology.domains.armor! - 1000;

    expect(highGain).toBeLessThan(lowGain);
  });
});
