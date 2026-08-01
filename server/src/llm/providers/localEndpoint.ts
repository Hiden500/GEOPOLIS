/**
 * Адрес, авторизация и список моделей OpenAI-совместимого эндпоинта.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Одни и те же три строки (взять `LOCAL_LLM_BASE_URL`,
 * срезать хвостовые слэши, добавить `Authorization`) стояли в трёх местах —
 * провайдере, прогоне кампании и замерочном скрипте, — и разошлись: провайдер
 * ключ отправлял, а оба скрипта нет. На локальном рантайме это не всплывало
 * (LM Studio не аутентифицирует), но против шлюза с ключом preflight падал
 * `401 Missing API key` ещё до первого хода. Место, где легко забыть заголовок,
 * должно быть одно.
 */

/** Дефолт совпадает с портом LM Studio по умолчанию. */
export const DEFAULT_BASE_URL = "http://localhost:1234/v1";

/** База API без хвостовых слэшей: `${base}/models` не должен давать `//models`. */
export function localBaseUrl(): string {
  return (process.env.LOCAL_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * Заголовки запроса. `Authorization` уходит, только если ключ задан: локальный
 * рантайм не аутентифицирует, а шлюзы (vLLM, LiteLLM, OpenAI-прокси) требуют.
 */
export function localHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.LOCAL_LLM_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/** Задан ли ключ — БЕЗ самого значения: секрет не попадает ни в лог, ни в отчёт. */
export function hasApiKey(): boolean {
  return Boolean(process.env.LOCAL_LLM_API_KEY);
}

/**
 * `GET /models` — идентификаторы моделей, которые эндпоинт готов обслуживать.
 *
 * Пустой список и недоступный сервер — РАЗНЫЕ состояния, и вызывающий обязан
 * различать их сам: у LM Studio пустой список значит «модель не загружена», у
 * шлюза — «ключ не даёт доступа ни к одной». Поэтому здесь бросается только
 * недоступность, а пустота возвращается как пустой массив.
 */
export async function listLocalModels(timeoutMs = 10_000): Promise<string[]> {
  const url = `${localBaseUrl()}/models`;
  const response = await fetch(url, {
    headers: localHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const hint =
      response.status === 401 || response.status === 403
        ? hasApiKey()
          ? " Ключ задан, но отвергнут: проверьте LOCAL_LLM_API_KEY."
          : " Ключ не задан: добавьте LOCAL_LLM_API_KEY в server/.env."
        : "";
    throw new Error(`${url} вернул ${response.status}: ${text.slice(0, 300)}.${hint}`);
  }

  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? [])
    .map(m => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}
