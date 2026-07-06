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
    expect(body.generationConfig.responseSchema.required).toEqual(["title", "descriptions", "actions"]);
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
});
