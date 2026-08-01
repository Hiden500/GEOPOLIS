import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { localBaseUrl, localHeaders, hasApiKey, listLocalModels, DEFAULT_BASE_URL } from "../localEndpoint";

/**
 * Проверяется ровно тот класс дефекта, из-за которого модуль и появился:
 * заголовок `Authorization` собирался в трёх местах по отдельности, и в двух
 * из трёх его забыли. Забытый заголовок не роняет ни типы, ни тесты — он даёт
 * 401 от чужого сервера, и выглядит это как «неверный ключ», а не как «ключ не
 * отправлен».
 */

const KEYS = ["LOCAL_LLM_BASE_URL", "LOCAL_LLM_API_KEY"] as const;

describe("localEndpoint", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it("база по умолчанию — порт LM Studio", () => {
    expect(localBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it("срезает хвостовые слэши, чтобы не получалось //models", () => {
    process.env.LOCAL_LLM_BASE_URL = "http://localhost:8317/v1///";
    expect(localBaseUrl()).toBe("http://localhost:8317/v1");
  });

  it("без ключа Authorization не отправляется", () => {
    expect(localHeaders().Authorization).toBeUndefined();
    expect(hasApiKey()).toBe(false);
  });

  it("с ключом Authorization отправляется как Bearer", () => {
    process.env.LOCAL_LLM_API_KEY = "test-key";
    expect(localHeaders().Authorization).toBe("Bearer test-key");
    expect(hasApiKey()).toBe(true);
  });

  it("список моделей запрашивается С заголовками — иначе шлюз ответит 401", async () => {
    process.env.LOCAL_LLM_BASE_URL = "http://localhost:8317/v1";
    process.env.LOCAL_LLM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gemini-3.6-flash-high" }, { id: "other" }] }),
    } as Response)));

    const ids = await listLocalModels();

    expect(ids).toEqual(["gemini-3.6-flash-high", "other"]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://localhost:8317/v1/models");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("401 без ключа объясняет причину, а не только код", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"Missing API key"}',
    } as Response)));

    await expect(listLocalModels()).rejects.toThrow(/Ключ не задан/);
  });

  it("401 с заданным ключом говорит, что ключ отвергнут, а не отсутствует", async () => {
    process.env.LOCAL_LLM_API_KEY = "wrong";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "denied",
    } as Response)));

    await expect(listLocalModels()).rejects.toThrow(/отвергнут/);
  });

  it("пустой список не считается ошибкой: сервер жив, моделей нет", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response)));

    await expect(listLocalModels()).resolves.toEqual([]);
  });
});
