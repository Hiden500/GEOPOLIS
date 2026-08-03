import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveGame, loadGame, listSaves, deleteSave } from "../SaveService";
import {
  SaveNotFoundError,
  SaveVersionError,
  SaveCorruptedError,
} from "../../errors/AppError";
import { createTestGameState } from "../../test-utils/fixtures";
import { SAVE_VERSION } from "@shared/types/SaveFile";
import { type GameState } from "@shared/types/GameState";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVES_DIR = path.resolve(__dirname, "..", "..", "..", "data", "saves");

// Слоты, используемые тестами этого файла — удаляются после каждого теста,
// чтобы не переживать между прогонами (server/data/saves/ гитигнорена, но
// файлы реально пишутся на диск).
const TEST_SLOTS = [
  "__test_roundtrip",
  "__test_transient",
  "__test_missing",
  "__test_version",
  "__test_prev_version",
  "__test_delete",
  "__test_list_a",
  "__test_list_b",
];

function cleanupTestSlots(): void {
  for (const slot of TEST_SLOTS) {
    const filePath = path.join(SAVES_DIR, `${slot}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

afterEach(cleanupTestSlots);

describe("SaveService", () => {
  it("сохраняет и загружает игру в указанный слот (round trip)", () => {
    const game = createTestGameState({ playerCountryId: "USA" });

    saveGame(game, "__test_roundtrip");
    const loaded = loadGame("__test_roundtrip");

    expect(loaded).toEqual(game);
  });

  it("не сохраняет llmContext, но сохраняет llmResponse", () => {
    // `pendingLlmActions` из проверки ушёл вместе с полем (2026-08-02):
    // мёртвая scaffolding-механика старого канала.
    const game = createTestGameState({
      llmContext: "секретный промт",
      llmResponse: "последний ответ LLM",
    });

    saveGame(game, "__test_transient");
    const loaded = loadGame("__test_transient");

    expect(loaded.llmContext).toBeUndefined();
    expect(loaded.llmResponse).toBe("последний ответ LLM");
  });

  it("loadGame бросает SaveNotFoundError для несуществующего слота", () => {
    expect(() => loadGame("__test_missing")).toThrow(SaveNotFoundError);
  });

  it("loadGame бросает SaveVersionError при несовпадении версии файла", () => {
    fs.mkdirSync(SAVES_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SAVES_DIR, "__test_version.json"),
      JSON.stringify({ version: 999, savedAt: "x", game: createTestGameState() })
    );

    expect(() => loadGame("__test_version")).toThrow(SaveVersionError);
  });

  it("сейв ПРЕДЫДУЩЕЙ версии отклоняется внятно, а не падает на недостающем поле", () => {
    // Именно этот случай встречает игрок после бампа формата: сейв прошлой
    // версии физически валиден, но в нём нет нового обязательного поля. Он
    // обязан быть отклонён ПО ВЕРСИИ, с обеими версиями в тексте, — иначе
    // загрузится состояние с отключённой защитой (docs/DECISIONS.md, 2026-07-26).
    const legacy = createTestGameState() as Partial<GameState>;
    delete legacy.primitiveTurnBudget;

    fs.mkdirSync(SAVES_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SAVES_DIR, "__test_prev_version.json"),
      JSON.stringify({ version: SAVE_VERSION - 1, savedAt: "x", game: legacy })
    );

    expect(() => loadGame("__test_prev_version")).toThrow(
      new RegExp(`incompatible version ${SAVE_VERSION - 1}.*expects ${SAVE_VERSION}`)
    );
  });

  it("deleteSave удаляет слот; бросает SaveNotFoundError на уже отсутствующий", () => {
    saveGame(createTestGameState(), "__test_delete");

    deleteSave("__test_delete");

    expect(() => loadGame("__test_delete")).toThrow(SaveNotFoundError);
    expect(() => deleteSave("__test_delete")).toThrow(SaveNotFoundError);
  });

  it("listSaves возвращает метаданные сохранённых слотов", () => {
    saveGame(createTestGameState({ playerCountryId: "USA", currentDate: "1946-03-01" }), "__test_list_a");
    saveGame(createTestGameState({ playerCountryId: "SUN", currentDate: "1946-05-01" }), "__test_list_b");

    const saves = listSaves();
    const a = saves.find(s => s.slot === "__test_list_a");
    const b = saves.find(s => s.slot === "__test_list_b");

    expect(a).toMatchObject({ playerCountryId: "USA", currentDate: "1946-03-01" });
    expect(b).toMatchObject({ playerCountryId: "SUN", currentDate: "1946-05-01" });
  });

  /**
   * Проверка СОДЕРЖИМОГО, а не только номера версии (Милстоун 1).
   *
   * До неё сейв своей версии принимался приведением типа, и порча, снимающая
   * защиту, проходила молча: счётчик бюджета хода, начинающийся с −100,
   * разрешает сотню лишних примитивов в месяц. Ломалось это поздно и не там,
   * где причина.
   */
  it("сейв СВОЕЙ версии с порченым бюджетом хода отклоняется при загрузке", () => {
    const game = createTestGameState();
    saveGame(game, "__test_corrupt_budget");

    const filePath = path.join(SAVES_DIR, "__test_corrupt_budget.json");
    const file = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    file.game.primitiveTurnBudget.softUsed = -100;
    fs.writeFileSync(filePath, JSON.stringify(file));

    expect(() => loadGame("__test_corrupt_budget")).toThrow(SaveCorruptedError);
    expect(() => loadGame("__test_corrupt_budget")).toThrow(/softUsed/);
  });

  it("сейв без обязательного массива состояния отклоняется внятно, а не падает позже", () => {
    const game = createTestGameState();
    saveGame(game, "__test_corrupt_shape");

    const filePath = path.join(SAVES_DIR, "__test_corrupt_shape.json");
    const file = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    delete file.game.groupImpactMemory;
    fs.writeFileSync(filePath, JSON.stringify(file));

    expect(() => loadGame("__test_corrupt_shape")).toThrow(SaveCorruptedError);
    expect(() => loadGame("__test_corrupt_shape")).toThrow(/groupImpactMemory/);
  });

  it("целый сейв текущей версии грузится — проверка не ложная по построению", () => {
    saveGame(createTestGameState({ currentDate: "1946-07-01" }), "__test_intact");
    expect(loadGame("__test_intact").currentDate).toBe("1946-07-01");
  });

  it("отклоняет имя слота вне допустимого алфавита (защита от path traversal)", () => {
    const game = createTestGameState();
    expect(() => saveGame(game, "../evil")).toThrow();
    expect(() => saveGame(game, "a/b")).toThrow();
    expect(() => loadGame("../evil")).toThrow();
    expect(() => deleteSave("../evil")).toThrow();
  });
});
