import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import { LocalOpenAIProvider } from "../LocalOpenAIProvider";
import { LLMProviderError } from "../../../errors/AppError";
import {
  createLLMProvider,
  createProviderInstance,
  resolveProviderKind,
  DEFAULT_PROVIDER,
} from "../createProvider";
import { GeminiProvider } from "../GeminiProvider";
import { parseOpenAIUsage } from "../../tokenTelemetry";
import { JSON_ONLY_INSTRUCTION } from "../../jsonOnlyInstruction";

/** Успешный ответ рантайма в OpenAI-форме. */
function okResponse(content: string, usage?: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      ...(usage ? { usage } : {}),
    }),
  } as Response;
}

function bodyOf(): Record<string, any> {
  const call = vi.mocked(fetch).mock.calls[0];
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

const LOCAL_ENV = [
  "LOCAL_LLM_BASE_URL",
  "LOCAL_LLM_MODEL",
  "LOCAL_LLM_MAX_TOKENS",
  "LOCAL_LLM_REASONING",
  "LOCAL_LLM_RESPONSE_FORMAT",
  "LOCAL_LLM_API_KEY",
  "LOCAL_LLM_TIMEOUT_MS",
  "LLM_PROVIDER",
] as const;

describe("LocalOpenAIProvider", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of LOCAL_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    for (const key of LOCAL_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
    vi.unstubAllGlobals();
  });

  it("по умолчанию НЕ шлёт response_format, а требует JSON инструкцией в конце промта", async () => {
    // Замер (.agent/runs/gemini-prompt-modes-2026-08-01, 140 вызовов): без
    // инструкции ответ приходил в markdown-заборе 60 раз из 60 ОДИНАКОВО при
    // strict-схеме, при нестрогой, при json_object и вообще без
    // response_format; с инструкцией — 0 из 80. Шлюз схему принимает, но не
    // применяет, поэтому формат держит промт, а не параметр запроса.
    vi.mocked(fetch).mockResolvedValue(okResponse('{"title":"x"}'));
    await new LocalOpenAIProvider().generateResponse("prompt");

    const body = bodyOf();
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toContain(JSON_ONLY_INSTRUCTION);
  });

  it("ставит инструкцию именно в КОНЕЦ промта, не в начало и не вместо него", async () => {
    // Позиция — часть замеренного условия: инструкция работала последней
    // строкой промта. Тест на «инструкция где-то есть» пропустил бы перестановку.
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("ХОД ПАРТИИ");

    const content: string = bodyOf().messages[0].content;
    expect(content.startsWith("ХОД ПАРТИИ")).toBe(true);
    expect(content.trimEnd().endsWith(JSON_ONLY_INSTRUCTION)).toBe(true);
  });

  it("возвращает прежнее поведение по LOCAL_LLM_RESPONSE_FORMAT=json_schema", async () => {
    // Откат должен восстанавливать СТАРОЕ состояние целиком: схема на месте,
    // промт без добавки. Откат, меняющий заодно промт, не даёт отличить
    // регрессию формата от регрессии промта.
    process.env.LOCAL_LLM_RESPONSE_FORMAT = "json_schema";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    const body = bodyOf();
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toBeTruthy();
    expect(body.messages[0].content).toBe("prompt");
  });

  it("шлёт json_object и инструкцию по LOCAL_LLM_RESPONSE_FORMAT=json_object", async () => {
    process.env.LOCAL_LLM_RESPONSE_FORMAT = "json_object";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    const body = bodyOf();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain(JSON_ONLY_INSTRUCTION);
  });

  it("падает на опечатке в LOCAL_LLM_RESPONSE_FORMAT вместо тихого отката", async () => {
    // Тихий откат увёл бы ходы в другой способ запроса формата незаметно —
    // та же причина, что у опечатки в LLM_PROVIDER.
    process.env.LOCAL_LLM_RESPONSE_FORMAT = "json-schema";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));

    await expect(new LocalOpenAIProvider().generateResponse("prompt")).rejects.toThrow(
      /LOCAL_LLM_RESPONSE_FORMAT/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ужесточает схему под strict: additionalProperties=false и required по всем свойствам", async () => {
    // В strict-режиме сервер отвергает САМУ схему, если required короче
    // properties. Без этой доводки провайдер падал бы на любом необязательном
    // поле Zod, а причина выглядела бы как дефект модели.
    process.env.LOCAL_LLM_RESPONSE_FORMAT = "json_schema";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    const schema = z.object({ required: z.string(), optional: z.string().optional() });
    await new LocalOpenAIProvider().generateResponse("prompt", schema);

    const json = bodyOf().response_format.json_schema.schema;
    expect(json.additionalProperties).toBe(false);
    expect(new Set(json.required)).toEqual(new Set(["required", "optional"]));
    expect(json.$schema).toBeUndefined();
  });

  it("по умолчанию НЕ гасит reasoning и держит лимит генерации 8192", async () => {
    // Замер: reasoning убирает выдуманные идентификаторы (0 против 7), а
    // лимит 4096 при нём рвёт JSON (3/10 против 8/8).
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    const body = bodyOf();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });

  it("гасит reasoning и меняет лимит по переменным окружения", async () => {
    process.env.LOCAL_LLM_REASONING = "none";
    process.env.LOCAL_LLM_MAX_TOKENS = "4096";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    const body = bodyOf();
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_tokens).toBe(4096);
  });

  it("не принимает мусор в лимите генерации: откатывается на рабочий дефолт", async () => {
    // Иначе NaN/0 уходит на сервер, ход обрывается на середине JSON, и
    // причина выглядит как дефект модели.
    process.env.LOCAL_LLM_MAX_TOKENS = "не число";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    expect(bodyOf().max_tokens).toBe(8192);
  });

  it("шлёт запрос на адрес из окружения без задвоенного слэша", async () => {
    process.env.LOCAL_LLM_BASE_URL = "http://127.0.0.1:8080/v1/";
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://127.0.0.1:8080/v1/chat/completions");
  });

  it("не шлёт Authorization без ключа и шлёт с ключом", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse("{}"));
    await new LocalOpenAIProvider().generateResponse("prompt");
    const headersWithout = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headersWithout.Authorization).toBeUndefined();

    vi.mocked(fetch).mockClear();
    process.env.LOCAL_LLM_API_KEY = "secret";
    await new LocalOpenAIProvider().generateResponse("prompt");
    const headersWith = (vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headersWith.Authorization).toBe("Bearer secret");
  });

  it("сообщает про лимит генерации, когда ответ оборван по длине", async () => {
    // Самая частая поломка локального рантайма: по пустому телу её не отличить
    // от отказа сервера, поэтому причина названа явно.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
    } as Response);

    await expect(new LocalOpenAIProvider().generateResponse("prompt")).rejects.toThrow(
      /лимиту генерации/
    );
  });

  it("подсказывает переключение на облако, когда рантайм недоступен", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = new LocalOpenAIProvider();
    await expect(provider.generateResponse("prompt")).rejects.toThrow(LLMProviderError);
    await expect(provider.generateResponse("prompt")).rejects.toThrow(/LLM_PROVIDER=gemini/);
  });

  it("отдаёт расход наблюдателю до проверки текста ответа", async () => {
    // Оборванный ответ токены всё равно потратил — та же причина, что у
    // облачного провайдера.
    const seen: unknown[] = [];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" }, finish_reason: "length" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    } as Response);

    await expect(
      new LocalOpenAIProvider(usage => seen.push(usage)).generateResponse("prompt")
    ).rejects.toThrow(LLMProviderError);
    expect(seen).toHaveLength(1);
  });
});

