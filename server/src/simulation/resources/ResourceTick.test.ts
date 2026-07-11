import { describe, it, expect } from "vitest";
import { resourceTick } from "./ResourceTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { OCCUPATION_EXTRACTION_PENALTY } from "@shared/defines/occupation";

describe("resourceTick", () => {
  it("adds extracted resources to the country stockpile", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, infrastructure: 0, resourceProduction: { oil: 1000 } });
    const oilBefore = country.stockpile.oil;

    resourceTick(country, [region]);

    expect(country.stockpile.oil).toBeGreaterThan(oilBefore);
  });

  it("scales extraction with infrastructure", () => {
    const lowInfraCountry = createTestCountry({ id: "LOW" });
    const lowInfraRegion = createTestRegion({ id: 1, ownerCountryId: "LOW", infrastructure: 0, resourceProduction: { oil: 1000 } });

    const highInfraCountry = createTestCountry({ id: "HIGH" });
    const highInfraRegion = createTestRegion({ id: 2, ownerCountryId: "HIGH", infrastructure: 1, resourceProduction: { oil: 1000 } });

    resourceTick(lowInfraCountry, [lowInfraRegion]);
    resourceTick(highInfraCountry, [highInfraRegion]);

    const lowGain = lowInfraCountry.stockpile.oil - createTestCountry().stockpile.oil;
    const highGain = highInfraCountry.stockpile.oil - createTestCountry().stockpile.oil;

    expect(highGain).toBeGreaterThan(lowGain);
  });

  it("slightly depletes the region's resource production, with a 10% floor", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, resourceProduction: { oil: 1000 } });

    resourceTick(country, [region]);

    expect(region.resourceProduction.oil).toBeLessThan(1000);
    expect(region.resourceProduction.oil).toBeGreaterThan(100);
  });

  it("only processes regions actually owned by the country, not other owners' regions", () => {
    const country = createTestCountry();
    const ownedRegion = createTestRegion({ id: 1, ownerCountryId: country.id, resourceProduction: { oil: 1000 } });
    const foreignRegion = createTestRegion({ id: 2, ownerCountryId: "OTHER", resourceProduction: { oil: 1000 } });

    resourceTick(country, [ownedRegion, foreignRegion]);

    expect(foreignRegion.resourceProduction.oil).toBe(1000);
  });

  it("does nothing when the country owns no regions", () => {
    const country = createTestCountry();
    const oilBefore = country.stockpile.oil;

    expect(() => resourceTick(country, [])).not.toThrow();
    expect(country.stockpile.oil).toBe(oilBefore);
  });

  it("после оккупации региона (docs/plans/08_WAR_WAVE1.md, Шаг 1 — WarTick.ts выставляет occupiedBy, не ownerCountryId) начисляет добычу оккупанту, не легальному владельцу", () => {
    const owner = createTestCountry({ id: "OLD" });
    const occupant = createTestCountry({ id: "NEW" });
    const region = createTestRegion({
      id: 1, ownerCountryId: "OLD", occupiedBy: "NEW", infrastructure: 0, resourceProduction: { oil: 1000 },
    });

    const ownerOilBefore = owner.stockpile.oil;
    const occupantOilBefore = occupant.stockpile.oil;

    resourceTick(owner, [region]);
    resourceTick(occupant, [region]);

    expect(owner.stockpile.oil).toBe(ownerOilBefore);
    expect(occupant.stockpile.oil).toBeGreaterThan(occupantOilBefore);
  });

  it("оккупированный регион добывает со штрафом OCCUPATION_EXTRACTION_PENALTY относительно неоккупированного", () => {
    const freeCountry = createTestCountry({ id: "FREE" });
    const freeRegion = createTestRegion({ id: 1, ownerCountryId: "FREE", infrastructure: 0, resourceProduction: { oil: 1000 } });

    const occupant = createTestCountry({ id: "OCC" });
    const occupiedRegion = createTestRegion({
      id: 2, ownerCountryId: "OTHER", occupiedBy: "OCC", infrastructure: 0, resourceProduction: { oil: 1000 },
    });

    resourceTick(freeCountry, [freeRegion]);
    resourceTick(occupant, [occupiedRegion]);

    const freeGain = freeCountry.stockpile.oil - createTestCountry().stockpile.oil;
    const occupiedGain = occupant.stockpile.oil - createTestCountry().stockpile.oil;

    expect(occupiedGain).toBeCloseTo(freeGain * OCCUPATION_EXTRACTION_PENALTY, 5);
  });
});
