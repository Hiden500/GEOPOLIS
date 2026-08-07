import { z } from "zod";
import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";
import { parseGeminiUsage, type TokenUsage } from "../tokenTelemetry";
import { ProviderResponseSchema } from "../responseSchemas";

/** Модель по умолчанию. Экспортируется, чтобы журнал расхода назывался тем же
 * именем, каким сделан вызов: расход несопоставим между моделями. */
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";

/**
 * Gemini structured output (generateContent, модели ниже "Interactions API" —
 * см. docs/DECISIONS.md 2026-07-06 про две версии Gemini API-документации)
 * принимает не полный JSON Schema, а OpenAPI 3.0-подобное подмножество.
 * Живой вызов (docs/plans/02_LLM_CONTRACT.md, Шаг 4) подтвердил конкретные
 * расхождения с тем, что производит `z.toJSONSchema()` — WebSearch про
 * поддержку `anyOf`/`$ref` относился к другому, более новому диалекту API,
 * не к этому REST-эндпоинту:
 *   - `const` (литерал Zod для discriminant `type`) — не поддерживается,
 *     Gemini вернул 400 "Unknown name const"; конвертируем в `enum: [value]`
 *     (единственное значение — тот же эффект).
 *   - `additionalProperties` — не поддерживается, 400 "Unknown name
 *     additionalProperties"; просто убираем (не ослабляет нашу собственную
 *     Zod-валидацию входящего ответа — этот ключ только направляет модель).
 *   - `oneOf`→`anyOf` и `propertyOrdering` (проприетарный, вне стандартного
 *     JSON Schema) — Gemini использует anyOf/propertyOrdering, не
 *     стандартные oneOf без ordering-подсказки; `z.toJSONSchema()` не
 *     производит ни то, ни другое сама.
 *   - Полный 10-ветвевой anyOf (после исправлений выше) всё ещё возвращал
 *     400 "Request contains an invalid argument" без детализации поля;
 *     бисекция живыми вызовами локализовала причину до веток с ИДЕНТИЧНОЙ
 *     формой, различающихся только значением discriminant `type`
 *     (тогда peace/annex/puppet/guarantee — все `{sourceCountryId,
 *     targetCountryId}`, без `data`; `annex`/`puppet` удалены из контракта
 *     2026-07-27, пара peace/guarantee осталась) — 2 структурно РАЗНЫЕ ветки (diplomacy+
 *     war) проходили, добавление ещё 3 структурно ОДИНАКОВЫХ веток
 *     ломало запрос. Похоже на ограничение grammar-компилятора
 *     constrained-decoding: неразличимые по форме anyOf-ветки не строятся.
 *     Фикс — mergeIdenticalShapeBranches ниже: ветки с одинаковой формой
 *     схлопываются в одну с `type: {enum: [...все их discriminant-значения]}`.
 *     Это ослабляет только СХЕМУ ДЛЯ ГЕНЕРАЦИИ (направляет модель) — реальная
 *     валидация входящего ответа (responseSchemas.ts::ProviderResponseSchema,
 *     processResponse) остаётся точной per-type и не меняется.
 * Единый источник схемы (responseSchemas.ts) остаётся тем не менее верным
 * решением — было безальтернативно хуже: до 2026-07-10 ручная схема вообще
 * не содержала research_shift/production_shift.
 */

/**
 * Схлопывает anyOf-ветки с идентичной формой (свойства/required, кроме
 * discriminant-поля `type`) в одну ветку с объединённым `type.enum`. Порядок
 * входных веток определяет порядок результата (первое вхождение формы).
 */
function mergeIdenticalShapeBranches(
  branches: Record<string, unknown>[],
  discriminant: string
): Record<string, unknown>[] {
  const groups: { shapeKey: string; branch: Record<string, unknown>; values: unknown[] }[] = [];

  for (const branch of branches) {
    const properties = { ...(branch.properties as Record<string, unknown>) };
    const discriminantSchema = properties[discriminant] as Record<string, unknown>;
    delete properties[discriminant];

    const shapeKey = JSON.stringify({
      properties,
      required: ((branch.required as string[]) || []).filter(f => f !== discriminant),
    });
    const discriminantValue = (discriminantSchema.enum as unknown[])[0];

    const existing = groups.find(g => g.shapeKey === shapeKey);
    if (existing) {
      existing.values.push(discriminantValue);
    } else {
      groups.push({ shapeKey, branch, values: [discriminantValue] });
    }
  }

  return groups.map(({ branch, values }) => ({
    ...branch,
    properties: {
      ...(branch.properties as Record<string, unknown>),
      [discriminant]: { type: "string", enum: values },
    },
  }));
}

