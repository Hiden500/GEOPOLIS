import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

export function resourceTick(
  country: Country,
  regions: Region[]
): void {

  const ownedRegions =
    regions.filter(
      region =>
        region.ownerCountryId ===
        country.id
    );

  for (
    const region of ownedRegions
  ) {

    for (const [resource, amount] of Object.entries(region.resourceProduction)) {
      const key = resource as keyof typeof country.stockpile;
      country.stockpile[key] += amount;
    }
  }
}