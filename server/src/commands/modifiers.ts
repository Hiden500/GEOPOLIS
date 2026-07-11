import { type GameState } from "@shared/types/GameState";
import { type Modifier } from "@shared/types/Modifier";
import { type CommandResult } from "./types";

/**
 * Создаёт модификатор — id генерируется тем же счётчиком, что Map Features
 * (game.nextFeatureId), другим префиксом ("mod-"), без нового поля state
 * (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2).
 */
export function applyModifier(game: GameState, params: Omit<Modifier, "id">): CommandResult {
  const id = `mod-${String(game.nextFeatureId).padStart(6, "0")}`;
  game.nextFeatureId += 1;

  game.modifiers.push({ id, ...params });
  return { success: true };
}

export function removeModifier(game: GameState, modifierId: string): CommandResult {
  const index = game.modifiers.findIndex(m => m.id === modifierId);
  if (index === -1) return { success: false, error: `Unknown modifier: ${modifierId}` };

  game.modifiers.splice(index, 1);
  return { success: true };
}

/**
 * Cleanup-фаза (вызывается из SimulationEngine.ts рядом с
 * MapFeatureService.removeExpiredFeatures) — сравнивает expiresAt с
 * game.currentDate (игровое время), осознанно НЕ wall-clock. Тот же паттерн
 * поля expiresAt, что у Map Features, обязан быть реализован правильно с
 * первого раза (docs/plans/01_PERSISTENCE_STATE.md фиксирует wall-clock
 * сравнение MapFeatureService как задокументированный, не повторяемый баг).
 */
export function removeExpiredModifiers(game: GameState): void {
  game.modifiers = game.modifiers.filter(m => !m.expiresAt || m.expiresAt > game.currentDate);
}