describe("parseOpenAIUsage", () => {
  it("вычитает размышление из ответа, чтобы расход был сравним с облачным", () => {
    // У OpenAI reasoning ВНУТРИ completion_tokens, у Gemini — отдельной
    // статьёй сверх ответа. Без вычитания один и тот же ход считался бы
    // по-разному в зависимости от провайдера.
    const usage = parseOpenAIUsage({
      usage: {
        prompt_tokens: 5000,
        completion_tokens: 4900,
        total_tokens: 9900,
        completion_tokens_details: { reasoning_tokens: 4400 },
      },
    });
    expect(usage).toEqual({
      promptTokens: 5000,
      responseTokens: 500,
      totalTokens: 9900,
      thoughtTokens: 4400,
    });
  });

  it("не даёт отрицательного расхода, если размышление больше ответа", () => {
    const usage = parseOpenAIUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 100,
        total_tokens: 110,
        completion_tokens_details: { reasoning_tokens: 500 },
      },
    });
    expect(usage?.responseTokens).toBe(0);
  });

  it("возвращает undefined без блока usage", () => {
    expect(parseOpenAIUsage({ choices: [] })).toBeUndefined();
    expect(parseOpenAIUsage(null)).toBeUndefined();
  });
});

describe("createLLMProvider", () => {
  const saved = process.env.LLM_PROVIDER;
  const savedKey = process.env.GEMINI_API_KEY;
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    if (saved === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = saved;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
    vi.unstubAllGlobals();
  });

  it("по умолчанию поднимает локальный провайдер", () => {
    delete process.env.LLM_PROVIDER;
    expect(DEFAULT_PROVIDER).toBe("local");
    expect(createProviderInstance(resolveProviderKind())).toBeInstanceOf(LocalOpenAIProvider);
  });

  it("переключается на облачный по переменной окружения, регистр не важен", () => {
    process.env.LLM_PROVIDER = "Gemini";
    expect(createProviderInstance(resolveProviderKind())).toBeInstanceOf(GeminiProvider);
  });

  it("разрешает вид провайдера на вызове, а не на импорте модуля", async () => {
    // Роутеры создают провайдера один раз при старте. Если бы переменная
    // читалась там же, смена LLM_PROVIDER после импорта не действовала бы — и
    // тест, выставляющий её перед запросом, молча уходил бы к провайдеру,
    // выбранному до него.
    const provider = createLLMProvider();
    process.env.LLM_PROVIDER = "gemini";
    delete process.env.GEMINI_API_KEY;
    await expect(provider.generateResponse("prompt")).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("падает на опечатке вместо тихого отката к дефолту", () => {
    // Тихий откат увёл бы ходы в локальную модель при LLM_PROVIDER=gemeni, а
    // игрок увидел бы только странные ответы.
    process.env.LLM_PROVIDER = "gemeni";
    expect(() => resolveProviderKind()).toThrow(LLMProviderError);
    expect(() => resolveProviderKind()).toThrow(/gemeni/);
  });
});
