import { type GameState } from "@shared/types/GameState";

const API =
  "http://localhost:3000";

export async function getGameState()
: Promise<GameState> {

  const response =
    await fetch(
      `${API}/game/state`
    );

  return response.json();
}

export async function nextTurn()
: Promise<GameState> {

  const response =
    await fetch(
      `${API}/game/next-turn`,
      {
        method: "POST"
      }
    );

  return response.json();
}