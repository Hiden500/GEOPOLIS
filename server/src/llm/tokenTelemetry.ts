import fs from "fs";
import path from "path";

/**
 * Учёт расхода токенов (план 11, Милстоун 1 — «телеметрия токенов до бюджетов»).
 *
 * ЗАЧЕМ. Бюджет промта в `CONCEPT.md` §7 назван числом (~20k токенов), но
 * проверялся до сих пор единственным ручным замером: 12 813 символов на первом
 * тике. Ручной замер отвечает на вопрос «сколько было один раз», а решение о
 * бюджете требует ответа «сколько бывает» — распределения по реальным ходам, с
 * хвостом. Пока расход не пишется, любой предел назначается на глаз.
 *
 * ФОРМАТ — JSONL, строка на вызов. Он выбран не ради моды: файл дописывается
 * одной операцией без чтения предыдущего содержимого (важно для длинных
 * кампаний), переживает обрыв записи с потерей одной строки, а не всего файла,
 * и читается построчно любым инструментом.
 *
 * ГРАНИЦА. Модуль только записывает факт. Он ничего не решает, ничего не
 * ограничивает и не влияет на игровой цикл: сбой записи не должен ронять ход,
 * иначе телеметрия из наблюдателя превращается в точку отказа.
 */

/** Расход одного вызова модели. Поля — как их отдаёт провайдер. */
export interface TokenUsage {
  /** Токены промта (вход). */
  promptTokens: number;
  /** Токены ответа (выход), без «мыслей». */
  responseTokens: number;
  /**
   * Токены рассуждения, если провайдер их разделяет. У Gemini с
   * `thinkingLevel: "high"` это отдельная и обычно крупная статья, которую
   * `responseTokens` не покрывает: без неё картина расхода занижена.
   */
  thoughtTokens?: number | undefined;
  /**
   * Токены входа, взятые провайдером из КЭША, — та часть промта, которую он
   * узнал по совпадающему началу запроса и посчитал по льготной цене.
   *
   * Это ПОДМНОЖЕСТВО `promptTokens`, а не добавка к ним: провайдер сообщает
   * полный размер входа отдельно от того, сколько его пришло из кэша. Доля
   * кэша считается делением одного на другое, складывать их нельзя.
   *
   * Заполняется только Gemini (`cachedContentTokenCount`). У локального
   * OpenAI-совместимого рантайма поле НЕ читается намеренно: кэш там свой,
   * в схеме ответа не гарантирован, и заводить статью, которая всегда пуста,
   * значит утверждать «локально кэша не бывает» без проверки.
   */
  cachedTokens?: number | undefined;
  /** Итог по версии провайдера — не обязан равняться сумме полей выше. */
  totalTokens: number;
}

/** Запись журнала: расход плюс контекст, без которого число бессмысленно. */
export interface TokenUsageEntry extends TokenUsage {
  /** ISO-время вызова. */
  at: string;
  /** Модель провайдера: расход несопоставим между моделями. */
  model: string;
  /**
   * Назначение вызова (`world-cycle`, `intent-translation`, …). Мировой цикл и
   * перевод приказа игрока — разные по размеру запросы, и общий перцентиль по
   * ним обоим не описывает ни один из них.
   */
  purpose: string;
}

const DEFAULT_LOG_PATH = path.join("logs", "token-usage.jsonl");

/**
 * Путь журнала. Переопределяется `TOKEN_USAGE_LOG` — нужен тестам и разбору
 * отдельной кампании, а не только для гибкости.
 */
export function tokenUsageLogPath(): string {
  return process.env.TOKEN_USAGE_LOG || DEFAULT_LOG_PATH;
}

/**
 * Разбирает `usageMetadata` ответа Gemini.
 *
 * Возвращает `undefined`, если метаданных нет или они не числовые: провайдер
 * может вернуть ответ без них (ошибка квоты, изменение схемы ответа), и это не
 * повод считать вызов несостоявшимся — текст ответа уже получен и применяется.
 */
