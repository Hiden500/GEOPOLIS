import { describe, it, expect } from "vitest";
import { LLMActionSchema, LLMResponseEnvelopeSchema, GeminiResponseSchema } from "../actionSchemas";
import {
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RESEARCH_SHARE,
  MAX_PRODUCTION_SHARE,
} from "@shared/defines/llmActionCaps";

/**
 * Блоки `diplomacy`, `war`, `peace` и `sanction` УДАЛЕНЫ вместе со своими
 * типами (Милстоун 1, дипломатический блок алфавита). Покрытие не потеряно, а
 * переехало: те же четыре воздействия проверяются как примитивы в
 * `server/src/primitives/__tests__/diplomaticVerbs.test.ts` — и проверяются
 * строже, потому что там же проверяется главное, чего этот контракт не умел:
 * величину задаёт движок, а не модель.
 *
 * Капы `MAX_RELATION_CHANGE`/`MAX_INFLUENCE_CHANGE` удалены как понятие: они
 * ограничивали ЧИСЛО ОТ МОДЕЛИ, то есть узаконивали её право это число прислать.
 */
describe("LLMActionSchema", () => {
  describe("общие правила", () => {
    it("отклоняет неизвестный type", () => {
      const result = LLMActionSchema.safeParse({ type: "nuke", sourceCountryId: "USA", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it("отклоняет переведённые в алфавит типы: канал остался ровно один", () => {
      // Главная проверка удаления. Пока схема принимает `diplomacy`, модель
      // может обойти коридор магнитуды примитива одной строкой `actions` —
      // тогда перевод в алфавит не закрывает ничего.
      for (const type of ["diplomacy", "war", "peace", "sanction"] as const) {
        const result = LLMActionSchema.safeParse({
          type,
          sourceCountryId: "USA",
          targetCountryId: "SUN",
          data: { relationChange: 40 },
        });
        expect(result.success, `${type} обязан отклоняться старым каналом`).toBe(false);
      }
    });

    it("отклоняет отсутствующий sourceCountryId", () => {
      const result = LLMActionSchema.safeParse({ type: "guarantee", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it("отклоняет пустую строку sourceCountryId", () => {
      const result = LLMActionSchema.safeParse({ type: "guarantee", sourceCountryId: "", targetCountryId: "SUN" });
      expect(result.success).toBe(false);
    });

    it.each(["guarantee", "influence"] as const)(
      "%s: отклоняет sourceCountryId === targetCountryId",
      (type) => {
        const result = LLMActionSchema.safeParse({
          type,
          sourceCountryId: "USA",
          targetCountryId: "USA",
        });
        expect(result.success).toBe(false);
      }
    );

    it.each(["guarantee", "influence"] as const)(
      "%s: отклоняет отсутствующий targetCountryId",
      (type) => {
        const result = LLMActionSchema.safeParse({ type, sourceCountryId: "USA" });
        expect(result.success).toBe(false);
      }
    );

    it("неизвестные поля внутри data (например lat/lng) молча отбрасываются, не роняют парсинг", () => {
      const result = LLMActionSchema.safeParse({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.5, lat: 55.7, lng: 37.6 },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "research_shift") {
        expect(result.data.data.domain).toBe("armor");
        expect((result.data.data as any).lat).toBeUndefined();
      }
    });

    it("действие с типом, не объявляющим data (guarantee), игнорирует посторонний data-объект целиком", () => {
      const result = LLMActionSchema.safeParse({
        type: "guarantee",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { lat: 55.7, lng: 37.6 },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "guarantee") {
        expect((result.data as any).data).toBeUndefined();
      }
    });
  });

  describe("guarantee — без data", () => {
    it("валиден с только source/target", () => {
      const result = LLMActionSchema.safeParse({
        type: "guarantee",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("influence", () => {
    it("валиден без единого числового поля: величину задаёт движок", () => {
      const result = LLMActionSchema.safeParse({
        type: "influence",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
      });
      expect(result.success).toBe(true);
    });

    it("присланная моделью величина не попадает в разобранное действие", () => {
      // Поле снято из схемы — последнее место старого канала, где модель
      // задавала магнитуду дипломатического акта. Zod посторонний ключ молча
      // отбрасывает, и проверяется именно это: величина до движка не доезжает.
      const result = LLMActionSchema.safeParse({
        type: "influence",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { influenceChange: 999 },
      });
      expect(result.success).toBe(true);
      if (result.success) expect((result.data as any).data).toBeUndefined();
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
      actions: [{ type: "guarantee", sourceCountryId: "USA", targetCountryId: "SUN" }],
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
