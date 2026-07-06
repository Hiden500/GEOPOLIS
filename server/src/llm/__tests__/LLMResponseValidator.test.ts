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

  describe("filterValidActions", () => {
    it("оставляет только валидные и применимые действия", () => {
      const usa = game.countries.find(c => c.id === "USA")!;
      usa.diplomacy.guarantees.push("USSR"); // сделает guarantee неприменимым

      const actions = [
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR" } as const, // ок
        { type: "war", sourceCountryId: "USA", targetCountryId: "ATLANTIS" } as const, // невалидная цель
        { type: "guarantee", sourceCountryId: "USA", targetCountryId: "USSR" } as const, // неприменимо
      ];

      const result = validator.filterValidActions(actions);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe("diplomacy");
    });

    it("возвращает пустой массив, если все действия невалидны", () => {
      const actions = [
        { type: "war", sourceCountryId: "ATLANTIS", targetCountryId: "USA" } as const,
      ];
      expect(validator.filterValidActions(actions)).toEqual([]);
    });

    it("отбрасывает действия с магнитудой за пределами", () => {
      const actions = [
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 500 } },
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 10 } },
      ] as const;
      const result = validator.filterValidActions([...actions]);
      expect(result).toHaveLength(1);
      expect(result[0]?.data?.relationChange).toBe(10);
    });
  });

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
