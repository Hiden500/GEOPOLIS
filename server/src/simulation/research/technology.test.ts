import { describe, it, expect } from "vitest";
import { getDomainTier, TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";

describe("getDomainTier", () => {
  it("возвращает 0 для нулевого/отрицательного прогресса", () => {
    expect(getDomainTier(0)).toBe(0);
    expect(getDomainTier(-50)).toBe(0);
  });

  it("возвращает 0 для прогресса меньше порога", () => {
    expect(getDomainTier(TIER_PROGRESS_THRESHOLD - 1)).toBe(0);
  });

  it("возвращает 1 ровно на пороге и до следующего", () => {
    expect(getDomainTier(TIER_PROGRESS_THRESHOLD)).toBe(1);
    expect(getDomainTier(TIER_PROGRESS_THRESHOLD * 2 - 1)).toBe(1);
  });

  it("растёт линейно с кратными порога", () => {
    expect(getDomainTier(TIER_PROGRESS_THRESHOLD * 5)).toBe(5);
  });
});
