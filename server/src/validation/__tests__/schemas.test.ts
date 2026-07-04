import { describe, it, expect } from "vitest";
import { updateBudgetSchema } from "../schemas";

const VALID_BUDGET = {
  militarySpending: 10,
  researchSpending: 20,
  educationSpending: 5,
  infrastructureSpending: 5,
  welfareSpending: 10,
};

describe("updateBudgetSchema", () => {
  it("принимает корректный бюджет", () => {
    expect(updateBudgetSchema.safeParse(VALID_BUDGET).success).toBe(true);
  });

  it("отклоняет отрицательное значение", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, militarySpending: -1 });
    expect(result.success).toBe(false);
  });

  it("отклоняет NaN (защита от Infinity/NaN, не покрытая одним .min(0))", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, militarySpending: NaN });
    expect(result.success).toBe(false);
  });

  it("отклоняет Infinity", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, welfareSpending: Infinity });
    expect(result.success).toBe(false);
  });

  it("не требует, чтобы сумма статей была ограничена — дефицит намеренно разрешён", () => {
    const result = updateBudgetSchema.safeParse({
      militarySpending: 1_000_000,
      researchSpending: 1_000_000,
      educationSpending: 1_000_000,
      infrastructureSpending: 1_000_000,
      welfareSpending: 1_000_000,
    });
    expect(result.success).toBe(true);
  });
});