/**
 * mergeIdenticalShapeBranches предполагает дискриминированный union объектов
 * (ветка = `{type:"object", properties:{verb:{...}, ...}}`) — паттерн
 * `primitiveSchema`. Не каждый anyOf/oneOf в схеме такой: union литералов
 * (`{const:1}`/`{const:-1}`, без `properties` вообще) даёт ветки, на которых
 * слепое применение схлопывания падает — `branch.properties` там undefined.
 * Схлопывание применимо только если ВСЕ ветки — объекты с дискриминантом в
 * properties.
 */
function isMergeableDiscriminatedBranch(
  branch: Record<string, unknown>,
  discriminant: string
): boolean {
  if (branch.type !== "object") return false;
  const properties = branch.properties;
  if (typeof properties !== "object" || properties === null) return false;
  const schema = (properties as Record<string, unknown>)[discriminant];
  return (
    typeof schema === "object" &&
    schema !== null &&
    Array.isArray((schema as Record<string, unknown>).enum) &&
    ((schema as Record<string, unknown>).enum as unknown[]).length === 1
  );
}

/**
 * Имя поля-дискриминанта, общего для всех веток, — вместо захардкоженного
 * `type` (обобщено Милстоуном 1).
 *
 * Стало нужно потому, что дискриминированный union появился второй: старый
 * канал различал ветки по `type`, а примитив — по `verb`. Пока имя было зашито
 * под `type`, схема примитивов не схлопывалась вовсе, и в неё уезжали
 * СТРУКТУРНО ОДИНАКОВЫЕ ветки (`repress` и `grant_autonomy` — одна и та же
 * форма цели и параметров), то есть ровно тот случай, на котором живой вызов
 * возвращал 400 (см. шапку модуля). Канала `type` больше нет, но обобщение
 * осталось верным: имя дискриминанта опознаётся по форме, а не по списку.
 *
 * Дискриминант опознаётся по форме, а не по имени: это поле, которое есть у
 * КАЖДОЙ ветки и в каждой описано как enum ровно из одного значения (`const`,
 * приведённый `enrichForGemini` к enum). Если таких полей несколько или ни
 * одного — схлопывание не применяется вовсе: угадывать, какое из них
 * дискриминант, значило бы менять смысл схемы наугад.
 */
