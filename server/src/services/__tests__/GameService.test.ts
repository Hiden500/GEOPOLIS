import { describe, it, expect, beforeEach, vi } from "vitest";

// createGame (загрузка сценария), движок и SaveService (файловый I/O) тестируются
// отдельно — здесь мокаем их, чтобы проверять только логику GameService: работу
// с синглтоном GameStore и делегирование.
vi.mock("../../game/CreateGame", () => ({ createGame: vi.fn() }));
vi.mock("../../simulation/SimulationEngine", () => ({ simulateMonth: vi.fn() }));
vi.mock("../../game/SaveService", () => ({
  saveGame: vi.fn(),
  loadGame: vi.fn(),
  listSaves: vi.fn(),
  deleteSave: vi.fn(),
}));

import { GameService } from "../GameService";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";
import * as SaveService from "../../game/SaveService";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";

describe("GameService", () => {
  let service: GameService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GameService();
    // Сброс синглтона GameStore между тестами
    service.deleteGame();
  });

  describe("createGame", () => {
    it("делегирует в createGame со сценарием/страной и сохраняет результат в стор", () => {
      const fakeGame = createTestGameState();
      vi.mocked(createGame).mockReturnValue(fakeGame);

      const result = service.createGame("1946", "USA");

      expect(createGame).toHaveBeenCalledWith("1946", "USA", undefined);
      expect(result).toBe(fakeGame);
      expect(service.getCurrentGame()).toBe(fakeGame);
    });

    it("передаёт locale в createGame, если он указан (2026-07-05)", () => {
      const fakeGame = createTestGameState();
      vi.mocked(createGame).mockReturnValue(fakeGame);

      service.createGame("1946", "USA", "en");

      expect(createGame).toHaveBeenCalledWith("1946", "USA", "en");
    });
  });

  describe("advanceMonth", () => {
    it("бросает 'No active game', если игра не создана", () => {
      expect(() => service.advanceMonth()).toThrow("No active game");
      expect(simulateMonth).not.toHaveBeenCalled();
    });

    it("прогоняет движок на текущей игре и возвращает её", () => {
      const fakeGame = createTestGameState();
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      const result = service.advanceMonth();

      expect(simulateMonth).toHaveBeenCalledWith(fakeGame);
      expect(result).toBe(fakeGame);
      expect(service.getCurrentGame()).toBe(fakeGame);
    });

    it("гейт (2026-07-06): отказывает, если LLM ещё не ответила в этом цикле", () => {
      const fakeGame = createTestGameState({ llmRespondedThisTurn: false });
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      expect(() => service.advanceMonth()).toThrow(
        "Ход недоступен: сначала получите ответ LLM (ручной или автоматический цикл)."
      );
      expect(simulateMonth).not.toHaveBeenCalled();
    });

    it("гейт (2026-07-06): сбрасывает llmRespondedThisTurn после успешного хода", () => {
      const fakeGame = createTestGameState({ llmRespondedThisTurn: true });
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      service.advanceMonth();

      expect(fakeGame.llmRespondedThisTurn).toBe(false);
      expect(() => service.advanceMonth()).toThrow(
        "Ход недоступен: сначала получите ответ LLM (ручной или автоматический цикл)."
      );
    });

    it("переменная длина хода (2026-07-06): months=3 прогоняет simulateMonth трижды за один гейт-чек", () => {
      const fakeGame = createTestGameState({ llmRespondedThisTurn: true });
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      const result = service.advanceMonth(3);

      expect(simulateMonth).toHaveBeenCalledTimes(3);
      expect(result).toBe(fakeGame);
      expect(fakeGame.llmRespondedThisTurn).toBe(false);
    });

    it("формирует bounded детерминированный отчёт по изменившимся показателям игрока", () => {
      const country = createTestCountry({
        goals: [{ id: "goal-rank", kind: "reach_power_rank", targetRank: 1, completed: false }],
      });
      const fakeGame = createTestGameState({ countries: [country], llmRespondedThisTurn: true });
      vi.mocked(createGame).mockReturnValue(fakeGame);
      vi.mocked(simulateMonth).mockImplementation(game => {
        game.currentDate = "1946-02-01";
        game.playerStanding = { ...game.playerStanding, power: game.playerStanding.power + 10 };
        country.politics.stability -= 3;
        country.goals[0]!.completed = true;
      });
      service.createGame("1946", fakeGame.playerCountryId);

      service.advanceMonth();

      expect(fakeGame.lastTurnReport).toEqual({
        fromDate: "1946-01-01",
        toDate: "1946-02-01",
        months: 1,
        changes: [
          { metric: "power", before: 0, after: 10 },
          { metric: "stability", before: 70, after: 67 },
        ],
        completedGoalIds: ["goal-rank"],
      });
      expect(fakeGame.lastTurnReport!.changes).toHaveLength(2);
    });

    it("автосейв (docs/plans/01_PERSISTENCE_STATE.md): каждый успешный ход перезаписывает слот 'autosave'", () => {
      const fakeGame = createTestGameState({ llmRespondedThisTurn: true });
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      service.advanceMonth();

      expect(SaveService.saveGame).toHaveBeenCalledWith(fakeGame, "autosave");
    });
  });

  describe("saveGame/loadGame/listSaves/deleteSave (docs/plans/01_PERSISTENCE_STATE.md)", () => {
    it("saveGame делегирует в SaveService с текущей игрой", () => {
      const fakeGame = createTestGameState();
      vi.mocked(createGame).mockReturnValue(fakeGame);
      service.createGame("1946", "USA");

      service.saveGame("slot1");

      expect(SaveService.saveGame).toHaveBeenCalledWith(fakeGame, "slot1");
    });

    it("saveGame бросает 'No active game', если игра не создана", () => {
      expect(() => service.saveGame("slot1")).toThrow("No active game");
      expect(SaveService.saveGame).not.toHaveBeenCalled();
    });

    it("loadGame делегирует в SaveService и делает загруженную игру текущей", () => {
      const loadedGame = createTestGameState({ playerCountryId: "LOADED" });
      vi.mocked(SaveService.loadGame).mockReturnValue(loadedGame);

      const result = service.loadGame("slot1");

      expect(SaveService.loadGame).toHaveBeenCalledWith("slot1");
      expect(result).toBe(loadedGame);
      expect(service.getCurrentGame()).toBe(loadedGame);
    });

    it("listSaves делегирует в SaveService", () => {
      const saves = [{ slot: "slot1", savedAt: "x", playerCountryId: "USA", currentDate: "1946-01-01" }];
      vi.mocked(SaveService.listSaves).mockReturnValue(saves);

      expect(service.listSaves()).toBe(saves);
    });

    it("deleteSave делегирует в SaveService", () => {
      service.deleteSave("slot1");
      expect(SaveService.deleteSave).toHaveBeenCalledWith("slot1");
    });
  });

  describe("getCurrentGame", () => {
    it("возвращает null, когда активной игры нет", () => {
      expect(service.getCurrentGame()).toBeNull();
    });
  });

  describe("deleteGame", () => {
    it("очищает активную игру", () => {
      vi.mocked(createGame).mockReturnValue(createTestGameState());
      service.createGame("1946", "USA");
      expect(service.getCurrentGame()).not.toBeNull();

      service.deleteGame();
      expect(service.getCurrentGame()).toBeNull();
    });
  });
});
