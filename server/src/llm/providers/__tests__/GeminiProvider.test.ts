import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GeminiProvider } from "../GeminiProvider";
import { LLMProviderError } from "../../../errors/AppError";

describe("GeminiProvider", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    process.env.GEMINI_MODEL = originalModel;
    vi.unstubAllGlobals();
  });

  it("бросает LLMProviderError, если GEMINI_API_KEY не задан", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(provider.generateResponse("prompt")).rejects.toThrow(LLMProviderError);
    await expect(provider.generateResponse("prompt")).rejects.toThrow("GEMINI_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("собирает запрос с моделью по умолчанию, responseSchema и промтом; возвращает текст ответа", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_MODEL;

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"title":"x","descriptions":"y","actions":[]}' }] } }],
      }),
    } as Response);

    const result = await provider.generateResponse("Simulate the world");

    expect(result).toBe('{"title":"x","descriptions":"y","actions":[]}');

    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("gemini-3.1-flash-lite");
    expect(url).toContain("key=test-key");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe("Simulate the world");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual([
      "title",
      "descriptions",
      "actions",
      "primitives",
    ]);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });

  it("использует GEMINI_MODEL из окружения, если задан", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "gemini-custom-model";

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    } as Response);

    await provider.generateResponse("prompt");

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("gemini-custom-model");
  });

  it("бросает LLMProviderError при не-200 ответе API", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    } as Response);

    await expect(provider.generateResponse("prompt")).rejects.toThrow(LLMProviderError);
    await expect(provider.generateResponse("prompt")).rejects.toThrow("429");
  });

  it("бросает LLMProviderError, если сеть недоступна", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    await expect(provider.generateResponse("prompt")).rejects.toThrow(LLMProviderError);
    await expect(provider.generateResponse("prompt")).rejects.toThrow("network down");
  });

  it("бросает LLMProviderError, если в ответе нет текста (например, заблокировано фильтром)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    } as Response);

    await expect(provider.generateResponse("prompt")).rejects.toThrow(LLMProviderError);
  });

  /**
   * Структура responseSchema — сгенерирована из GeminiResponseSchema
   * (actionSchemas.ts, docs/plans/02_LLM_CONTRACT.md, Шаг 4), не второй
   * ручной литерал. Проверяет ровно то, что раньше рассинхронизировалось
   * молча: полный список из 11 типов действия и их реальные data-поля.
   */
  describe("сгенерированная responseSchema (Zod → JSON Schema)", () => {
    async function captureResponseSchema(): Promise<any> {
      process.env.GEMINI_API_KEY = "test-key";
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
      } as Response);

      await provider.generateResponse("prompt");
      const [, options] = vi.mocked(fetch).mock.calls[0]!;
      const body = JSON.parse((options as RequestInit).body as string);
      return body.generationConfig.responseSchema;
    }

    it("не содержит служебный $schema (Gemini его не ожидает)", async () => {
      const schema = await captureResponseSchema();
      expect(schema.$schema).toBeUndefined();
    });

    it("propertyOrdering расставлен на корне и на каждой ветке actions", async () => {
      const schema = await captureResponseSchema();
      expect(schema.propertyOrdering).toEqual(["title", "descriptions", "actions", "primitives"]);

      const branches = schema.properties.actions.items.anyOf;
      for (const branch of branches) {
        expect(branch.propertyOrdering).toEqual(Object.keys(branch.properties));
      }
    });

    it("actions.items — anyOf (не oneOf, документированный ключ Gemini для union), все 11 типов присутствуют", async () => {
      const schema = await captureResponseSchema();
      const items = schema.properties.actions.items;

      expect(items.oneOf).toBeUndefined();
      expect(Array.isArray(items.anyOf)).toBe(true);

      // discriminant "type" литералы приходят как enum: [...] (не const, не
      // поддерживается этим REST-эндпоинтом Gemini — см. enrichForGemini).
      // Ветки с идентичной формой (peace/guarantee) схлопнуты
      // mergeIdenticalShapeBranches в одну — enum там содержит несколько
      // значений, не одно; flatMap разворачивает все девять обратно.
      const types = items.anyOf.flatMap((branch: any) => branch.properties.type.enum);
      expect(types.sort()).toEqual(
        [
          "build_extraction", "diplomacy", "guarantee", "influence", "peace",
          "production_shift", "research_shift", "sanction", "war",
        ].sort()
      );
    });

    it("ветки с идентичной формой (peace/guarantee) схлопнуты в одну — anyOf короче числа типов (подтверждённое живым вызовом ограничение Gemini)", async () => {
      const schema = await captureResponseSchema();
      const items = schema.properties.actions.items;
      expect(items.anyOf.length).toBeLessThan(9);

      const mergedBranch = items.anyOf.find((b: any) => b.properties.type.enum.length > 1);
      expect(mergedBranch.properties.type.enum.sort()).toEqual(["guarantee", "peace"].sort());
    });

    it("нет const/additionalProperties — Gemini их не поддерживает (подтверждено живым вызовом 2026-07-10)", async () => {
      const schema = await captureResponseSchema();
      const serialized = JSON.stringify(schema);
      expect(serialized).not.toContain('"const"');
      expect(serialized).not.toContain('"additionalProperties"');
    });

    it("research_shift/production_shift присутствуют с реальными data-полями (подтверждённый рассинхрон до 2026-07-10)", async () => {
      const schema = await captureResponseSchema();
      const branches = schema.properties.actions.items.anyOf;

      const researchShift = branches.find((b: any) => b.properties.type.enum[0] === "research_shift");
      expect(Object.keys(researchShift.properties.data.properties)).toEqual(["domain", "share"]);

      const productionShift = branches.find((b: any) => b.properties.type.enum[0] === "production_shift");
      expect(Object.keys(productionShift.properties.data.properties)).toEqual(["equipmentType", "share"]);
    });
  });

  /**
   * Живой вызов реального Gemini API — не часть обязательной верификации
   * (не гонять на каждый npm test, free-tier лимит дефицитен,
   * docs/DECISIONS.md 2026-07-05). Гейтится ДВУМЯ переменными: наличием
   * ключа И явным согласием прогнать live-тест. Прогнать вручную минимум
   * один раз перед тем, как считать Шаг 2/4 плана 02 закрытым:
   *   RUN_LIVE_LLM_TESTS=1 npx vitest run src/llm/providers
   */
  describe.skipIf(!process.env.RUN_LIVE_LLM_TESTS || !process.env.GEMINI_API_KEY)(
    "живой вызов Gemini API (RUN_LIVE_LLM_TESTS=1)",
    () => {
      it("реальный ответ проходит через LLMResponseEnvelopeSchema + LLMActionSchema", async () => {
        vi.unstubAllGlobals(); // здесь нужен настоящий fetch, не мок из beforeEach

        const { LLMResponseEnvelopeSchema, LLMActionSchema } = await import("../../actionSchemas");
        const realProvider = new GeminiProvider();

        const raw = await realProvider.generateResponse(
          "Return a minimal valid response: title, one-sentence descriptions, and an empty actions array."
        );
        const parsed = JSON.parse(raw);

        const envelope = LLMResponseEnvelopeSchema.safeParse(parsed);
        expect(envelope.success).toBe(true);
        if (envelope.success) {
          for (const action of envelope.data.actions) {
            expect(LLMActionSchema.safeParse(action).success).toBe(true);
          }
        }
      }, 30_000);
    }
  );
});
