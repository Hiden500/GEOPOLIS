import { type GameState } from "@shared/types/GameState";
import { type ScenarioInfo } from "@shared/types/ScenarioInfo";
import { type PlayerAction } from "@shared/types/actions/PlayerAction";

const API = "";

export interface BudgetUpdate {
  militarySpending: number;
  researchSpending: number;
  educationSpending: number;
  infrastructureSpending: number;
  welfareSpending: number;
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
  playerCountryId: string
): Promise<GameState> {
  const response = await fetch(`${API}/game/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId, playerCountryId }),
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

export async function createAction(action: {
  type: string;
  regionId: number;
  parameters?: Record<string, unknown>;
}): Promise<{ success: true; action: PlayerAction }> {
  const response = await fetch(`${API}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  return handleResponse(response);
}

export async function deleteAction(actionId: string): Promise<{ success: true }> {
  const response = await fetch(`${API}/actions/${actionId}`, {
    method: "DELETE",
  });
  return handleResponse(response);
}
