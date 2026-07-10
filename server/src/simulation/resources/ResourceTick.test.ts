import { describe, it, expect } from "vitest";
import { resourceTick } from "./ResourceTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";

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

  it("после флипа владения регионом (докс. план 01, баг протухающего regionIndex) начисляет ресурсы новому владельцу, а не старому", () => {
    const oldOwner = createTestCountry({ id: "OLD" });
    const newOwner = createTestCountry({ id: "NEW" });
    const region = createTestRegion({ id: 1, ownerCountryId: "OLD", infrastructure: 0, resourceProduction: { oil: 1000 } });

    // Эмулирует прямую мутацию владения, которую делает WarTick.ts (flip.region.ownerCountryId = ...),
    // без пересборки какого-либо индекса — regionIndex больше не существует, поэтому его протухание
    // физически невозможно.
    region.ownerCountryId = "NEW";

    const oldOwnerOilBefore = oldOwner.stockpile.oil;
    const newOwnerOilBefore = newOwner.stockpile.oil;

    resourceTick(oldOwner, [region]);
    resourceTick(newOwner, [region]);

    expect(oldOwner.stockpile.oil).toBe(oldOwnerOilBefore);
    expect(newOwner.stockpile.oil).toBeGreaterThan(newOwnerOilBefore);
  });
});