export function parseGeminiUsage(payload: unknown): TokenUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const meta = (payload as { usageMetadata?: unknown }).usageMetadata;
  if (typeof meta !== "object" || meta === null) return undefined;

  const raw = meta as Record<string, unknown>;
  const num = (key: string): number | undefined =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : undefined;

  const promptTokens = num("promptTokenCount");
  const totalTokens = num("totalTokenCount");
  // Без входа и итога запись не несёт смысла: остальные поля необязательны у
  // самого провайдера.
  if (promptTokens === undefined || totalTokens === undefined) return undefined;

  const usage: TokenUsage = {
    promptTokens,
    responseTokens: num("candidatesTokenCount") ?? 0,
    totalTokens,
  };
  const thoughts = num("thoughtsTokenCount");
  if (thoughts !== undefined) usage.thoughtTokens = thoughts;
  // Кэш префикса виден ТОЛЬКО здесь. Поле появляется в ответе лишь когда
  // совпадение случилось: его отсутствие означает промах, а не поломку
  // разбора, — поэтому нуля вместо undefined тут быть не должно, иначе
  // «кэш не сработал» и «провайдер не сообщил» перестанут различаться.
  const cached = num("cachedContentTokenCount");
  if (cached !== undefined) usage.cachedTokens = cached;
  return usage;
}

/**
 * Тот же расход, но в OpenAI-совместимом формате (локальный рантайм, см.
 * `LocalOpenAIProvider`).
 *
 * Отдельная функция, а не общий разбор с Gemini: имена полей различаются
 * целиком (`prompt_tokens` против `promptTokenCount`), и попытка угадывать оба
 * набора в одном месте дала бы разбор, который молча возвращает undefined при
 * переименовании у любого из двух провайдеров.
 *
 * Размышление у reasoning-моделей лежит ВНУТРИ `completion_tokens`, в отличие
 * от Gemini, где `thoughtsTokenCount` идёт отдельной статьёй сверх ответа.
 * Поэтому `responseTokens` здесь уменьшается на размышление: иначе один и тот
 * же ход считался бы по-разному в зависимости от провайдера, и перцентили в
 * отчёте перестали бы быть сравнимыми.
 */
export function parseOpenAIUsage(payload: unknown): TokenUsage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const meta = (payload as { usage?: unknown }).usage;
  if (typeof meta !== "object" || meta === null) return undefined;

  const raw = meta as Record<string, unknown>;
  const num = (key: string): number | undefined =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : undefined;

  const promptTokens = num("prompt_tokens");
  const totalTokens = num("total_tokens");
  if (promptTokens === undefined || totalTokens === undefined) return undefined;

  const completionTokens = num("completion_tokens") ?? 0;
  const details = raw.completion_tokens_details;
  const reasoning =
    typeof details === "object" && details !== null &&
    typeof (details as Record<string, unknown>).reasoning_tokens === "number"
      ? ((details as Record<string, unknown>).reasoning_tokens as number)
      : undefined;

  const usage: TokenUsage = {
    promptTokens,
    // Math.max, а не вычитание в лоб: сервер, сообщивший размышление больше
    // ответа, не должен давать отрицательный расход в журнале.
    responseTokens: reasoning === undefined ? completionTokens : Math.max(0, completionTokens - reasoning),
    totalTokens,
  };
  if (reasoning !== undefined) usage.thoughtTokens = reasoning;
  return usage;
}

/**
 * Дописывает строку в журнал.
 *
 * Сбой записи проглатывается намеренно и возвращается как `false`: недоступный
 * каталог логов не должен ронять ход игры. Вызывающий может это заметить, но
 * не обязан.
 */
export function appendTokenUsage(entry: TokenUsageEntry): boolean {
  const target = tokenUsageLogPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Одна точка распределения расхода. */
export interface UsagePercentiles {
  count: number;
  min: number;
  median: number;
  p90: number;
  p99: number;
  max: number;
}

/**
 * Перцентили по выборке.
 *
 * Метод — «ближайший ранг»: p-й перцентиль это элемент с индексом
 * `ceil(p × n) − 1` в отсортированном ряду. Интерполяции нет намеренно —
 * бюджет назначается по реально случившемуся вызову, а не по среднему между
 * двумя, которого не было.
 */
export function percentiles(values: readonly number[]): UsagePercentiles | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;

  return {
    count: sorted.length,
    min: sorted[0]!,
    median: at(0.5),
    p90: at(0.9),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
  };
}

/** Читает журнал; битые строки пропускаются, а не роняют отчёт. */
export function readTokenUsage(logPath: string = tokenUsageLogPath()): TokenUsageEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(logPath, "utf-8");
  } catch {
    return [];
  }
  const entries: TokenUsageEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as TokenUsageEntry;
      if (typeof parsed.totalTokens === "number") entries.push(parsed);
    } catch {
      // Оборванная последним падением строка — не причина терять журнал.
    }
  }
  return entries;
}
