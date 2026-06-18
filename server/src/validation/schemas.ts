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
 */
export const updateBudgetSchema = z.object({
  militarySpending: z.number().min(0),
  researchSpending: z.number().min(0),
  educationSpending: z.number().min(0),
  infrastructureSpending: z.number().min(0),
  welfareSpending: z.number().min(0)
}).refine(
  (data: any) => {
    const total = data.militarySpending + data.researchSpending +
                  data.educationSpending + data.infrastructureSpending +
                  data.welfareSpending;
    return total >= 0;
  },
  {
    message: "Total spending cannot be negative"
  }
);

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
