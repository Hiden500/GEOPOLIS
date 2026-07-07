import { describe, it, expect } from "vitest";
import { getEquipmentPower } from "@shared/utils/equipment";
import { TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";
import { createTestCountry } from "../../test-utils/fixtures";

describe("getEquipmentPower (War Phase 2, независимый гейм-дизайн разбор, 2026-07-06)", () => {
  it("возвращает 0 при нулевой технике (дефолт всех стран сейчас)", () => {
    const country = createTestCountry();
    expect(getEquipmentPower(country)).toBe(0);
  });

  it("растёт с количеством техники при нулевом тире домена (мультипликатор 1)", () => {
    const country = createTestCountry({
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 100 },
      },
    });
    expect(getEquipmentPower(country)).toBe(100);
  });

  it("растёт с тиром соответствующего домена (armor для tanks)", () => {
    const withoutTier = createTestCountry({
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 100 },
      },
    });
    const withTier = createTestCountry({
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 100 },
      },
      technology: { domains: { armor: TIER_PROGRESS_THRESHOLD * 3 } }, // тир 3
    });

    expect(getEquipmentPower(withTier)).toBeGreaterThan(getEquipmentPower(withoutTier));
    expect(getEquipmentPower(withTier)).toBeCloseTo(100 * (1 + 3 * 0.1));
  });

  it("разные категории читают разные домены (fighters -> aviation, не armor)", () => {
    const country = createTestCountry({
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, fighters: 100 },
      },
      technology: { domains: { armor: TIER_PROGRESS_THRESHOLD * 5 } }, // не relevant для fighters
    });

    // fighters читает aviation (тир 0 здесь), не armor — мультипликатор остаётся 1.
    expect(getEquipmentPower(country)).toBe(100);
  });

  it("суммирует вклад нескольких категорий одновременно", () => {
    const country = createTestCountry({
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 50, rifles: 200 },
      },
    });
    expect(getEquipmentPower(country)).toBe(250);
  });
});
