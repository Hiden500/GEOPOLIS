import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { type GameState } from "@shared/types/GameState";
import { SAVE_VERSION, type SaveFile } from "@shared/types/SaveFile";
import { SaveNotFoundError, SaveVersionError, SaveCorruptedError } from "../errors/AppError";
import { findStateViolations } from "../primitives/invariants";

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

  return validateLoadedGame(slot, file.game);
}

/**
 * Проверка СОДЕРЖИМОГО сейва, а не только номера версии (Милстоун 1).
 *
 * До этого совпадения версии было достаточно, а само состояние принималось
 * приведением типа. Порча вроде `primitiveTurnBudget.softUsed = -100` проходила
 * молча и снимала капы хода: счётчик, начинающийся с −100, разрешает сто
 * лишних примитивов в месяц — то есть чужой файл отключал защиту, ради которой
 * бюджет и переехал в состояние (docs/PRIMITIVES.md §4). Ломалось это поздно и
 * не там, где причина.
 *
 * Две проверки, разные по природе:
 *   1. **каркас** — обязательные поля состояния на месте и нужного рода
 *      (массив там, где массив; объект там, где объект). Ловит обрезанный или
 *      собранный руками файл. Намеренно НЕ полная схема мира: валидировать
 *      геометрию 1399 регионов на каждой загрузке дорого, а её порча ломает
 *      карту, а не защиты алфавита;
 *   2. **инварианты** — те же, что движок проверяет пост-фазой транзакции
 *      (`findStateViolations`). Одно определение на оба входа: «состояние,
 *      которое движок готов принять» обязано означать одно и то же на входе из
 *      файла и на выходе из применения ответа, иначе загрузка принимала бы то,
 *      что транзакция откатывает.
 */
export function validateLoadedGame(slot: string, game: GameState): GameState {
  const parsed = saveGameShapeSchema.safeParse(game);
  if (!parsed.success) {
    throw new SaveCorruptedError(
      `Save "${slot}" is malformed: ` +
        parsed.error.issues
          .slice(0, MAX_REPORTED_SAVE_ISSUES)
          .map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")
    );
  }

  const violations = findStateViolations(game);
  if (violations.length > 0) {
    throw new SaveCorruptedError(
      `Save "${slot}" violates engine invariants: ` +
        violations.slice(0, MAX_REPORTED_SAVE_ISSUES).join("; ")
    );
  }

  return game;
}

/**
 * Сколько нарушений называется в сообщении. Битый файл способен дать их
 * тысячами (по записи на регион), а сообщение читает человек.
 */
const MAX_REPORTED_SAVE_ISSUES = 5;

/**
 * Каркас состояния: обязательные поля и их род.
 *
 * `.passthrough()` внутри вложенных сущностей намеренно — см. `validateLoadedGame`
 * о границе. Здесь проверяется, что состояние вообще является состоянием, а не
 * что каждая страна корректна.
 */
const saveGameShapeSchema = z.object({
  currentDate: z.string().min(1),
  playerCountryId: z.string().min(1),
  countries: z.array(z.unknown()),
  regions: z.array(z.unknown()),
  eventHistory: z.array(z.unknown()),
  chronicle: z.array(z.unknown()),
  mapFeatures: z.array(z.unknown()),
  wars: z.array(z.unknown()),
  modifiers: z.array(z.unknown()),
  pendingWorldFacts: z.array(z.unknown()),
  ethnicGroups: z.array(z.unknown()),
  groupImpactMemory: z.array(z.unknown()),
  regionCrisisLatch: z.array(z.number()),
  primitiveBatchKeys: z.array(z.string()),
  primitiveNoopBatchKeys: z.array(z.string()),
  primitiveTurnBudget: z.object({}).loose(),
  // Состояние кампании — каркасом, не полной формой: содержательную проверку
  // (осколки существуют, дата на месте) делают инварианты, как и у остальных
  // полей. Здесь достаточно, чтобы `status` вообще был известным словом:
  // сейв без него сделал бы «партия окончена?» неотвечаемым вопросом.
  campaign: z.object({
    status: z.enum(["active", "succession_choice_pending", "defeated"]),
  }).loose(),
  hingePointShowCount: z.object({}).loose(),
  rngState: z.number(),
  nextFeatureId: z.number(),
}).loose();

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
