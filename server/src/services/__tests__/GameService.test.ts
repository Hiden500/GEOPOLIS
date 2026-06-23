import { describe, it, expect, beforeEach, vi } from "vitest";

// createGame (загрузка сценария) и движок тестируются отдельно — здесь мокаем их,
// чтобы проверять только логику GameService: работу с синглтоном GameStore и делегирование.
vi.mock("../../game/CreateGame", () => ({ createGame: vi.fn() }));
vi.mock("../../simulation/SimulationEngine", () => ({ simulateMonth: vi.fn() }));

import { GameService } from "../GameService";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";
import { createTestGameState } from "../../test-utils/fixtures";

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

      expect(createGame).toHaveBeenCalledWith("1946", "USA");
      expect(result).toBe(fakeGame);
      expect(service.getCurrentGame()).toBe(fakeGame);
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
