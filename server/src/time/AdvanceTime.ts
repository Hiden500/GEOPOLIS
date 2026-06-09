import { type GameState } from "@shared/types/GameState";
import { TimeStep } from "./TimeStep";

export function advanceTime(
  game: GameState,
  step: TimeStep
): void {

  const date =
    new Date(game.currentDate);

  date.setMonth(
    date.getMonth() + step
  );

  game.currentDate =
    date.toISOString().slice(0, 10);
}