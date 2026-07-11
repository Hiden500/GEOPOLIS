import { type GameState } from "./GameState";

/**
 * Версия формата сейва (docs/plans/01_PERSISTENCE_STATE.md). Несовпадение
 * при загрузке — честный отказ, без миграций (пока не понадобятся).
 *
 * v2 (2026-07-10, docs/plans/02_LLM_CONTRACT.md, Шаг 3): новое обязательное
 * поле GameState.chronicle — breaking change формата, старые сейвы (v1)
 * честно отклоняются, не молча ломаются.
 *
 * v3 (2026-07-11, docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2): новое
 * обязательное поле GameState.modifiers — та же логика честного отказа,
 * старые сейвы (v2) отклоняются.
 */
export const SAVE_VERSION = 3;

export interface SaveFile {
  version: number;
  savedAt: string;
  game: GameState;
}
