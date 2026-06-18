import { type GameState } from "@shared/types/GameState";
import { simulateMonth } from "../simulation/SimulationEngine";
import { advanceTime } from "../time/AdvanceTime";

export function runTurn(
  game: GameState,
  months: number
): void {
  simulateMonth(game);
  advanceTime(game, months);
}
