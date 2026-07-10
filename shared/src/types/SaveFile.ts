import { type GameState } from "./GameState";

/**
 * Версия формата сейва (docs/plans/01_PERSISTENCE_STATE.md). Несовпадение
 * при загрузке — честный отказ, без миграций (пока не понадобятся).
 */
export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  savedAt: string;
  game: GameState;
}
