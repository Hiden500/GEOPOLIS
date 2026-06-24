import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMService } from "../LLMService";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

function gameWithUsaUssr(overrides: Partial<GameState> = {}): GameState {
  return createTestGameState({
    playerCountryId: "USA",
    countries: [
      createTestCountry({ id: "USA", name: "USA" }),
      createTestCountry({ id: "USSR", name: "USSR" }),
    ],
    ...overrides,
  });
}

describe("LLMService", () => {
  describe("generatePrompt", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    it("включает дату, имя страны игрока и JSON-схему ответа", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain(game.currentDate);
      expect(prompt).toContain("USA");
      expect(prompt).toContain('"descriptions"');
      expect(prompt).toContain('"actions"');
      // перечень допустимых типов действий присутствует в инструкции
      expect(prompt).toContain("diplomacy|war|peace|annex|puppet|sanction|guarantee|influence");
    });

    it("детерминирован: два вызова дают одинаковый промт", () => {
      const a = service.generatePrompt();
      const b = service.generatePrompt();
      expect(a).toBe(b);
    });

    it("не мутирует порядок game.countries (регрессия на квирк .sort(), 2026-06-23)", () => {
      const g = createTestGameState({
        playerCountryId: "WEAK",
        countries: [
          createTestCountry({ id: "WEAK", name: "Weak", economy: { ...createTestCountry().economy, gdp: 1 } }),
          createTestCountry({ id: "STRONG", name: "Strong", economy: { ...createTestCountry().economy, gdp: 1_000 } }),
        ],
      });
      const svc = new LLMService(g);
      svc.generatePrompt();
      // generatePrompt сортирует копию, исходный порядок сохраняется
      expect(g.countries.map(c => c.id)).toEqual(["WEAK", "STRONG"]);
    });
  });

  describe("applyLlmActions", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    const usa = () => game.countries.find(c => c.id === "USA")!;
    const ussr = () => game.countries.find(c => c.id === "USSR")!;

    it("diplomacy: применяет relationChange из data симметрично (половина обратной стороне)", () => {
      service.applyLlmActions([
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 20 } },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBe(20);
      expect(ussr().diplomacy.relations["USA"]).toBe(10);
    });

    it("war: обрушивает отношения (delta -100, обратная сторона -50)", () => {
      service.applyLlmActions([{ type: "war", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.relations["USSR"]).toBe(-100);
      expect(ussr().diplomacy.relations["USA"]).toBe(-50);
    });

    it("peace: улучшает отношения (delta +50)", () => {
      service.applyLlmActions([{ type: "peace", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.relations["USSR"]).toBe(50);
      expect(ussr().diplomacy.relations["USA"]).toBe(25);
    });

    it("sanction: добавляет санкцию по умолчанию и ухудшает отношения на -25", () => {
      service.applyLlmActions([{ type: "sanction", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.sanctions["USSR"]).toEqual(["economic_sanctions"]);
      expect(usa().diplomacy.relations["USSR"]).toBe(-25);
    });

    it("sanction: использует sanctionType из data, если передан", () => {
      service.applyLlmActions([
        { type: "sanction", sourceCountryId: "USA", targetCountryId: "USSR", data: { sanctionType: "arms_embargo" } },
      ]);
      expect(usa().diplomacy.sanctions["USSR"]).toEqual(["arms_embargo"]);
    });

    it("guarantee: добавляет гарантию и улучшает отношения на +15", () => {
      service.applyLlmActions([{ type: "guarantee", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.guarantees).toContain("USSR");
      expect(usa().diplomacy.relations["USSR"]).toBe(15);
    });

    it("influence: применяет influenceChange по умолчанию (10)", () => {
      service.applyLlmActions([{ type: "influence", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.influence["USSR"]).toBe(10);
    });

    it("annex/puppet: не падает и не меняет отношения (пока не реализовано)", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      service.applyLlmActions([
        { type: "annex", sourceCountryId: "USA", targetCountryId: "USSR" },
        { type: "puppet", sourceCountryId: "USA", targetCountryId: "USSR" },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
      logSpy.mockRestore();
    });

    it("действие без targetCountryId — no-op (не падает, не меняет отношения)", () => {
      service.applyLlmActions([{ type: "diplomacy", sourceCountryId: "USA" }]);
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
    });

    it("применяет несколько действий подряд", () => {
      service.applyLlmActions([
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 10 } },
        { type: "influence", sourceCountryId: "USA", targetCountryId: "USSR", data: { influenceChange: 5 } },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBe(10);
      expect(usa().diplomacy.influence["USSR"]).toBe(5);
    });
  });

  describe("состояние LLM-цикла в gameState", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    it("savePrompt/saveResponse пишут в gameState", () => {
      service.savePrompt("PROMPT");
      service.saveResponse("RESPONSE");
      expect(game.llmContext).toBe("PROMPT");
      expect(game.llmResponse).toBe("RESPONSE");
    });

    it("incrementLlmTurn увеличивает счётчик с нуля", () => {
      service.incrementLlmTurn();
      service.incrementLlmTurn();
      expect(game.llmTurn).toBe(2);
    });

    it("save/get/clear pending actions", () => {
      const actions = [{ type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR" } as const];
      service.savePendingActions(actions);
      expect(service.getPendingActions()).toEqual(actions);
      service.clearPendingActions();
      expect(service.getPendingActions()).toEqual([]);
    });

    it("getPendingActions возвращает пустой массив, если ничего не сохранено", () => {
      expect(service.getPendingActions()).toEqual([]);
    });
  });
});
