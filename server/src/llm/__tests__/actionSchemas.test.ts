import { describe, it, expect } from "vitest";
import { LLMActionSchema, LLMResponseEnvelopeSchema, GeminiResponseSchema } from "../actionSchemas";
import {
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RELATION_CHANGE,
  MAX_INFLUENCE_CHANGE,
  MAX_RESEARCH_SHARE,
  MAX_PRODUCTION_SHARE,
} from "@shared/defines/llmActionCaps";

describe("LLMActionSchema", () => {
  describe("общие правила (все 11 типов)", () => {
    it("отклоняет неизвестный type", () => {
      const result = LLMActionSchema.safeParse({ type: "nuke", sourceCountryId: "USA", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it("отклоняет отсутствующий sourceCountryId", () => {
      const result = LLMActionSchema.safeParse({ type: "peace", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it("отклоняет пустую строку sourceCountryId", () => {
      const result = LLMActionSchema.safeParse({ type: "peace", sourceCountryId: "", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it.each(["diplomacy", "war", "peace", "annex", "puppet", "sanction", "guarantee", "influence"] as const)(
      "%s: отклоняет sourceCountryId === targetCountryId",
      (type) => {
        const result = LLMActionSchema.safeParse({
          type,
          sourceCountryId: "USA",
          targetCountryId: "USA",
          ...(type === "diplomacy" ? { data: { relationChange: 5 } } : {}),
        });
        expect(result.success).toBe(false);
      }
    );

    it.each(["diplomacy", "war", "peace", "annex", "puppet", "sanction", "guarantee", "influence"] as const)(
      "%s: отклоняет отсутствующий targetCountryId",
      (type) => {
        const result = LLMActionSchema.safeParse({
          type,
          sourceCountryId: "USA",
          ...(type === "diplomacy" ? { data: { relationChange: 5 } } : {}),
        });
        expect(result.success).toBe(false);
      }
    );

    it("неизвестные поля внутри data (например lat/lng) молча отбрасываются, не роняют парсинг", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: 5, lat: 55.7, lng: 37.6 },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "diplomacy") {
        expect(result.data.data.relationChange).toBe(5);
        expect((result.data.data as any).lat).toBeUndefined();
      }
    });

    it("действие с типом, не объявляющим data (peace), игнорирует посторонний data-объект целиком", () => {
      const result = LLMActionSchema.safeParse({
        type: "peace",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { lat: 55.7, lng: 37.6 },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "peace") {
        expect((result.data as any).data).toBeUndefined();
      }
    });
  });

  describe("diplomacy", () => {
    it("принимает валидное действие", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: 10 },
      });
      expect(result.success).toBe(true);
    });

    it("data.relationChange обязателен", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: {},
      });
      expect(result.success).toBe(false);
    });

    it("принимает relationChange ровно на границе капа (включительно)", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: MAX_RELATION_CHANGE },
      });
      expect(result.success).toBe(true);
    });

    it("отклоняет relationChange за пределами капа", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: MAX_RELATION_CHANGE + 1 },
      });
      expect(result.success).toBe(false);
    });

    it("отклоняет отрицательный relationChange за пределами капа", () => {
      const result = LLMActionSchema.safeParse({
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: -MAX_RELATION_CHANGE - 1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("war", () => {
    it("принимает без data (warGoal опционален)", () => {
      const result = LLMActionSchema.safeParse({ type: "war", sourceCountryId: "USA", targetCountryId: "SUN" });
      expect(result.success).toBe(true);
    });

    it("принимает с warGoal свободным текстом", () => {
      const result = LLMActionSchema.safeParse({
        type: "war",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { warGoal: "border dispute" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("peace / annex / puppet / guarantee — без data", () => {
    it.each(["peace", "annex", "puppet", "guarantee"] as const)("%s: валиден с только source/target", (type) => {
      const result = LLMActionSchema.safeParse({ type, sourceCountryId: "USA", targetCountryId: "SUN" });
      expect(result.success).toBe(true);
    });
  });

  describe("sanction", () => {
    it("принимает без data (дефолт sanctionType — на стороне apply, не схемы)", () => {
      const result = LLMActionSchema.safeParse({ type: "sanction", sourceCountryId: "USA", targetCountryId: "SUN" });
      expect(result.success).toBe(true);
    });

    it.each(["trade_embargo", "economic_sanctions", "military_sanctions", "diplomatic_sanctions"] as const)(
      "принимает реальный SanctionType: %s",
      (sanctionType) => {
        const result = LLMActionSchema.safeParse({
          type: "sanction",
          sourceCountryId: "USA",
          targetCountryId: "SUN",
          data: { sanctionType },
        });
        expect(result.success).toBe(true);
      }
    );

    it("отклоняет несуществующий sanctionType", () => {
      const result = LLMActionSchema.safeParse({
        type: "sanction",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { sanctionType: "arms_embargo" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("influence", () => {
    it("принимает influenceChange ровно на границе капа", () => {
      const result = LLMActionSchema.safeParse({
        type: "influence",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { influenceChange: MAX_INFLUENCE_CHANGE },
      });
      expect(result.success).toBe(true);
    });

    it("отклоняет influenceChange за пределами капа", () => {
      const result = LLMActionSchema.safeParse({
        type: "influence",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { influenceChange: MAX_INFLUENCE_CHANGE + 1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("research_shift", () => {
    it("принимает валидное действие без targetCountryId", () => {
      const result = LLMActionSchema.safeParse({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.5 },
      });
      expect(result.success).toBe(true);
    });

    it("domain и share обязательны", () => {
      expect(
        LLMActionSchema.safeParse({ type: "research_shift", sourceCountryId: "USA", data: { domain: "armor" } })
          .success
      ).toBe(false);
      expect(
        LLMActionSchema.safeParse({ type: "research_shift", sourceCountryId: "USA", data: { share: 0.5 } }).success
      ).toBe(false);
    });

    it("принимает share ровно на статическом потолке (динамический потолок — вне схемы, applicability)", () => {
      const result = LLMActionSchema.safeParse({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: MAX_RESEARCH_SHARE },
      });
      expect(result.success).toBe(true);
    });

    it("отклоняет share за пределами статического потолка", () => {
      const result = LLMActionSchema.safeParse({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: MAX_RESEARCH_SHARE + 0.01 },
      });
      expect(result.success).toBe(false);
    });

    it("отклоняет отрицательный share", () => {
      const result = LLMActionSchema.safeParse({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: -0.1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("production_shift", () => {
    it.each(["rifles", "trucks", "tanks", "fighters", "bombers", "artillery", "destroyers", "submarines"] as const)(
      "принимает реальный EquipmentType: %s",
      (equipmentType) => {
        const result = LLMActionSchema.safeParse({
          type: "production_shift",
          sourceCountryId: "USA",
          data: { equipmentType, share: 0.3 },
        });
        expect(result.success).toBe(true);
      }
    );

    it("отклоняет несуществующую категорию техники", () => {
      const result = LLMActionSchema.safeParse({
        type: "production_shift",
        sourceCountryId: "USA",
        data: { equipmentType: "drones", share: 0.3 },
      });
      expect(result.success).toBe(false);
    });

    it("принимает share ровно на потолке, отклоняет за пределами", () => {
      expect(
        LLMActionSchema.safeParse({
          type: "production_shift",
          sourceCountryId: "USA",
          data: { equipmentType: "tanks", share: MAX_PRODUCTION_SHARE },
        }).success
      ).toBe(true);
      expect(
        LLMActionSchema.safeParse({
          type: "production_shift",
          sourceCountryId: "USA",
          data: { equipmentType: "tanks", share: MAX_PRODUCTION_SHARE + 0.01 },
        }).success
      ).toBe(false);
    });
  });

  describe("build_extraction", () => {
    it("принимает валидное действие без targetCountryId", () => {
      const result = LLMActionSchema.safeParse({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: 1 },
      });
      expect(result.success).toBe(true);
    });

    it("принимает delta: -1 (сворачивание)", () => {
      const result = LLMActionSchema.safeParse({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: -1 },
      });
      expect(result.success).toBe(true);
    });

    it.each([0, 2, -2, 0.5])("отклоняет delta вне {1,-1}: %s", (delta) => {
      const result = LLMActionSchema.safeParse({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta },
      });
      expect(result.success).toBe(false);
    });

    it("отклоняет несуществующий resource", () => {
      const result = LLMActionSchema.safeParse({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "plutonium", delta: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("regionId/resource/delta обязательны", () => {
      expect(
        LLMActionSchema.safeParse({ type: "build_extraction", sourceCountryId: "USA", data: { resource: "oil", delta: 1 } }).success
      ).toBe(false);
      expect(
        LLMActionSchema.safeParse({ type: "build_extraction", sourceCountryId: "USA", data: { regionId: 1, delta: 1 } }).success
      ).toBe(false);
      expect(
        LLMActionSchema.safeParse({ type: "build_extraction", sourceCountryId: "USA", data: { regionId: 1, resource: "oil" } }).success
      ).toBe(false);
    });
  });
});

describe("LLMResponseEnvelopeSchema", () => {
  it("принимает валидный конверт", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({
      title: "Headline",
      descriptions: "Something happened",
      actions: [],
    });
    expect(result.success).toBe(true);
  });

  it("title опционален (ручной clipboard-путь может его не давать)", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x", actions: [] });
    expect(result.success).toBe(true);
  });

  it("отклоняет отсутствующий descriptions", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({ actions: [] });
    expect(result.success).toBe(false);
  });

  it("отклоняет, если actions не массив", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x", actions: "not-an-array" });
    expect(result.success).toBe(false);
  });

  it("отклоняет отсутствующий actions", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x" });
    expect(result.success).toBe(false);
  });

  it(`отклоняет больше ${MAX_ACTIONS_PER_RESPONSE} действий`, () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_RESPONSE + 1 }, () => ({ type: "peace" }));
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x", actions });
    expect(result.success).toBe(false);
  });

  it(`принимает ровно ${MAX_ACTIONS_PER_RESPONSE} действий`, () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_RESPONSE }, () => ({ type: "peace" }));
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x", actions });
    expect(result.success).toBe(true);
  });

  it("actions на этом уровне не парсятся как LLMAction — произвольный элемент проходит (per-action схема применяется отдельно)", () => {
    const result = LLMResponseEnvelopeSchema.safeParse({ descriptions: "x", actions: [{ type: "nuke" }] });
    expect(result.success).toBe(true);
  });
});

describe("GeminiResponseSchema", () => {
  it("title required (в отличие от LLMResponseEnvelopeSchema)", () => {
    const result = GeminiResponseSchema.safeParse({ descriptions: "x", actions: [] });
    expect(result.success).toBe(false);
  });

  it("actions — полный LLMActionSchema, невалидный элемент роняет парсинг", () => {
    const result = GeminiResponseSchema.safeParse({
      title: "t",
      descriptions: "x",
      actions: [{ type: "nuke", sourceCountryId: "USA" }],
    });
    expect(result.success).toBe(false);
  });

  it("принимает валидный полный ответ", () => {
    const result = GeminiResponseSchema.safeParse({
      title: "t",
      descriptions: "x",
      actions: [{ type: "peace", sourceCountryId: "USA", targetCountryId: "SUN" }],
      // `primitives` обязателен в схеме ГЕНЕРАЦИИ (2026-07-26, сессия B): пустой
      // массив — законный ответ «в этом месяце режиссуре нечего применять», но
      // само поле модель обязана вернуть, иначе новый канал остаётся невидимым
      // для structured output. Валидация ВХОДЯЩЕГО ответа мягче
      // (LLMResponseEnvelopeSchema: `.optional()`), и это намеренно —
      // отсутствие поля не должно браковать весь ответ.
      primitives: [],
    });
    expect(result.success).toBe(true);
  });

  it("принимает примитив с качественными params и отвергает числовую величину", () => {
    const base = {
      title: "t",
      descriptions: "x",
      actions: [],
    };

    expect(
      GeminiResponseSchema.safeParse({
        ...base,
        primitives: [
          {
            verb: "repress",
            sourceCountryId: "SUN",
            target: { regionId: 187 },
            params: { intensity: "severe" },
          },
        ],
      }).success
    ).toBe(true);

    // «LLM не задаёт величины» (docs/PRIMITIVES.md §1) обязано держаться и в
    // схеме, которой направляется ГЕНЕРАЦИЯ, а не только во входной валидации.
    expect(
      GeminiResponseSchema.safeParse({
        ...base,
        primitives: [
          {
            verb: "repress",
            sourceCountryId: "SUN",
            target: { regionId: 187 },
            params: { intensity: "severe", magnitude: 0.8 },
          },
        ],
      }).success
    ).toBe(false);
  });
});
