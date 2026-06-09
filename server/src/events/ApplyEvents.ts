import { type GameState } from "@shared/types/GameState";
import { type SimulationEvent } from "../llm/SimulationResponse";

export function applyEvents(
  game: GameState,
  events: SimulationEvent[]
): void {

  for (const event of events) {

    game.eventHistory.push({

      id: crypto.randomUUID(),

      date: game.currentDate,

      title: event.title,

      description: event.description,

      countries: []
    });
  }
}