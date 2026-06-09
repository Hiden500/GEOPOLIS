import { type GameState } from "@shared/types/GameState";
import { processEconomy } from "./ProcessEconomy";

export function processAllEconomies(
  game: GameState
): void {

  for (const country of game.countries) {
    processEconomy(country);
  }
}