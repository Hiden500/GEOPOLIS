import { z } from "zod";
import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";
import { parseOpenAIUsage, type TokenUsage } from "../tokenTelemetry";
import { GeminiResponseSchema } from "../actionSchemas";
import { localBaseUrl, localHeaders, hasApiKey } from "./localEndpoint";
import { withJsonOnlyInstruction } from "../jsonOnlyInstruction";

/**
 * Локальный LLM-рантайм по OpenAI-совместимому протоколу (LM Studio, llama.cpp
 * server, Ollama в OpenAI-режиме).
 *
 * ЧИСЛА, НА КОТОРЫХ СТОЯТ ЗДЕШНИЕ РЕШЕНИЯ, ИЗМЕРЕНЫ, А НЕ ВЫБРАНЫ:
 * `.agent/runs/local-llm-runtime-bench-2026-07-30.json` — прогон на реальном
 * промте хода (`createGame("1946")` → `generatePrompt()`) с проверкой той же
 * цепочкой, что в `LLMService.processResponse`.
 */

/**
 * Адрес и заголовки — из `localEndpoint.ts`: те же три строки стояли ещё в
 * двух скриптах и разошлись с этим файлом (там `Authorization` не отправлялся).
 */

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
 * Способ, которым у рантайма просят структурный ответ.
 *
 * `prompt` — умолчание, и это ЗАМЕР, а не вкус
 * (`.agent/runs/gemini-prompt-modes-2026-08-01/`, 140 вызовов на реальном
 * промте хода через шлюз с ключом):
 *
 * - без инструкции о формате ответ приходил в markdown-заборе 60 раз из 60 —
 *   ОДИНАКОВО при `json_schema` со `strict: true`, при `strict: false`, при
 *   `json_object` и вообще без `response_format`. Строгая схема не отменила
 *   ни одного забора: шлюз её принимает, но грамматику не применяет;
 * - с инструкцией в конце промта — 0 заборов из 80. На базе против кандидата
 *   (по 30 вызовов) это 30/30 против 0/30, Fisher p = 1,5·10⁻¹⁴;
 * - выдуманных идентификаторов отказ от схемы не добавил: 2 прогона из 40 со
 *   схемой против 8 из 100 без неё, p = 0,72. Иначе и быть не могло —
 *   `research_shift.domain` в контракте свободная строка, схема его не
 *   ограничивает ничем.
 *
 * `json_schema` — возврат к прежнему поведению ОДНИМ переключателем: рантайм,
 * который грамматику действительно применяет (LM Studio, llama.cpp), от неё
 * выигрывает, и замер на шлюзе про такой рантайм не говорит ничего.
 */
type ResponseFormatMode = "prompt" | "json_schema" | "json_object";
const RESPONSE_FORMAT_MODES: ResponseFormatMode[] = ["prompt", "json_schema", "json_object"];
const DEFAULT_RESPONSE_FORMAT: ResponseFormatMode = "prompt";

