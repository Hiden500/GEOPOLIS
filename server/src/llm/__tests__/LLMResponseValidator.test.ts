import { describe, it, expect, beforeEach } from "vitest";
import { LLMResponseValidator } from "../LLMResponseValidator";
import { WarService } from "../../services/WarService";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

describe("LLMResponseValidator", () => {
  let game: GameState;
  let validator: LLMResponseValidator;

  beforeEach(() => {
    game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", name: "USA" }),
        createTestCountry({ id: "USSR", name: "USSR" }),
      ],
    });
    validator = new LLMResponseValidator(game);
  });

  describe("validateResponse", () => {
    it("принимает корректный ответ и возвращает parsedData", () => {
      const response = JSON.stringify({
        descriptions: "Some narrative",
        actions: [{ type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR" }],
      });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(true);
      expect(result.parsedData?.descriptions).toBe("Some narrative");
      expect(result.parsedData?.actions).toHaveLength(1);
    });

    it("принимает ответ с пустым массивом actions", () => {
      const response = JSON.stringify({ descriptions: "Quiet month", actions: [] });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(true);
      expect(result.parsedData?.actions).toEqual([]);
    });

    it("парсит title, если он есть (2026-07-05, для заголовков таймлайна)", () => {
      const response = JSON.stringify({
        title: "Kosovo Peace Talks Collapse",
        descriptions: "Some narrative",
        actions: [],
      });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(true);
      expect(result.parsedData?.title).toBe("Kosovo Peace Talks Collapse");
    });

    it("title необязателен — принимает ответ без него", () => {
      const response = JSON.stringify({ descriptions: "Some narrative", actions: [] });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(true);
      expect(result.parsedData?.title).toBeUndefined();
    });

    it("отклоняет невалидный JSON", () => {
      const result = validator.validateResponse("{ not json");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid JSON format");
    });

    it("отклоняет ответ без descriptions", () => {
      const response = JSON.stringify({ actions: [] });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing descriptions field");
    });

    it("отклоняет ответ, где actions не массив", () => {
      const response = JSON.stringify({ descriptions: "x", actions: "nope" });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing or invalid actions field");
    });

    it("отклоняет ответ, если хотя бы одно действие невалидно", () => {
      const response = JSON.stringify({
        descriptions: "x",
        actions: [
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR" },
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "ATLANTIS" },
        ],
      });
      const result = validator.validateResponse(response);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Target country not found: ATLANTIS");
    });
  });

  describe("validateAction", () => {
    it("отклоняет действие без type", () => {
      expect(validator.validateAction({ sourceCountryId: "USA" })).toEqual({
        valid: false,
        error: "Missing type field",
      });
    });

    it("отклоняет неизвестный type", () => {
      const result = validator.validateAction({ type: "nuke", sourceCountryId: "USA" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid type: nuke");
    });

    it("отклоняет действие без sourceCountryId", () => {
      const result = validator.validateAction({ type: "diplomacy" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing sourceCountryId field");
    });

    it("отклоняет выдуманную страну-источник", () => {
      const result = validator.validateAction({ type: "diplomacy", sourceCountryId: "ATLANTIS", targetCountryId: "USA" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Source country not found: ATLANTIS");
    });

    it("требует targetCountryId для парных действий", () => {
      const result = validator.validateAction({ type: "war", sourceCountryId: "USA" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing targetCountryId for action type: war");
    });

    it("отклоняет выдуманную целевую страну (ключевая защита от галлюцинаций LLM)", () => {
      const result = validator.validateAction({ type: "war", sourceCountryId: "USA", targetCountryId: "ATLANTIS" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Target country not found: ATLANTIS");
    });

    it("принимает корректное парное действие", () => {
      const result = validator.validateAction({ type: "sanction", sourceCountryId: "USA", targetCountryId: "USSR" });
      expect(result.valid).toBe(true);
    });

    it("research_shift: валиден без targetCountryId (2026-07-06, самодействие)", () => {
      const result = validator.validateAction({ type: "research_shift", sourceCountryId: "USA" });
      expect(result.valid).toBe(true);
    });
  });

  describe("validateActionApplicability", () => {
    it("отклоняет повторные санкции, если они уже наложены", () => {
      const usa = game.countries.find(c => c.id === "USA")!;
      usa.diplomacy.sanctions["USSR"] = ["economic_sanctions"];
      const result = validator.validateActionApplicability({
        type: "sanction",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Sanctions already exist");
    });

    it("отклоняет повторную гарантию", () => {
      const usa = game.countries.find(c => c.id === "USA")!;
      usa.diplomacy.guarantees.push("USSR");
      const result = validator.validateActionApplicability({
        type: "guarantee",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Guarantee already exists");
    });

    it("разрешает санкции, если их ещё нет", () => {
      const result = validator.validateActionApplicability({
        type: "sanction",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(true);
    });

    it("research_shift: разрешает известный домен страны (2026-07-06)", () => {
      game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 0 };
      const result = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.5 },
      });
      expect(result.valid).toBe(true);
    });

    it("research_shift: отклоняет несуществующий у страны домен", () => {
      game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 0 };
      const result = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "cyberwarfare", share: 0.5 },
      });
      expect(result.valid).toBe(false);
    });

    it("production_shift: разрешает реальную категорию EquipmentType (War Phase 2, 2026-07-06)", () => {
      const result = validator.validateActionApplicability({
        type: "production_shift",
        sourceCountryId: "USA",
        data: { equipmentType: "tanks", share: 0.5 },
      });
      expect(result.valid).toBe(true);
    });

    it("production_shift: отклоняет неизвестную категорию", () => {
      // "drones" — намеренно невалидное значение (за пределами EquipmentType),
      // проверяем рантайм-поведение на данных, которые не прошли бы Zod-схему
      // (actionSchemas.ts) — validateActionApplicability не полагается на TS-типы.
      const result = validator.validateActionApplicability({
        type: "production_shift",
        sourceCountryId: "USA",
        data: { equipmentType: "drones", share: 0.5 },
      } as any);
      expect(result.valid).toBe(false);
    });

    it("research_shift: отклоняет отсутствующий domain в data", () => {
      const result = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
      } as any);
      expect(result.valid).toBe(false);
    });

    it("war: разрешает объявление, если сторона ещё не воюет и не союзник (2026-07-06)", () => {
      const result = validator.validateActionApplicability({
        type: "war",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(true);
    });

    it("war: отклоняет, если уже идёт война между этими странами (2026-07-06)", () => {
      new WarService(game).declareWar("USA", "USSR");
      const result = validator.validateActionApplicability({
        type: "war",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Already at war with this country");
    });

    it("war: отклоняет объявление войны союзнику (2026-07-06)", () => {
      const usa = game.countries.find(c => c.id === "USA")!;
      usa.diplomacy.allies.push("USSR");
      const result = validator.validateActionApplicability({
        type: "war",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Cannot declare war on an ally");
    });

    it("peace: отклоняет, если между странами нет активной войны (2026-07-06)", () => {
      const result = validator.validateActionApplicability({
        type: "peace",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("No active war between these countries");
    });

    it("peace: разрешает, если между странами есть активная война (2026-07-06)", () => {
      new WarService(game).declareWar("USA", "USSR");
      const result = validator.validateActionApplicability({
        type: "peace",
        sourceCountryId: "USA",
        targetCountryId: "USSR",
      });
      expect(result.valid).toBe(true);
    });
  });

  // describe("filterValidActions") удалён здесь (2026-07-10, план 02_LLM_CONTRACT.md,
  // Шаг 0-1) — метод подтверждён мёртвым кодом (не вызывается в проде),
  // сцеплен с validateAction/validateActionMagnitude, которые уходят в Шаге 3
  // на server/src/llm/actionSchemas.ts. Удалять сам метод раньше срока не
  // стали (не расширять скоуп этого среза), но держать тесты на несуществующее
  // покрытие смысла нет — не переживают компиляцию нового строгого LLMAction.

  describe("валидация магнитуды и source==target", () => {
    it("отклоняет действие, где источник и цель совпадают", () => {
      const result = validator.validateAction({ type: "war", sourceCountryId: "USA", targetCountryId: "USA" });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Source and target country are the same");
    });

    it("принимает relationChange на границе ±40 и отклоняет за ней", () => {
      const at = validator.validateActionMagnitude({
        type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: -40 },
      });
      expect(at.valid).toBe(true);

      const over = validator.validateActionMagnitude({
        type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 41 },
      });
      expect(over.valid).toBe(false);
      expect(over.error).toContain("relationChange out of range");
    });

    it("отклоняет influenceChange за пределом ±20", () => {
      const result = validator.validateActionMagnitude({
        type: "influence", sourceCountryId: "USA", targetCountryId: "USSR", data: { influenceChange: -50 },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("influenceChange out of range");
    });

    it("research_shift: принимает share на границе 0.7 и отклоняет за ней (2026-07-06)", () => {
      const at = validator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.7 },
      });
      expect(at.valid).toBe(true);

      const over = validator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.71 },
      });
      expect(over.valid).toBe(false);
      expect(over.error).toContain("share out of range");
    });

    it("production_shift: принимает share на границе 0.7 и отклоняет за ней, БЕЗ снижения от войны (2026-07-06)", () => {
      new WarService(game).declareWar("USA", "USSR"); // в отличие от research_shift, война НЕ снижает потолок

      const at = validator.validateActionMagnitude({
        type: "production_shift", sourceCountryId: "USA", data: { equipmentType: "tanks", share: 0.7 },
      });
      expect(at.valid).toBe(true);

      const over = validator.validateActionMagnitude({
        type: "production_shift", sourceCountryId: "USA", data: { equipmentType: "tanks", share: 0.71 },
      });
      expect(over.valid).toBe(false);
      expect(over.error).toContain("share out of range");
    });

    it("research_shift: admin capacity — активная война снижает потолок share на 0.1 (2026-07-06)", () => {
      new WarService(game).declareWar("USA", "USSR");

      const atOldCeiling = validator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.7 },
      });
      expect(atOldCeiling.valid).toBe(false); // потолок теперь 0.6, не 0.7

      const atNewCeiling = validator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.6 },
      });
      expect(atNewCeiling.valid).toBe(true);

      // Страна вне войны (USSR тут — на другой стороне, но не воюет сама с собой) не задета.
      const other = createTestGameState({
        countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
      });
      const otherValidator = new LLMResponseValidator(other);
      const unaffected = otherValidator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USSR", data: { domain: "armor", share: 0.7 },
      });
      expect(unaffected.valid).toBe(true);
    });

    it("research_shift: admin capacity — потолок не падает ниже 0.3 при много войнах (2026-07-06)", () => {
      const many = createTestGameState({
        countries: [
          createTestCountry({ id: "USA" }),
          createTestCountry({ id: "R1" }),
          createTestCountry({ id: "R2" }),
          createTestCountry({ id: "R3" }),
          createTestCountry({ id: "R4" }),
          createTestCountry({ id: "R5" }),
        ],
      });
      const warService = new WarService(many);
      // 5 отдельных войн против USA — потолок 0.7 - 5*0.1 = 0.2, но пол 0.3.
      warService.declareWar("USA", "R1");
      warService.declareWar("USA", "R2");
      warService.declareWar("USA", "R3");
      warService.declareWar("USA", "R4");
      warService.declareWar("USA", "R5");

      const manyValidator = new LLMResponseValidator(many);
      const atFloor = manyValidator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.3 },
      });
      expect(atFloor.valid).toBe(true);

      const belowFloor = manyValidator.validateActionMagnitude({
        type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.31 },
      });
      expect(belowFloor.valid).toBe(false);
    });

    it("отклоняет нечисловые и NaN значения числовых полей", () => {
      const nan = validator.validateActionMagnitude({
        type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: NaN },
      });
      expect(nan.valid).toBe(false);

      const str = validator.validateActionMagnitude({
        type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR",
        data: { relationChange: "big" as unknown as number },
      });
      expect(str.valid).toBe(false);
    });

    it("действие без data проходит проверку магнитуды", () => {
      const result = validator.validateActionMagnitude({
        type: "peace", sourceCountryId: "USA", targetCountryId: "USSR",
      });
      expect(result.valid).toBe(true);
    });

    it("validateResponse отклоняет ответ с более чем 20 действиями", () => {
      const actions = Array.from({ length: 21 }, () => ({
        type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR",
      }));
      const result = validator.validateResponse(JSON.stringify({ descriptions: "x", actions }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Too many actions");
    });
  });
});
