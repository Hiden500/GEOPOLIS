import { type GameState } from "@shared/types/GameState";
import { type CountryAction } from "./CountryAction";
import { generateCountryActions } from "./GenerateCountryActions";

export function generateWorldActions(
  game: GameState
): CountryAction[] {

  const result: CountryAction[] = [];

  for (
    const country
    of game.countries
  ) {

    result.push(

      ...generateCountryActions(
        country
      )
    );
  }

  return result;
}