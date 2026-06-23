import { describe, it, expect, beforeEach, vi } from "vitest";

// Движок (simulateMonth) тестируется отдельно по тикам — здесь мокаем его,
// чтобы проверять только собственную логику SimulationService.
vi.mock("../../simulation/SimulationEngine", () => ({ simulateMonth: vi.fn() }));

import { SimulationService } from "../SimulationService";
import { simulateMonth } from "../../simulation/SimulationEngine";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

describe("SimulationService", () => {
  let service: SimulationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SimulationService();
  });

  describe("simulateMonth", () => {
    it("вызывает движок один раз с тем же game и возвращает его", () => {
      const game = createTestGameState();
      const result = service.simulateMonth(game);
      expect(simulateMonth).toHaveBeenCalledTimes(1);
      expect(simulateMonth).toHaveBeenCalledWith(game);
      expect(result).toBe(game);
    });
  });

  describe("simulateMonths", () => {
    it("вызывает движок ровно N раз", () => {
      const game = createTestGameState();
      service.simulateMonths(game, 3);
      expect(simulateMonth).toHaveBeenCalledTimes(3);
    });

    it("возвращает тот же объект game", () => {
      const game = createTestGameState();
      expect(service.simulateMonths(game, 2)).toBe(game);
    });

    it("при months = 0 не вызывает движок", () => {
      service.simulateMonths(createTestGameState(), 0);
      expect(simulateMonth).not.toHaveBeenCalled();
    });
  });

  describe("canSimulate", () => {
    it("true, когда есть страны и регионы", () => {
      const game = createTestGameState({
        countries: [createTestCountry()],
        regions: [createTestRegion()],
      });
      expect(service.canSimulate(game)).toBe(true);
    });

    it("false при пустом списке стран", () => {
      const game = createTestGameState({ countries: [], regions: [createTestRegion()] });
      expect(service.canSimulate(game)).toBe(false);
    });

    it("false при пустом списке регионов", () => {
      const game = createTestGameState({ countries: [createTestCountry()], regions: [] });
      expect(service.canSimulate(game)).toBe(false);
    });

    it("false для null (без падения)", () => {
      expect(service.canSimulate(null as unknown as GameState)).toBe(false);
    });
  });
});
