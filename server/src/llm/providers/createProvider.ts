import { LLMProviderError } from "../../errors/AppError";
import { type LLMProvider } from "./LLMProvider";
import { GeminiProvider } from "./GeminiProvider";
import { LocalOpenAIProvider } from "./LocalOpenAIProvider";
import { type TokenUsage } from "../tokenTelemetry";

/**
 * Виды автопровайдера. Массив, а не голый union: имя из переменной окружения
 * приходит строкой, и проверять принадлежность нужно рантаймово — то же
 * основание, что у `SANCTION_TYPES` и `PRIMITIVE_INTENSITIES`.
 */
export const PROVIDER_KINDS = ["local", "gemini"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * Провайдер по умолчанию — ЛОКАЛЬНЫЙ (решение пользователя, 2026-07-30).
 *
 * Почему это разумный дефолт, а не только предпочтение: локальный рантайм не
 * требует ключей и не тратит платный бюджет, а замер на реальном промте хода
 * дал 10/10 схема-валидных ответов при обязательном `json_schema`
 * (`.agent/runs/local-llm-runtime-bench-2026-07-30.json`). Облачный Gemini
 * остаётся доступен переключением `LLM_PROVIDER=gemini` и никуда не удалён:
 * замер покрыл первый ход одной страны, а не всю партию.
 */
export const DEFAULT_PROVIDER: ProviderKind = "local";

export function resolveProviderKind(raw: string | undefined = process.env.LLM_PROVIDER): ProviderKind {
  if (!raw) return DEFAULT_PROVIDER;
  const value = raw.trim().toLowerCase();
  if ((PROVIDER_KINDS as readonly string[]).includes(value)) return value as ProviderKind;
  // Опечатка в переменной окружения НЕ должна молча откатывать на дефолт:
  // иначе `LLM_PROVIDER=gemeni` тихо уводит ходы в локальную модель, а игрок
  // видит только странные ответы.
  throw new LLMProviderError(
    `LLM_PROVIDER="${raw}" — неизвестный провайдер. Допустимые: ${PROVIDER_KINDS.join(", ")}.`
  );
}

/** Конкретная реализация по виду. */
export function createProviderInstance(
  kind: ProviderKind,
  onUsage?: (usage: TokenUsage) => void
): LLMProvider {
  return kind === "gemini" ? new GeminiProvider(onUsage) : new LocalOpenAIProvider(onUsage);
}

/**
 * Единая точка получения провайдера для транспортного слоя.
 *
 * До неё `new GeminiProvider(...)` стоял прямо в двух роутерах, то есть выбор
 * провайдера был вкомпилирован в транспорт. Со вторым провайдером это означало
 * бы одинаковую развилку в каждом месте вызова и расхождение при первой правке
 * одного из них.
 *
 * ВИД РАЗРЕШАЕТСЯ НА КАЖДОМ ВЫЗОВЕ, А НЕ ПРИ ИМПОРТЕ. Роутеры создают
 * провайдера на уровне модуля, то есть однократно при старте процесса. Если бы
 * `LLM_PROVIDER` читался там же, переменная фиксировалась бы моментом первого
 * импорта: тест, выставляющий её перед запросом, молча получал бы провайдера,
 * выбранного до него, — и именно так один существующий тест начал ходить в
 * живой локальный рантайм вместо ожидаемого отказа по ключу. Ленивое
 * разрешение стоит одного сравнения строк на ход.
 */
export function createLLMProvider(onUsage?: (usage: TokenUsage) => void): LLMProvider {
  return {
    generateResponse: (prompt, schema) =>
      createProviderInstance(resolveProviderKind(), onUsage).generateResponse(prompt, schema),
  };
}
