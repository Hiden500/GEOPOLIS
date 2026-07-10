import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type GameState } from "@shared/types/GameState";
import { SAVE_VERSION, type SaveFile } from "@shared/types/SaveFile";
import { SaveNotFoundError, SaveVersionError } from "../errors/AppError";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/game/SaveService.ts -> server/data/saves. Вычисляется от
// расположения модуля, не от process.cwd() — не зависит от того, откуда
// запущен процесс (dev-сервер vs vitest).
const SAVES_DIR = path.resolve(__dirname, "..", "..", "data", "saves");

/**
 * Слот идёт прямиком в имя файла на диске — ограничиваем алфавит, чтобы
 * исключить path traversal (например, слот "../../etc/passwd").
 */
export const SAVE_SLOT_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidSlot(slot: string): void {
  if (!SAVE_SLOT_PATTERN.test(slot)) {
    throw new Error(`Invalid save slot name: "${slot}"`);
  }
}

function saveFilePath(slot: string): string {
  return path.join(SAVES_DIR, `${slot}.json`);
}

/**
 * Снимает транзиентные поля, которые не должны переживать сейв
 * (docs/plans/01_PERSISTENCE_STATE.md): llmContext/pendingLlmActions — не
 * сохраняются; llmResponse (кэш последнего ответа LLM) — намеренно остаётся.
 */
function stripTransientFields(game: GameState): GameState {
  const { llmContext, pendingLlmActions, ...persisted } = game;
  return persisted;
}

export function saveGame(game: GameState, slot: string): void {
  assertValidSlot(slot);
  fs.mkdirSync(SAVES_DIR, { recursive: true });

  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    game: stripTransientFields(game),
  };

  fs.writeFileSync(saveFilePath(slot), JSON.stringify(file));
}

export function loadGame(slot: string): GameState {
  assertValidSlot(slot);
  const filePath = saveFilePath(slot);
  if (!fs.existsSync(filePath)) {
    throw new SaveNotFoundError(`Save slot not found: "${slot}"`);
  }

  const file = JSON.parse(fs.readFileSync(filePath, "utf-8")) as SaveFile;
  if (file.version !== SAVE_VERSION) {
    throw new SaveVersionError(
      `Save "${slot}" has incompatible version ${file.version} (engine expects ${SAVE_VERSION})`
    );
  }

  return file.game;
}

export interface SaveSlotMeta {
  slot: string;
  savedAt: string;
  playerCountryId: string;
  currentDate: string;
}

export function listSaves(): SaveSlotMeta[] {
  if (!fs.existsSync(SAVES_DIR)) return [];

  return fs
    .readdirSync(SAVES_DIR)
    .filter(name => name.endsWith(".json"))
    .map(fileName => {
      const slot = fileName.slice(0, -".json".length);
      const file = JSON.parse(
        fs.readFileSync(path.join(SAVES_DIR, fileName), "utf-8")
      ) as SaveFile;
      return {
        slot,
        savedAt: file.savedAt,
        playerCountryId: file.game.playerCountryId,
        currentDate: file.game.currentDate,
      };
    });
}

export function deleteSave(slot: string): void {
  assertValidSlot(slot);
  const filePath = saveFilePath(slot);
  if (!fs.existsSync(filePath)) {
    throw new SaveNotFoundError(`Save slot not found: "${slot}"`);
  }
  fs.unlinkSync(filePath);
}