function resolveResponseFormatMode(): ResponseFormatMode {
  const raw = process.env.LOCAL_LLM_RESPONSE_FORMAT?.trim().toLowerCase();
  if (!raw) return DEFAULT_RESPONSE_FORMAT;
  // Опечатка роняет запрос, а не откатывается молча на умолчание: тихий откат
  // увёл бы ходы в другой способ запроса формата незаметно для игрока — та же
  // причина, по которой не откатывается опечатка в LLM_PROVIDER.
  if (!RESPONSE_FORMAT_MODES.includes(raw as ResponseFormatMode)) {
    throw new LLMProviderError(
      `Неизвестный LOCAL_LLM_RESPONSE_FORMAT="${raw}". Допустимо: ${RESPONSE_FORMAT_MODES.join(", ")}.`
    );
  }
  return raw as ResponseFormatMode;
}

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
 * 1. Формат ответа держит ИНСТРУКЦИЯ В ПРОМТЕ, а не `response_format`
 *    (`resolveResponseFormatMode`, замер там же). На локальном рантайме без
 *    грамматики модель давала 0/10 схема-валидных против 10/10 с ней — но
 *    рантайм её применял; шлюз, отдающий облачную модель, схему принимает и
 *    игнорирует, и там работает только инструкция. Схема возвращается
 *    переменной `LOCAL_LLM_RESPONSE_FORMAT=json_schema`, поэтому `responseSchema`
 *    по-прежнему не «необязательный»: умолчание — схема мирового цикла.
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
    const baseUrl = localBaseUrl();
    const model = process.env.LOCAL_LLM_MODEL || DEFAULT_MODEL;
    const maxTokens = positiveIntFromEnv("LOCAL_LLM_MAX_TOKENS", DEFAULT_MAX_TOKENS);
    const timeoutMs = positiveIntFromEnv("LOCAL_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    const formatMode = resolveResponseFormatMode();

    const body: Record<string, unknown> = {
      model,
      // Инструкция «только JSON» дописывается в КОНЕЦ промта — там, где модель
      // читает её последней. `generatePrompt()` при этом не тронут: промт хода
      // и требование к формату ответа — разные вещи, и склеены они здесь.
      //
      // Режим `json_schema` инструкцию НЕ получает намеренно: он существует как
      // откат к прежнему поведению, а откат, который заодно меняет промт,
      // откатом не является — по нему не отличить регрессию формата от
      // регрессии промта.
      messages: [
        {
          role: "user",
          content: formatMode === "json_schema" ? prompt : withJsonOnlyInstruction(prompt),
        },
      ],
      max_tokens: maxTokens,
    };

    if (formatMode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "geopolis_response", strict: true, schema: toOpenAISchema(responseSchema) },
      };
    } else if (formatMode === "json_object") {
      body.response_format = { type: "json_object" };
    }

    // Reasoning включён ПО УМОЛЧАНИЮ, и это не про качество прозы. Замер:
    // без размышления модель выдумала 7 несуществующих доменов технологий на
    // 10 ходов, с ним — ноль. Выдуманный идентификатор проходит схему (domain
    // в контракте — свободная строка) и отклоняется уже
    // `validateActionApplicability`, то есть цена «быстрого» режима — половина
    // отклонённых действий, а не пара секунд. Кому нужен быстрый ход:
    // LOCAL_LLM_REASONING=none (6 с против 60 с).
    const reasoning = process.env.LOCAL_LLM_REASONING;
    if (reasoning) body.reasoning_effort = reasoning;

    // Температура НЕ задаётся по умолчанию: в игре разнообразие ходов — часть
    // продукта, и рантайм вправе применять собственный дефолт модели. Но у
    // замера «до/после» требование обратное: два прогона ОДНОГО промта обязаны
    // давать одно и то же, иначе разницу в числах нельзя отнести к правке
    // промта, а не к жребию сэмплирования. Отсюда переменная, а не константа:
    // `LOCAL_LLM_TEMPERATURE=0` включает воспроизводимый режим на время
    // измерений и не меняет живую игру.
    const temperature = finiteFloatFromEnv("LOCAL_LLM_TEMPERATURE");
    if (temperature !== undefined) body.temperature = temperature;

    const headers = localHeaders();

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
      // 401/403 отделены от прочих ошибок: у шлюза с ключом это САМАЯ частая
      // поломка, а по голому «вернул 401» её не отличить от отказа модели.
      const hint =
        response.status === 401 || response.status === 403
          ? hasApiKey()
            ? " Ключ задан, но отвергнут — проверьте LOCAL_LLM_API_KEY в server/.env."
            : " Ключ не задан — добавьте LOCAL_LLM_API_KEY в server/.env."
          : "";
      throw new LLMProviderError(
        `Локальный LLM вернул ${response.status}: ${text.slice(0, 500)}.${hint}`
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

/**
 * Дробное значение из переменной окружения, у которого НОЛЬ — законный вход.
 * Отдельная функция, а не флаг у `positiveIntFromEnv`: там ноль отбрасывается
 * намеренно (нулевой лимит токенов — поломка), здесь ноль и есть рабочий режим.
 * Мусор в переменной даёт `undefined` — параметр просто не отправляется, и
 * рантайм берёт свой дефолт, вместо того чтобы получить `NaN`.
 */
function finiteFloatFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  // Мусор в переменной не должен молча превращаться в 0 или NaN: ход тогда
  // падал бы обрывом генерации, а причина выглядела бы как дефект модели.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
