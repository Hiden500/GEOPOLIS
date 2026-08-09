import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GeminiProvider, DEFAULT_MODEL } from "../GeminiProvider";
import { PRIMITIVE_VERBS } from "../../../primitives/types";
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
    // Имя берётся из самой константы: тест охраняет «дефолт доезжает до URL»,
    // а не конкретную модель — иначе смена модели ломает его без причины.
    expect(url).toContain(DEFAULT_MODEL);
    expect(url).toContain("key=test-key");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toBe("Simulate the world");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual([
      "title",
      "descriptions",
      "primitives",
      "events",
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
   * Структура responseSchema — сгенерирована из `ProviderResponseSchema`
   * (responseSchemas.ts), не второй ручной литерал. Проверяет ровно то, что
   * раньше рассинхронизировалось молча: какие ветки схема реально предлагает
   * модели.
   *
   * С 2026-08-02 массива `actions` в схеме нет вовсе: канал перестал
   * существовать, и все проверки его веток заменены на проверку ОТСУТСТВИЯ —
   * это и есть наблюдаемое свойство «алфавит нельзя обойти сменой канала».
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

    it("propertyOrdering расставлен на корне и на каждой ветке примитивов", async () => {
      const schema = await captureResponseSchema();
      expect(schema.propertyOrdering).toEqual([
        "title",
        "descriptions",
        "primitives",
        "events",
      ]);

      const branches = schema.properties.primitives.items.anyOf;
      for (const branch of branches) {
        expect(branch.propertyOrdering).toEqual(Object.keys(branch.properties));
      }
    });

    it("схема НЕ предлагает канал `actions` — обойти алфавит сменой канала нечем", async () => {
      // Наблюдаемая формулировка сноса старого канала: раньше здесь
      // проверялся полный список его типов, теперь — что предлагать модели
      // нечего. Пока `actions` стоял в схеме генерации, инструкция промта
      // «величины задаёт движок» обходилась одной строкой ответа.
      const schema = await captureResponseSchema();
      expect(schema.properties.actions).toBeUndefined();
      expect(Object.keys(schema.properties).sort()).toEqual(
        ["descriptions", "events", "primitives", "title"]
      );
    });

    it("primitives.items — anyOf (не oneOf, документированный ключ Gemini для union)", async () => {
      const schema = await captureResponseSchema();
      const items = schema.properties.primitives.items;

      expect(items.oneOf).toBeUndefined();
      expect(Array.isArray(items.anyOf)).toBe(true);

      // Список выведен из САМОГО алфавита, а не переписан руками: добавление
      // глагола не должно требовать правки ожидания, иначе тест проверяет
      // память автора, а не контракт.
      const verbs = items.anyOf.flatMap((branch: any) => branch.properties.verb.enum);
      expect(verbs.sort()).toEqual([...PRIMITIVE_VERBS].sort());
    });

    it("ветки с идентичной формой схлопнуты в одну — anyOf короче числа глаголов (подтверждённое живым вызовом ограничение Gemini)", async () => {
      // ПРОВЕРКА ПЕРЕЕХАЛА со старого канала на примитивы (Милстоун 1, сессия
      // мягких глаголов), и это следствие, а не смена вкуса: пара одинаковых по
      // форме действий `guarantee`/`influence`, на которой она держалась,
      // распалась — `influence` удалён, и в старом канале двустороннее действие
      // осталось одно. Схлопывать там стало нечего, а само ограничение Gemini
      // никуда не делось.
      //
      // В алфавите примитивов пар с идентичной формой теперь несколько
      // (`send_aid`/`condemn`/`support_proxy` — цель-страна и один хинт), то
      // есть носитель проверки стал не слабее, а сильнее: схлопывание
      // проверяется там, где веток четырнадцать, а не четыре.
      const schema = await captureResponseSchema();
      const items = schema.properties.primitives.items;
      expect(items.anyOf.length).toBeLessThan(PRIMITIVE_VERBS.length);

      const mergedBranch = items.anyOf.find((b: any) => b.properties.verb.enum.length > 1);
      expect(mergedBranch.properties.verb.enum.length).toBeGreaterThan(1);
      // Схлопнуты именно глаголы АЛФАВИТА, а не произвольные строки.
      for (const verb of mergedBranch.properties.verb.enum) {
        expect(PRIMITIVE_VERBS).toContain(verb);
      }
    });

    it("нет const/additionalProperties — Gemini их не поддерживает (подтверждено живым вызовом 2026-07-10)", async () => {
      const schema = await captureResponseSchema();
      const serialized = JSON.stringify(schema);
      expect(serialized).not.toContain('"const"');
      expect(serialized).not.toContain('"additionalProperties"');
    });

    it("в схеме нет НИ ОДНОГО ключа вне диалекта Gemini", async () => {
      // Проверка-обобщение, заведённая после 2026-08-09: путь на Gemini был
      // сломан целиком — каждый вызов возвращал 400 "Unknown name
      // \"exclusiveMinimum\"", потому что Zod 4 выражает `.positive()` строгой
      // границей. Точечные проверки этого не ловили: они называют ключи,
      // которые уже подводили, и молчат про следующий.
      //
      // Список — поля `Schema` из документации API плюс те, что живой вызов
      // принял на нашей схеме (`minimum`/`maximum`/`minLength`/`maxLength`/
      // `maxItems`: тот же 400 перечислил ВСЕ неизвестные поля и ни одного из
      // них не назвал). Появился новый ключ — сначала подтверди его живым
      // вызовом, потом добавляй сюда.
      const ALLOWED = new Set([
        "type", "format", "description", "title", "default", "nullable", "enum",
        "items", "minItems", "maxItems", "properties", "required", "propertyOrdering",
        "minimum", "maximum", "minLength", "maxLength", "pattern", "anyOf",
      ]);

      const found = new Set<string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return void node.forEach(walk);
        if (node === null || typeof node !== "object") return;
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          // Внутри `properties` ключи — ИМЕНА ПОЛЕЙ нашего ответа, а не ключи
          // диалекта; проверять их по списку было бы бессмысленно.
          if (key === "properties") {
            Object.values(value as Record<string, unknown>).forEach(walk);
            continue;
          }
          found.add(key);
          walk(value);
        }
      };
      walk(await captureResponseSchema());

      expect([...found].filter(key => !ALLOWED.has(key)).sort()).toEqual([]);
    });

    it("строгая граница целого переведена во включающую, а не потеряна", async () => {
      // `regionId: z.number().int().positive()` — «> 0». Диалект понимает
      // только `minimum`, и «>= 1» это ровно то же множество: перевод обязан
      // сохранять границу, а не просто снимать неудобный ключ.
      const schema = await captureResponseSchema();
      const withRegion = schema.properties.primitives.items.anyOf
        .map((branch: any) => branch.properties.target?.properties?.regionId)
        .filter((node: any) => node !== undefined);

      expect(withRegion.length).toBeGreaterThan(0);
      for (const node of withRegion) {
        expect(node.exclusiveMinimum).toBeUndefined();
        expect(node.minimum).toBe(1);
      }
    });

    it("сдвиги фокуса пришли в схему КАЧЕСТВЕННЫМИ параметрами, без доли бюджета", async () => {
      // Наследник проверки «research_shift/production_shift с реальными
      // data-полями» (2026-07-10). Проверяемое свойство изменилось вместе с
      // контрактом и стало сильнее: раньше сверялось, что схема предлагает
      // модели поле `share`, теперь — что НЕ предлагает. Числовое поле в
      // структурированном ответе означало бы, что величину задаёт модель.
      const schema = await captureResponseSchema();
      const branches = schema.properties.primitives.items.anyOf;

      const research = branches.find((b: any) =>
        b.properties.verb.enum.includes("research_shift")
      );
      const params = research.properties.params.properties;
      expect(Object.keys(params).sort()).toEqual(["direction", "domain", "intensity"]);
      expect(JSON.stringify(params)).not.toContain("share");
      expect(params.direction.enum).toEqual(["toward", "away"]);
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
      it("реальный ответ проходит через LLMResponseEnvelopeSchema + parsePrimitives", async () => {
        vi.unstubAllGlobals(); // здесь нужен настоящий fetch, не мок из beforeEach

        const { LLMResponseEnvelopeSchema } = await import("../../responseSchemas");
        const { parsePrimitives } = await import("../../../primitives/primitiveSchemas");
        const realProvider = new GeminiProvider();

        const raw = await realProvider.generateResponse(
          "Return a minimal valid response: title, one-sentence descriptions, and an empty primitives array."
        );
        const parsed = JSON.parse(raw);

        const envelope = LLMResponseEnvelopeSchema.safeParse(parsed);
        expect(envelope.success).toBe(true);
        if (envelope.success) {
          expect(parsePrimitives(envelope.data.primitives ?? []).invalid).toEqual([]);
        }
      }, 30_000);
    }
  );
});
