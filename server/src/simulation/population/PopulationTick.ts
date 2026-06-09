import { type Country } from "@shared/types/Country";

export function populationTick(
  country: Country
): void {
  country.population += Math.floor(country.population * 0.01);
}