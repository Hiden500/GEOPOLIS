import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

/**
 * Схема ответа под нашу структуру {title, descriptions, actions[]} —
 * проверена живым тестом 2026-07-05 (docs/DECISIONS.md): без неё AI Studio
 * заворачивает ответ в generic {response: string} и ломает экранирование
 * переносов строк при двойном JSON.parse. `data` — явные поля, а не
 * открытый объект (те же, что реально читает LLMResponseValidator).
 */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    descriptions: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["diplomacy", "war", "peace", "annex", "puppet", "sanction", "guarantee", "influence"],
          },
          sourceCountryId: { type: "string" },
          targetCountryId: { type: "string" },
          data: {
            type: "object",
            properties: {
              relationChange: { type: "number" },
              influenceChange: { type: "number" },
              sanctionType: { type: "string" },
            },
          },
        },
        required: ["type", "sourceCountryId"],
        propertyOrdering: ["type", "sourceCountryId", "targetCountryId", "data"],
      },
    },
  },
  required: ["title", "descriptions", "actions"],
  propertyOrdering: ["title", "descriptions", "actions"],
};

/**
 * Автоматизированный провайдер через Gemini API (generateContent).
 * Требует GEMINI_API_KEY в переменных окружения (server/.env, не в git).
 * Модель настраивается через GEMINI_MODEL, дефолт — уже проверенная
 * живым тестом gemini-3.1-flash-lite.
 */
export class GeminiProvider implements LLMProvider {
  async generateResponse(prompt: string): Promise<string> {
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
            responseSchema: RESPONSE_SCHEMA,
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
