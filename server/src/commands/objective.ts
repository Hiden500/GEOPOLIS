import { type GameState } from "@shared/types/GameState";
import { type StrategicGoal } from "@shared/types/GrandStrategy";
import { type CommandResult } from "./types";

/**
 * Устанавливает самопоставленные цели страны игрока (docs/OBJECTIVES.md).
 * Заменяет весь список целей. `completed` принадлежит движку — сбрасывается в
 * false при установке (ObjectiveTick оценит заново на следующем ходу). Не
 * трогает цели ИИ-стран (целевой слой — про игрока).
 */
export function setPlayerGoals(game: GameState, goals: StrategicGoal[]): CommandResult {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  if (!player) {
    return { success: false, error: `Player country not found: ${game.playerCountryId}` };
  }

  player.goals = goals.map(g => ({ ...g, completed: false }));
  return { success: true };
}
