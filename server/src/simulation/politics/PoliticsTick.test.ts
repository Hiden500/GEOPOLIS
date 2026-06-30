import { describe, it, expect } from "vitest";
import { politicsTick } from "./PoliticsTick";
import { createTestCountry } from "../../test-utils/fixtures";

function makeCountry(overrides: {
    unemployment?: number;
    budgetBalance?: number;
    gdp?: number;
    inflation?: number;
    welfareSpending?: number;
    stability?: number;
    governmentSupport?: number;
    legitimacy?: number;
    corruption?: number;
    ideology?: string;
} = {}) {
    const c = createTestCountry();
    c.economy.unemployment = overrides.unemployment ?? 10;
    c.economy.budgetBalance = overrides.budgetBalance ?? 0;
    c.economy.gdp = overrides.gdp ?? 1000;
    c.economy.inflation = overrides.inflation ?? 5;
    c.economy.welfareSpending = overrides.welfareSpending ?? 100;
    c.politics.stability = overrides.stability ?? 50;
    c.politics.governmentSupport = overrides.governmentSupport ?? 50;
    c.politics.legitimacy = overrides.legitimacy ?? 60;
    c.politics.corruption = overrides.corruption ?? 30;
    c.politics.ideology = overrides.ideology ?? "Democracy";
    return c;
}

describe("politicsTick", () => {
    it("stability растёт при низкой безработице и бездефицитном бюджете", () => {
        const c = makeCountry({ unemployment: 2, budgetBalance: 100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeGreaterThan(50);
    });

    it("stability падает при высокой безработице и дефиците", () => {
        const c = makeCountry({ unemployment: 20, budgetBalance: -100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeLessThan(50);
    });

    it("stability зажата в [0, 100]", () => {
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 1 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(c.politics.stability).toBeGreaterThanOrEqual(0);
        expect(c.politics.stability).toBeLessThanOrEqual(100);
    });

    it("governmentSupport дрейфует быстрее stability при одинаковом зазоре до равновесия", () => {
        // Ставим оба поля далеко от их одинакового равновесия (0)
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 80, governmentSupport: 80 });
        const stabilityBefore = c.politics.stability;
        const supportBefore = c.politics.governmentSupport;
        politicsTick(c);
        const deltaStability = stabilityBefore - c.politics.stability;
        const deltaSupport = supportBefore - c.politics.governmentSupport;
        // Коэф governmentSupport (0.08) > stability (0.05) → падает быстрее
        expect(deltaSupport).toBeGreaterThan(deltaStability);
    });

    it("legitimacy дрейфует к базису идеологии", () => {
        const c = makeCountry({ ideology: "Democracy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeGreaterThan(50); // базис Democracy = 70
    });

    it("legitimacy дрейфует очень медленно", () => {
        const c = makeCountry({ ideology: "Democracy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeLessThan(51); // за 1 тик — меньше 1 пункта
    });

    it("corruption медленно снижается каждый тик", () => {
        const c = makeCountry({ corruption: 30 });
        politicsTick(c);
        expect(c.politics.corruption).toBeCloseTo(29.9, 5);
    });

    it("corruption не падает ниже 0", () => {
        const c = makeCountry({ corruption: 0 });
        politicsTick(c);
        expect(c.politics.corruption).toBe(0);
    });

    it("неизвестная идеология — legitimacy дрейфует к 55", () => {
        const c = makeCountry({ ideology: "Monarchy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeGreaterThan(50);
    });
});
