import { type GameState } from "@shared/types/GameState";
import { type ScenarioInfo } from "@shared/types/ScenarioInfo";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveOutcomeRecord } from "@shared/types/politics/PrimitiveOutcome";
import { type PrimitiveRejectionRecord } from "@shared/types/politics/PrimitiveRejection";
import { type ResponseReceipt } from "@shared/types/ResponseReceipt";

const API = "";

/** Доли income по категориям (не абсолютные деньги) — см. docs/ECONOMY.md "Модель единиц". */
export interface BudgetUpdate {
  military: number;
  research: number;
  education: number;
  infrastructure: number;
  welfare: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getScenarios(): Promise<ScenarioInfo[]> {
  const response = await fetch(`${API}/scenarios/list`);
  return handleResponse(response);
}

export async function startGame(
  scenarioId: string,
  playerCountryId: string,
  locale: Locale
): Promise<GameState> {
  const response = await fetch(`${API}/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId, playerCountryId, locale }),
  });
  return handleResponse(response);
}

/**
 * Продвигает ход на `months` месяцев (переменная длина хода, docs/DECISIONS.md,
 * 2026-07-05/07-06) — один ответ LLM разблокирует весь мульти-месячный ход.
 * Без UI-селектора (интерфейс заморожен) — параметр готов к использованию.
 */
export async function nextTurn(months?: number): Promise<GameState> {
  const response = await fetch(`${API}/game/next-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(months !== undefined ? { months } : {}),
  });
  return handleResponse(response);
}

export async function updateBudget(budget: BudgetUpdate): Promise<{ success: true; budget: unknown }> {
  const response = await fetch(`${API}/budget`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(budget),
  });
  return handleResponse(response);
}

export async function savePlayerIntent(intent: string): Promise<{ success: true; intent: string }> {
  const response = await fetch(`${API}/player-intent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
  return handleResponse(response);
}

export async function getGameState(): Promise<GameState> {
  const response = await fetch(`${API}/game/state`);
  return handleResponse(response);
}

export interface LlmPromptResult {
  prompt: string;
  llmTurn: number;
}

export interface LlmCycleResult {
  success: boolean;
  error?: string;
  /**
   * Текст модели — приходит ТОЛЬКО когда он стал каноном (событие записано на
   * сервере). При полном отказе полей нет вовсе: сервер не отдаёт прозу,
   * описывающую то, чего не произошло (docs/CONCEPT.md §7.2).
   */
  title?: string;
  descriptions?: string;
  /**
   * Стал ли ответ каноном. `false` означает «режиссёр предложил невозможное»:
   * мир не изменился, события нет, показывать нужно диагностику, а не нарратив.
   */
  narrativeCanonized: boolean;
  /**
   * ЧТО НА САМОМ ДЕЛЕ произошло — одна квитанция вместо пяти параллельных
   * полей (`shared/types/ResponseReceipt.ts`, Милстоун 1).
   *
   * До этого клиент получал степень подтверждённости, применённые действия,
   * отклонённые действия, отклик примитивов и отказы примитивов по
   * отдельности и собирал из них картину сам — второй раз после того, как её
   * собрал сервер. Теперь источник один и тот же, что лёг в событие.
   */
  receipt: ResponseReceipt;
}

export async function getLlmPrompt(): Promise<LlmPromptResult> {
  const response = await fetch(`${API}/llm/prompt`);
  return handleResponse(response);
}

export async function submitLlmResponse(llmResponse: string): Promise<LlmCycleResult> {
  const response = await fetch(`${API}/llm/response`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response: llmResponse }),
  });
  return handleResponse(response);
}

/** Автоматизированный LLM-цикл через Gemini API (POST /llm/auto) — промт и
 * применение ответа делает сервер, ключ API никогда не уходит на клиент. */
export async function runAutoLlmCycle(): Promise<LlmCycleResult> {
  const response = await fetch(`${API}/llm/auto`, { method: "POST" });
  return handleResponse(response);
}

/**
 * Путь игрока к примитивам (docs/PRIMITIVES.md §1, гибридный интерфейс).
 *
 * Примитив на клиенте — непрозрачная структура: интерфейс её не собирает по
 * полям и не показывает игроку. Он получает её от перевода (или от быстрой
 * кнопки) и возвращает на применение как есть, а человеку показывает `preview`
 * и `outcomes` — локализуемые описания. Отсюда `unknown[]`: типизировать здесь
 * алфавит движка значило бы завести его вторую копию в клиенте.
 */
export interface TranslateOrderResult {
  primitives: unknown[];
  /** Распознанное намерение человеческим языком — без величин, их ещё нет. */
  preview: PrimitiveOutcomeRecord[];
  invalid: { index: number; reason: string }[];
}

export interface ApplyPrimitivesResult {
  /** Батч с этим ключом уже применялся — мир не тронут (docs/CONCEPT.md §7.2). */
  duplicate: boolean;
  outcomes: PrimitiveOutcomeRecord[];
  /**
   * Причина отказа — код + параметры, а не готовая строка (Милстоун 1).
   * Локализуется на клиенте (`usePrimitiveRejectionText`); величин
   * несостоявшегося действия в ней нет по построению.
   */
  rejected: PrimitiveRejectionRecord[];
}

export async function translatePlayerOrder(
  intent: string,
  selectedRegionId?: number
): Promise<TranslateOrderResult> {
  const response = await fetch(`${API}/primitives/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      selectedRegionId === undefined ? { intent } : { intent, selectedRegionId }
    ),
  });
  return handleResponse(response);
}

/**
 * @param idempotencyKey тот же ключ при повторной отправке того же приказа —
 *   двойной клик и ретрай не должны применить батч дважды.
 */
export async function applyPrimitives(
  primitives: unknown[],
  idempotencyKey: string
): Promise<ApplyPrimitivesResult> {
  const response = await fetch(`${API}/primitives/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primitives, idempotencyKey }),
  });
  return handleResponse(response);
}

/**
 * Выбор осколка после распада страны игрока (docs/CONCEPT.md §7.1).
 *
 * Отдельная ручка, а не приказ-примитив: это ОТВЕТ игрока на вопрос движка, и
 * проходить через границу хода ему незачем — мир при выборе не меняется.
 */
export async function chooseSuccessor(countryId: string): Promise<{
  playerCountryId: string;
}> {
  const response = await fetch(`${API}/primitives/succession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryId }),
  });
  return handleResponse(response);
}
