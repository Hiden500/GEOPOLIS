import { type GameState } from "@shared/types/GameState";

let currentGame: GameState | null = null;

export function getGame(): GameState | null {
  return currentGame;
}

export function setGame(game: GameState): void {
  currentGame = game;
}
