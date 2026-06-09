import { type Country } from "@shared/types/Country";

export function militaryTick(
  country: Country
): void {

  for (
    const unit of
    country.military.units
  ) {

    if (
      unit.strength < 100
    ) {

      unit.strength += 1;
    }
  }
}