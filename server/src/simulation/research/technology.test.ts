import { describe, it, expect } from "vitest";
import { getDomainTier, getCombinedArmsMultiplier, TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";
import { createTestCountry } from "../../test-utils/fixtures";

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

describe("getCombinedArmsMultiplier (независимый гейм-дизайн разбор, 2026-07-06)", () => {
  it("возвращает 1 при нулевом прогрессе во всех военных доменах", () => {
    const country = createTestCountry({ technology: { domains: {} } });
    expect(getCombinedArmsMultiplier(country)).toBe(1);
  });

  it("растёт с минимальным тиром среди armor/infantry/aviation/naval", () => {
    const country = createTestCountry({
      technology: {
        domains: {
          armor: TIER_PROGRESS_THRESHOLD * 2,
          infantry: TIER_PROGRESS_THRESHOLD * 2,
          aviation: TIER_PROGRESS_THRESHOLD * 2,
          naval: TIER_PROGRESS_THRESHOLD * 2,
        },
      },
    });
    expect(getCombinedArmsMultiplier(country)).toBeCloseTo(1.1); // 1 + 2*0.05
  });

  it("не даёт бонус за один сильный домен, если остальные на нуле (награда за широту, не за объём)", () => {
    const country = createTestCountry({
      technology: {
        domains: { armor: TIER_PROGRESS_THRESHOLD * 10, infantry: 0, aviation: 0, naval: 0 },
      },
    });
    expect(getCombinedArmsMultiplier(country)).toBe(1);
  });

  it("отсутствующий ключ домена считается прогрессом 0, не ломает расчёт", () => {
    const country = createTestCountry({
      technology: {
        domains: { armor: TIER_PROGRESS_THRESHOLD * 5, infantry: TIER_PROGRESS_THRESHOLD * 5 },
      },
    });
    expect(getCombinedArmsMultiplier(country)).toBe(1); // aviation/naval отсутствуют → тир 0
  });

  it("не превышает потолок 2x даже при огромном равномерном прогрессе", () => {
    const country = createTestCountry({
      technology: {
        domains: {
          armor: TIER_PROGRESS_THRESHOLD * 100,
          infantry: TIER_PROGRESS_THRESHOLD * 100,
          aviation: TIER_PROGRESS_THRESHOLD * 100,
          naval: TIER_PROGRESS_THRESHOLD * 100,
        },
      },
    });
    expect(getCombinedArmsMultiplier(country)).toBe(2);
  });
});
