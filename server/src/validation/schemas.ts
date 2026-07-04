import { z } from "zod";

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
 * Схема для изменения бюджета.
 *
 * .finite() — защита от Infinity/-Infinity/NaN (zod пропускает NaN как
 * "number" без явного finite()). Дефицит намеренно разрешён (см.
 * docs/TODO.md), поэтому нет проверки суммы — только форма и разумность
 * отдельных полей. Смысловая проверка "статья ≤ gdp страны" требует
 * знать gdp страны из game state — она в CountryService.validateBudgetUpdate,
 * не здесь (zod-схема не видит игровое состояние).
 */
export const updateBudgetSchema = z.object({
  militarySpending: z.number().min(0).finite(),
  researchSpending: z.number().min(0).finite(),
  educationSpending: z.number().min(0).finite(),
  infrastructureSpending: z.number().min(0).finite(),
  welfareSpending: z.number().min(0).finite()
});

/**
 * Схема для старта исследования.
 */
export const startResearchSchema = z.object({
  projectId: z.string().min(1, "Project ID is required")
});

/**
 * Схема для действия игрока.
 */
export const playerActionSchema = z.object({
  type: z.enum(["build_factory", "build_mine", "build_infrastructure", "recruit_units"]),
  regionId: z.number().int().positive(),
  parameters: z.record(z.string(), z.any()).optional()
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
 * Типы для действия игрока.
 */
export type PlayerActionInput = z.infer<typeof playerActionSchema>;

/**
 * Типы для ответа LLM.
 */
export type LlmResponseInput = z.infer<typeof llmResponseSchema>;
