import { z } from "zod";
import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";
import { GeminiResponseSchema } from "../actionSchemas";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

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
 *     (peace/annex/puppet/guarantee — все `{sourceCountryId,
 *     targetCountryId}`, без `data`) — 2 структурно РАЗНЫЕ ветки (diplomacy+
 *     war) проходили, добавление ещё 3 структурно ОДИНАКОВЫХ веток
 *     ломало запрос. Похоже на ограничение grammar-компилятора
 *     constrained-decoding: неразличимые по форме anyOf-ветки не строятся.
 *     Фикс — mergeIdenticalShapeBranches ниже: ветки с одинаковой формой
 *     схлопываются в одну с `type: {enum: [...все их discriminant-значения]}`.
 *     Это ослабляет только СХЕМУ ДЛЯ ГЕНЕРАЦИИ (направляет модель) — реальная
 *     валидация входящего ответа (actionSchemas.ts::LLMActionSchema,
 *     processResponse) остаётся точной per-type и не меняется.
 * Единый источник схемы (actionSchemas.ts) остаётся тем не менее верным
 * решением — было безальтернативно хуже: до 2026-07-10 ручная схема вообще
 * не содержала research_shift/production_shift.
 */

/**
 * Схлопывает anyOf-ветки с идентичной формой (свойства/required, кроме
 * discriminant-поля `type`) в одну ветку с объединённым `type.enum`. Порядок
 * входных веток определяет порядок результата (первое вхождение формы).
 */
function mergeIdenticalShapeBranches(branches: Record<string, unknown>[]): Record<string, unknown>[] {
  const groups: { shapeKey: string; branch: Record<string, unknown>; values: unknown[] }[] = [];

  for (const branch of branches) {
    const properties = { ...(branch.properties as Record<string, unknown>) };
    const typeSchema = properties.type as Record<string, unknown>;
    delete properties.type;

    const shapeKey = JSON.stringify({
      properties,
      required: ((branch.required as string[]) || []).filter(f => f !== "type"),
    });
    const discriminantValue = (typeSchema.enum as unknown[])[0];

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
      type: { type: "string", enum: values },
    },
  }));
}

/**
 * mergeIdenticalShapeBranches предполагает дискриминированный union объектов
 * (ветка = `{type:"object", properties:{type:{...}, ...}}`) — паттерн
 * LLMActionSchema. Не каждый anyOf/oneOf в схеме такой: `delta:
 * z.union([z.literal(1), z.literal(-1)])` (build_extraction,
 * docs/plans/04_RESOURCES.md) даёт ветки-литералы (`{const:1}`/`{const:-1}`,
 * без `properties` вообще) — слепое применение схлопывания падает
 * (`branch.properties.type` — undefined). Схлопывание применимо только если
 * ВСЕ ветки — объекты с `type`-дискриминантом в properties.
 */
function isMergeableDiscriminatedBranch(branch: Record<string, unknown>): boolean {
  return (
    branch.type === "object" &&
    typeof branch.properties === "object" &&
    branch.properties !== null &&
    "type" in (branch.properties as Record<string, unknown>)
  );
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
    const enriched = obj.oneOf.map(enrichForGemini) as Record<string, unknown>[];
    obj.anyOf = enriched.every(isMergeableDiscriminatedBranch)
      ? mergeIdenticalShapeBranches(enriched)
      : enriched;
    delete obj.oneOf;
  } else if (Array.isArray(obj.anyOf)) {
    const enriched = obj.anyOf.map(enrichForGemini) as Record<string, unknown>[];
    obj.anyOf = enriched.every(isMergeableDiscriminatedBranch)
      ? mergeIdenticalShapeBranches(enriched)
      : enriched;
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
 * GeminiResponseSchema (actionSchemas.ts) — единый источник истины с
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
const RESPONSE_SCHEMA = toProviderSchema(GeminiResponseSchema);

/**
 * Автоматизированный провайдер через Gemini API (generateContent).
 * Требует GEMINI_API_KEY в переменных окружения (server/.env, не в git).
 * Модель настраивается через GEMINI_MODEL, дефолт — уже проверенная
 * живым тестом gemini-3.1-flash-lite.
 */
export class GeminiProvider implements LLMProvider {
  async generateResponse(
    prompt: string,
    responseSchema: Record<string, unknown> = RESPONSE_SCHEMA
  ): Promise<string> {
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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new LLMProviderError(
        `Gemini API не вернул текст ответа (возможно, заблокировано фильтром безопасности): ${JSON.stringify(data).slice(0, 500)}`
      );
    }

    return text;
  }
}