function discriminantOf(branches: Record<string, unknown>[]): string | undefined {
  const first = branches[0];
  if (!first || typeof first.properties !== "object" || first.properties === null) return undefined;

  const candidates = Object.keys(first.properties as Record<string, unknown>).filter(key =>
    branches.every(branch => isMergeableDiscriminatedBranch(branch, key))
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Схлопывание ветвей с одинаковой формой, если у union есть однозначный
 * дискриминант; иначе ветки остаются как есть.
 */
function mergeBranches(branches: unknown[]): Record<string, unknown>[] {
  const enriched = branches.map(enrichForGemini) as Record<string, unknown>[];
  const discriminant = discriminantOf(enriched);
  return discriminant === undefined
    ? enriched
    : mergeIdenticalShapeBranches(enriched, discriminant);
}

function enrichForGemini(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;

  delete obj.additionalProperties;

  // "const" не поддерживается Gemini независимо от типа значения (строка —
  // подтверждено живым 400 "Unknown name const", docs/plans/02_LLM_CONTRACT.md;
  // число — та же категория ограничения диалекта, не проверялось отдельно
  // живьём, но нет оснований считать иначе).
  if ("const" in obj) {
    obj.enum = [obj.const];
    delete obj.const;
  }

  if (Array.isArray(obj.oneOf)) {
    obj.anyOf = mergeBranches(obj.oneOf);
    delete obj.oneOf;
  } else if (Array.isArray(obj.anyOf)) {
    obj.anyOf = mergeBranches(obj.anyOf);
  }

  if (obj.properties && typeof obj.properties === "object") {
    const properties = obj.properties as Record<string, unknown>;
    obj.propertyOrdering = Object.keys(properties);
    for (const key of Object.keys(properties)) {
      properties[key] = enrichForGemini(properties[key]);
    }
  }

  if (obj.items) {
    obj.items = enrichForGemini(obj.items);
  }

  return obj;
}

/**
 * Схема ответа под нашу структуру {title, descriptions, actions[]} —
 * проверена живым тестом 2026-07-05 (docs/DECISIONS.md): без нужной формы
 * AI Studio заворачивает ответ в generic {response: string} и ломает
 * экранирование переносов строк при двойном JSON.parse. Генерируется из
 * ProviderResponseSchema (responseSchemas.ts) — единый источник истины с
 * серверной валидацией входящего ответа, не второй ручной литерал
 * (docs/plans/02_LLM_CONTRACT.md, Шаг 4).
 */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema; // Gemini не ожидает этот ключ — исходная ручная схема его не содержала.
  return enrichForGemini(jsonSchema) as Record<string, unknown>;
}

/**
 * Экспортируется, потому что structured-output запрос у нас теперь не один:
 * перевод свободного приказа игрока в примитивы (docs/PRIMITIVES.md §1) требует
 * своей формы ответа и должен проходить ровно те же поправки диалекта, что
 * задокументированы выше. Второй ручной конвертер разъехался бы с этим при
 * первой же правке.
 */
const RESPONSE_SCHEMA = toProviderSchema(ProviderResponseSchema);

/**
 * Автоматизированный провайдер через Gemini API (generateContent).
 * Требует GEMINI_API_KEY в переменных окружения (server/.env, не в git).
 * Модель настраивается через GEMINI_MODEL, дефолт — уже проверенная
 * живым тестом gemini-3.1-flash-lite.
 */
export class GeminiProvider implements LLMProvider {
  /**
   * Наблюдатель расхода токенов. Провайдер сам никуда не пишет намеренно:
   * запись на диск — обязанность вызывающего слоя, иначе юнит-тесты
   * провайдера начали бы трогать файловую систему, а сбой записи мог бы
   * уронить игровой ход. Без наблюдателя поведение прежнее.
   */
  constructor(private readonly onUsage?: (usage: TokenUsage) => void) {}

  async generateResponse(
    prompt: string,
    schema: z.ZodType = ProviderResponseSchema
  ): Promise<string> {
    // Конвертация переехала сюда из вызывающего слоя вместе с появлением
    // второго провайдера: диалект — свойство API, а не запроса (см.
    // `LLMProvider`). Схема мирового цикла берётся из готовой константы, чтобы
    // самый частый вызов не пересобирал её на каждый ход.
    const responseSchema =
      schema === ProviderResponseSchema ? RESPONSE_SCHEMA : toProviderSchema(schema);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LLMProviderError(
        "GEMINI_API_KEY не задан — добавьте его в server/.env (см. server/.env.example)"
      );
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            // "high" — максимальная глубина рассуждения (docs/ai.google.dev/
            // gemini-api/docs/generate-content/thinking), ценой задержки —
            // приемлемо для помесячного, не real-time цикла.
            thinkingConfig: { thinkingLevel: "high" },
          },
        }),
      });
    } catch (error) {
      throw new LLMProviderError(
        `Не удалось связаться с Gemini API: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LLMProviderError(`Gemini API вернул ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = await response.json();

    // Расход снимается ДО проверки текста: вызов, заблокированный фильтром
    // безопасности, токены всё равно потратил, и в бюджет он входит.
    if (this.onUsage) {
      const usage = parseGeminiUsage(data);
      if (usage) this.onUsage(usage);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new LLMProviderError(
        `Gemini API не вернул текст ответа (возможно, заблокировано фильтром безопасности): ${JSON.stringify(data).slice(0, 500)}`
      );
    }

    return text;
  }
}
