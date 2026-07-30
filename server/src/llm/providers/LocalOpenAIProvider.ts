import { z } from "zod";
import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";
import { parseOpenAIUsage, type TokenUsage } from "../tokenTelemetry";
import { GeminiResponseSchema } from "../actionSchemas";

/**
 * Локальный LLM-рантайм по OpenAI-совместимому протоколу (LM Studio, llama.cpp
 * server, Ollama в OpenAI-режиме).
 *
 * ЧИСЛА, НА КОТОРЫХ СТОЯТ ЗДЕШНИЕ РЕШЕНИЯ, ИЗМЕРЕНЫ, А НЕ ВЫБРАНЫ:
 * `.agent/runs/local-llm-runtime-bench-2026-07-30.json` — прогон на реальном
 * промте хода (`createGame("1946")` → `generatePrompt()`) с проверкой той же
 * цепочкой, что в `LLMService.processResponse`.
 */

/** Дефолт совпадает с портом LM Studio по умолчанию. */
const DEFAULT_BASE_URL = "http://localhost:1234/v1";

/**
 * Замер: `max_tokens` 4096 при включённом reasoning дал 3/10 схема-валидных,
 * 8192 — 8/8. Провалы были НЕ качественные: размышление (~19 600 знаков)
 * съедало лимит целиком, и на сам JSON токенов не оставалось. Поэтому это
 * условие работоспособности, а не тюнинг под вкус.
 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Локальная модель не бывает единственной на машине, а имя ни на что не
 * влияет, если сервер держит одну загруженную: LM Studio отдаёт её на любой
 * `model`. Пустая строка ломала бы совместимость со строгими серверами.
 */
const DEFAULT_MODEL = "local-model";

/**
 * Таймаут одного хода. Замер: обычный ход 6 с, ход с reasoning — 60 с, а самый
 * медленный замеренный режим (MoE, не помещающаяся в VRAM) — 65,5 с. Пять
 * минут дают запас на холодную загрузку модели (5,3 с) и на промт, разросшийся
 * к поздней партии, но не оставляют ход висеть вечно при упавшем рантайме.
 */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Схема ответа в диалекте OpenAI: обычный JSON Schema без обогащений Gemini.
 *
 * `strict: true` в `json_schema` требует, чтобы у каждого объекта стояло
 * `additionalProperties: false`, а `required` перечислял ВСЕ свойства. Отсюда
 * рекурсивная доводка ниже: без неё строгий сервер отвергает саму схему, а не
 * ответ модели.
 */
function toOpenAISchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return tightenForStrict(jsonSchema) as Record<string, unknown>;
}

function tightenForStrict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tightenForStrict);
  if (typeof node !== "object" || node === null) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = tightenForStrict(value);
  }

  if (out.type === "object" && typeof out.properties === "object" && out.properties !== null) {
    out.additionalProperties = false;
    // ВСЕ свойства, а не только обязательные по Zod: в strict-режиме
    // необязательное поле выражается через `required` + тип с `null`, и
    // сервер отвергает схему, где `required` короче `properties`.
    out.required = Object.keys(out.properties as Record<string, unknown>);
  }
  return out;
}

/**
 * Автоматизированный провайдер к локальному рантайму.
 *
 * Отличия от `GeminiProvider`, каждое подтверждено замером:
 *
 * 1. Схема ответа передаётся ВСЕГДА. Без грамматики `json_schema` локальная
 *    модель дала 0/10 схема-валидных против 10/10 с ней; ломалось обёрткой
 *    ```` ```json ````, текстом вокруг JSON и недостающими полями конверта.
 *    Поэтому параметр не «необязательный», как у облачного провайдера, —
 *    отсутствие схемы означает схему мирового цикла, а не свободную генерацию.
 * 2. Ключ API не требуется: локальный сервер не аутентифицирует. Заголовок
 *    `Authorization` всё же отправляется, если задан `LOCAL_LLM_API_KEY`, —
 *    некоторые совместимые серверы (vLLM, LiteLLM) его требуют.
 */
export class LocalOpenAIProvider implements LLMProvider {
  constructor(private readonly onUsage?: (usage: TokenUsage) => void) {}

  async generateResponse(
    prompt: string,
    responseSchema: z.ZodType = GeminiResponseSchema
  ): Promise<string> {
    const baseUrl = (process.env.LOCAL_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = process.env.LOCAL_LLM_MODEL || DEFAULT_MODEL;
    const maxTokens = positiveIntFromEnv("LOCAL_LLM_MAX_TOKENS", DEFAULT_MAX_TOKENS);
    const timeoutMs = positiveIntFromEnv("LOCAL_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "geopolis_response", strict: true, schema: toOpenAISchema(responseSchema) },
      },
    };

    // Reasoning включён ПО УМОЛЧАНИЮ, и это не про качество прозы. Замер:
    // без размышления модель выдумала 7 несуществующих доменов технологий на
    // 10 ходов, с ним — ноль. Выдуманный идентификатор проходит схему (domain
    // в контракте — свободная строка) и отклоняется уже
    // `validateActionApplicability`, то есть цена «быстрого» режима — половина
    // отклонённых действий, а не пара секунд. Кому нужен быстрый ход:
    // LOCAL_LLM_REASONING=none (6 с против 60 с).
    const reasoning = process.env.LOCAL_LLM_REASONING;
    if (reasoning) body.reasoning_effort = reasoning;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.LOCAL_LLM_API_KEY) {
      headers.Authorization = `Bearer ${process.env.LOCAL_LLM_API_KEY}`;
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError(
        `Не удалось связаться с локальным LLM (${baseUrl}): ${reason}. ` +
          "Проверьте, что рантайм запущен и модель загружена, либо переключитесь " +
          "на облачный провайдер через LLM_PROVIDER=gemini."
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new LLMProviderError(
        `Локальный LLM вернул ${response.status}: ${text.slice(0, 500)}`
      );
    }

    const data = await response.json();

    // Расход снимается ДО проверки текста: оборванный по лимиту ответ токены
    // всё равно потратил — та же причина, что у облачного провайдера.
    if (this.onUsage) {
      const usage = parseOpenAIUsage(data);
      if (usage) this.onUsage(usage);
    }

    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      // Обрыв по лимиту генерации — самая частая поломка локального рантайма
      // (замер: 7 из 10 на max_tokens=4096 с reasoning), и по пустому телу её
      // не отличить от отказа сервера. Причина обрыва названа явно.
      const finish = choice?.finish_reason;
      const hint =
        finish === "length"
          ? ` Ответ оборван по лимиту генерации (max_tokens=${maxTokens}); ` +
            "при включённом размышлении лимит должен быть не ниже 8192."
          : "";
      throw new LLMProviderError(
        `Локальный LLM не вернул текст ответа (finish_reason=${String(finish)}).${hint}`
      );
    }

    return text;
  }
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  // Мусор в переменной не должен молча превращаться в 0 или NaN: ход тогда
  // падал бы обрывом генерации, а причина выглядела бы как дефект модели.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
