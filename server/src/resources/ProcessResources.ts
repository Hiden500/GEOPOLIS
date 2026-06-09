import { type Country } from "@shared/types/Country";

export function processResources(
  country: Country
): void {

  country.stockpile.oil += 5;

  country.stockpile.coal += 10;

  country.stockpile.iron += 8;

  country.stockpile.food += 12;
}