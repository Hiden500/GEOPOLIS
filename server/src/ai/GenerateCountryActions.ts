import { type Country } from "@shared/types/Country";
import { type CountryAction } from "./CountryAction";

export function generateCountryActions(
  country: Country
): CountryAction[] {

  const actions: CountryAction[] = [];

  if (
    country.goals.length > 0
  ) {

    const goal =
      country.goals[0];

    actions.push({

      countryId: country.id,

      category: "politics",

      description: `Стремиться к достижению цели: ${goal.title}`
    });
  }

  return actions;
}