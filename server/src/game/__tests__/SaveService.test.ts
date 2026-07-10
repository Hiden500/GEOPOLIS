import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveGame, loadGame, listSaves, deleteSave } from "../SaveService";
import { SaveNotFoundError, SaveVersionError } from "../../errors/AppError";
import { createTestGameState } from "../../test-utils/fixtures";

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

  it("не сохраняет llmContext/pendingLlmActions, но сохраняет llmResponse", () => {
    const game = createTestGameState({
      llmContext: "секретный промт",
      pendingLlmActions: [{ type: "war", sourceCountryId: "USA" }],
      llmResponse: "последний ответ LLM",
    });

    saveGame(game, "__test_transient");
    const loaded = loadGame("__test_transient");

    expect(loaded.llmContext).toBeUndefined();
    expect(loaded.pendingLlmActions).toBeUndefined();
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

  it("отклоняет имя слота вне допустимого алфавита (защита от path traversal)", () => {
    const game = createTestGameState();
    expect(() => saveGame(game, "../evil")).toThrow();
    expect(() => saveGame(game, "a/b")).toThrow();
    expect(() => loadGame("../evil")).toThrow();
    expect(() => deleteSave("../evil")).toThrow();
  });
});
