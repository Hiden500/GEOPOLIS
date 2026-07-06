import { type GameState, type LLMAction } from "@shared/types/GameState";
import { type ScenarioInfo } from "@shared/types/ScenarioInfo";
import { type Locale } from "@shared/types/i18n/LocalizedText";

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

export async function nextTurn(): Promise<GameState> {
  const response = await fetch(`${API}/game/next-turn`, {
    method: "POST",
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

export async function startResearch(projectId: string): Promise<{ success: true; project: unknown }> {
  const response = await fetch(`${API}/research/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  return handleResponse(response);
}

export async function stopResearch(projectId: string): Promise<{ success: true }> {
  const response = await fetch(`${API}/research/stop/${projectId}`, {
    method: "POST",
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
  title?: string;
  descriptions?: string;
  appliedActions: LLMAction[];
  rejectedActions: { action: LLMAction; reason: string }[];
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
