import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameService } from "../../services/GameService";
import { loadGame } from "../SaveService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVES_DIR = path.resolve(__dirname, "..", "..", "..", "data", "saves");

const TEST_SLOTS = ["__test_restart"];

function cleanupTestSlots(): void {
  for (const slot of TEST_SLOTS) {
    const filePath = path.join(SAVES_DIR, `${slot}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const autosavePath = path.join(SAVES_DIR, "autosave.json");
  if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);
}

afterEach(cleanupTestSlots);

/**
 * Критерий приёмки плана 01 (docs/plans/01_PERSISTENCE_STATE.md): "Сохранение
 * → перезапуск сервера → загрузка → advanceMonth работает". Использует
 * настоящие createGame/simulateMonth/SaveService (не моки, в отличие от
 * services/__tests__/GameService.test.ts) — иначе тест ничего не доказывает
 * о реальном файловом round trip.
 */
describe("персистентность: сейв переживает рестарт сервера (docs/plans/01_PERSISTENCE_STATE.md)", () => {
  it("save → (эмуляция рестарта: новый GameStore) → load → advanceMonth работает", () => {
    const service = new GameService();
    const game = service.createGame("1946", "USA");
    game.llmRespondedThisTurn = true; // эмулируем, что LLM уже ответила в этом цикле

    service.saveGame("__test_restart");

    // Эмуляция рестарта процесса: синглтон GameStore теряет состояние в памяти,
    // на диске остаётся только файл сейва.
    service.deleteGame();
    expect(service.getCurrentGame()).toBeNull();

    const loaded = service.loadGame("__test_restart");
    expect(loaded.playerCountryId).toBe("USA");

    expect(() => service.advanceMonth()).not.toThrow();
    expect(service.getCurrentGame()!.currentDate).not.toBe(game.currentDate);
  });

  it("автосейв появляется после каждого хода (реальный файл на диске)", () => {
    const service = new GameService();
    const game = service.createGame("1946", "USA");
    game.llmRespondedThisTurn = true;

    service.advanceMonth();

    const autosaved = loadGame("autosave");
    expect(autosaved.currentDate).toBe(service.getCurrentGame()!.currentDate);
  });
});
