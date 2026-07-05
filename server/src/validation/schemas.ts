import { z } from "zod";
import { BUDGET_SPENDING_SHARE_CAPS } from "@shared/constants/budgetSpendingShareCaps";

/**
 * Схема для создания игры.
 */
export const createGameSchema = z.object({
  scenarioId: z.string().min(1, "Scenario ID is required"),
  playerCountryId: z.string().min(1, "Player country ID is required")
});

/**
 * Схема для выполнения хода.
 */
export const advanceTurnSchema = z.object({
  months: z.number().int().min(1).max(12).default(1)
});

/**
 * Схема для изменения бюджета — доли income по категориям (тот же паттерн,
 * что EconomyProfile.spending, см. docs/ECONOMY.md "Модель единиц"), не
 * абсолютные деньги. Потолки — BUDGET_SPENDING_SHARE_CAPS, общие с клиентом
 * и с EconomyTick, единый источник истины. .finite() — защита от
 * Infinity/-Infinity/NaN (zod пропускает NaN как "number" без finite()).
 * Нет проверки суммы — дефицит (Σ > 1) намеренно разрешён, см. docs/TODO.md.
 */
export const updateBudgetSchema = z.object({
  military: z.number().min(0).max(BUDGET_SPENDING_SHARE_CAPS.military).finite(),
  research: z.number().min(0).max(BUDGET_SPENDING_SHARE_CAPS.research).finite(),
  education: z.number().min(0).max(BUDGET_SPENDING_SHARE_CAPS.education).finite(),
  infrastructure: z.number().min(0).max(BUDGET_SPENDING_SHARE_CAPS.infrastructure).finite(),
  welfare: z.number().min(0).max(BUDGET_SPENDING_SHARE_CAPS.welfare).finite()
});

/**
 * Схема для старта исследования.
 */
export const startResearchSchema = z.object({
  projectId: z.string().min(1, "Project ID is required")
});

/**
 * Схема для намерения игрока свободным текстом (docs/DECISIONS.md, 2026-07-04).
 * Пустая строка — валидна, это способ очистить намерение.
 */
export const playerIntentSchema = z.object({
  intent: z.string().max(2000, "Intent is too long (max 2000 chars)")
});

/**
 * Схема для сырого ответа LLM (ручной цикл: вставка текста ответа).
 * Содержимое (JSON-структура actions/descriptions) валидируется глубже
 * в LLMResponseValidator — здесь только транспортный контракт.
 */
export const llmResponseSchema = z.object({
  response: z.string().min(1, "LLM response is required")
});

/**
 * Типы для создания игры.
 */
export type CreateGameInput = z.infer<typeof createGameSchema>;

/**
 * Типы для выполнения хода.
 */
export type AdvanceTurnInput = z.infer<typeof advanceTurnSchema>;

/**
 * Типы для изменения бюджета.
 */
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

/**
 * Типы для старта исследования.
 */
export type StartResearchInput = z.infer<typeof startResearchSchema>;

/**
 * Типы для намерения игрока.
 */
export type PlayerIntentInput = z.infer<typeof playerIntentSchema>;

/**
 * Типы для ответа LLM.
 */
export type LlmResponseInput = z.infer<typeof llmResponseSchema>;
