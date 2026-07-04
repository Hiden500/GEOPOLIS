import { describe, it, expect } from "vitest";
import { updateBudgetSchema } from "../schemas";
import { BUDGET_SPENDING_SHARE_CAPS } from "@shared/constants/budgetSpendingShareCaps";

const VALID_BUDGET = {
  military: 0.1,
  research: 0.1,
  education: 0.05,
  infrastructure: 0.05,
  welfare: 0.1,
};

describe("updateBudgetSchema", () => {
  it("принимает корректные доли", () => {
    expect(updateBudgetSchema.safeParse(VALID_BUDGET).success).toBe(true);
  });

  it("отклоняет отрицательную долю", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, military: -0.01 });
    expect(result.success).toBe(false);
  });

  it("отклоняет NaN (защита от Infinity/NaN, не покрытая одним .min(0))", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, military: NaN });
    expect(result.success).toBe(false);
  });

  it("отклоняет Infinity", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, welfare: Infinity });
    expect(result.success).toBe(false);
  });

  it("принимает долю ровно на потолке категории (граница включительно)", () => {
    const result = updateBudgetSchema.safeParse({ ...VALID_BUDGET, military: BUDGET_SPENDING_SHARE_CAPS.military });
    expect(result.success).toBe(true);
  });

  it("отклоняет долю чуть выше потолка категории", () => {
    const result = updateBudgetSchema.safeParse({
      ...VALID_BUDGET,
      military: BUDGET_SPENDING_SHARE_CAPS.military + 0.001,
    });
    expect(result.success).toBe(false);
  });

  it("не требует, чтобы сумма долей была ≤1 — структурный дефицит намеренно разрешён", () => {
    const result = updateBudgetSchema.safeParse({
      military: BUDGET_SPENDING_SHARE_CAPS.military,
      research: BUDGET_SPENDING_SHARE_CAPS.research,
      education: BUDGET_SPENDING_SHARE_CAPS.education,
      infrastructure: BUDGET_SPENDING_SHARE_CAPS.infrastructure,
      welfare: BUDGET_SPENDING_SHARE_CAPS.welfare,
    });
    expect(result.success).toBe(true);
  });
});
