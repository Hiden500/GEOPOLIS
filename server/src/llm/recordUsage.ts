import { appendTokenUsage, type TokenUsage } from "./tokenTelemetry";
import { DEFAULT_MODEL } from "./providers/GeminiProvider";

/**
 * Дополняет расход контекстом и кладёт в журнал.
 *
 * Отдельный модуль, а не строка в маршруте, по двум причинам. Во-первых, оба
 * боевых вызова модели (мировой цикл и перевод приказа игрока) должны писать
 * одинаково — иначе перцентили считаются по разнородным записям. Во-вторых,
 * имя модели берётся из той же переменной окружения, что и сам вызов: журнал,
 * в котором расход не привязан к модели, бесполезен ровно в тот день, когда
 * модель сменят.
 */
export function recordUsage(usage: TokenUsage, purpose: string): void {
  appendTokenUsage({
    ...usage,
    at: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    purpose,
  });
}
