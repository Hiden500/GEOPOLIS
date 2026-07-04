import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMService } from "../LLMService";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

function gameWithUsaUssr(overrides: Partial<GameState> = {}): GameState {
  return createTestGameState({
    playerCountryId: "USA",
    countries: [
      createTestCountry({ id: "USA", name: "USA", tier: "major" }),
      createTestCountry({ id: "USSR", name: "USSR", tier: "major" }),
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

    it("сообщает LLM жёсткие пределы магнитуды (Hard limits)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("Hard limits");
      expect(prompt).toContain("±40");
      expect(prompt).toContain("±20");
    });

    it("Country IDs: даёт реальные id упомянутых стран, не только имена (регрессия 2026-07-04: SOV/ROM вместо SUN/ROU)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("## Country IDs");
      expect(prompt).toContain("- USA: USA");
      expect(prompt).toContain("- USSR: USSR");
      expect(prompt).toContain("Never invent, abbreviate, or guess an id from a");
    });

    it("Country IDs: включает союзников/соперников игрока и стороны напряжённостей, даже если tier не major", () => {
      const g = createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({ id: "USA", name: "USA" }),
          createTestCountry({
            id: "SUN",
            name: "Soviet Union",
            diplomacy: { ...createTestCountry().diplomacy, rivals: ["ROU"] },
          }),
          createTestCountry({ id: "ROU", name: "Romania" }),
        ],
      });
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("- ROU: Romania");
      expect(prompt).toContain("- SUN: Soviet Union");
    });

    it("Country IDs: не включает id, которых нет в game.countries (нет самоподтверждения выдумки)", () => {
      const g = createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({
            id: "USA",
            name: "USA",
            diplomacy: { ...createTestCountry().diplomacy, allies: ["ATLANTIS"] },
          }),
        ],
      });
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const idsSection = prompt.slice(prompt.indexOf("## Country IDs"), prompt.indexOf("## Instructions"));
      expect(idsSection).not.toContain("ATLANTIS");
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

  describe("Spotlight Countries (расширение круга стран, вопрос 11)", () => {
    function gameWithRoster(): GameState {
      return createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({ id: "USA", name: "USA", tier: "major" }),
          createTestCountry({ id: "BBB", name: "Bravo" }),
          createTestCountry({ id: "AAA", name: "Alpha" }),
          createTestCountry({ id: "DDD", name: "Delta" }),
          createTestCountry({ id: "CCC", name: "Charlie" }),
          createTestCountry({ id: "EEE", name: "Echo" }),
          createTestCountry({ id: "FFF", name: "Foxtrot" }),
        ],
      });
    }

    it("выбирает первые LLM_SPOTLIGHT_COUNT не-major стран по id, начиная с курсора 0", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Spotlight Countries"), prompt.indexOf("## Active Wars"));
      // Пул по id: AAA, BBB, CCC, DDD, EEE, FFF — первые 5 от курсора 0
      expect(section).toContain("Alpha");
      expect(section).toContain("Bravo");
      expect(section).toContain("Charlie");
      expect(section).toContain("Delta");
      expect(section).toContain("Echo");
      expect(section).not.toContain("Foxtrot");
    });

    it("generatePrompt не двигает курсор ротации (идемпотентно)", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      svc.generatePrompt();
      svc.generatePrompt();
      expect(g.llmSpotlightCursor ?? 0).toBe(0);
    });

    it("курсор двигается только после успешного processResponse, с оборачиванием пула", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const response = JSON.stringify({ descriptions: "x", actions: [] });

      svc.processResponse(response);
      // Пул из 6 стран, шаг 5 → курсор 5
      expect(g.llmSpotlightCursor).toBe(5);

      const promptAfter = svc.generatePrompt();
      const section = promptAfter.slice(
        promptAfter.indexOf("## Spotlight Countries"),
        promptAfter.indexOf("## Active Wars")
      );
      // От курсора 5 в пуле из 6 (AAA..FFF): FFF, затем оборот на AAA..DDD
      expect(section).toContain("Foxtrot");
      expect(section).toContain("Alpha");

      svc.processResponse(response);
      // (5 + 5) % 6 = 4
      expect(g.llmSpotlightCursor).toBe(4);
    });

    it("майоры никогда не попадают в пул ротации", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const majorsSection = prompt.slice(prompt.indexOf("## Major Powers"), prompt.indexOf("## Spotlight Countries"));
      expect(majorsSection).toContain("USA");
    });

    it("пустой пул (все страны major) не роняет промт", () => {
      const g = gameWithUsaUssr(); // и USA, и USSR — major
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("No spotlight countries this cycle");
    });

    it("страны в ротации попадают в ## Country IDs", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("- AAA: Alpha");
      expect(prompt).toContain("- EEE: Echo");
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

  describe("processResponse (полный проход LLM-цикла)", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    const usa = () => game.countries.find(c => c.id === "USA")!;

    const validResponse = JSON.stringify({
      descriptions: "США улучшают отношения с СССР.",
      actions: [
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 20 } },
      ],
    });

    it("валидный ответ: применяет действия, пишет response/turn/eventHistory", () => {
      const result = service.processResponse(validResponse);

      expect(result.success).toBe(true);
      expect(result.descriptions).toBe("США улучшают отношения с СССР.");
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(0);

      expect(usa().diplomacy.relations["USSR"]).toBe(20);
      expect(game.llmResponse).toBe(validResponse);
      expect(game.llmTurn).toBe(1);

      expect(game.eventHistory).toHaveLength(1);
      const event = game.eventHistory[0]!;
      expect(event.id).toBe("llm-turn-1");
      expect(event.date).toBe(game.currentDate);
      expect(event.description).toBe("США улучшают отношения с СССР.");
      expect(event.countries).toEqual(["USA", "USSR"]);
    });

    it("невалидный JSON: отказ целиком, ничего не применяется", () => {
      const result = service.processResponse("это не JSON");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid JSON format");
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
      expect(game.llmTurn).toBeUndefined();
      expect(game.eventHistory).toHaveLength(0);
    });

    it("невалидная структура (нет descriptions): отказ с причиной", () => {
      const result = service.processResponse(JSON.stringify({ actions: [] }));

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing descriptions field");
      expect(game.eventHistory).toHaveLength(0);
    });

    it("действие с несуществующей страной: отказ целиком (структурная валидация)", () => {
      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [{ type: "war", sourceCountryId: "MARS", targetCountryId: "USA" }],
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Source country not found");
    });

    it("действие с магнитудой за пределами отклоняется точечно с причиной", () => {
      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 500 } },
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 10 } },
        ],
      }));

      expect(result.success).toBe(true);
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(1);
      expect(result.rejectedActions[0]!.reason).toContain("relationChange out of range");
      expect(usa().diplomacy.relations["USSR"]).toBe(10);
    });

    it("неприменимое действие отклоняется точечно с причиной, остальные применяются", () => {
      // Повторная гарантия неприменима
      usa().diplomacy.guarantees.push("USSR");

      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [
          { type: "guarantee", sourceCountryId: "USA", targetCountryId: "USSR" },
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 5 } },
        ],
      }));

      expect(result.success).toBe(true);
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(1);
      expect(result.rejectedActions[0]!.reason).toBe("Guarantee already exists");
      expect(usa().diplomacy.relations["USSR"]).toBe(5);
    });

    it("счётчик хода и id события растут при повторных проходах", () => {
      service.processResponse(validResponse);
      service.processResponse(validResponse);

      expect(game.llmTurn).toBe(2);
      expect(game.eventHistory.map(e => e.id)).toEqual(["llm-turn-1", "llm-turn-2"]);
    });
  });
});
