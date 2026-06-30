import { describe, it, expect } from "vitest";
import { politicsTick } from "./PoliticsTick";
import { createTestCountry } from "../../test-utils/fixtures";

function makeCountry(overrides: {
    unemployment?: number;
    budgetBalance?: number;
    gdp?: number;
    inflation?: number;
    educationSpending?: number;
    welfareSpending?: number;
    taxRevenue?: number;
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
    c.economy.educationSpending = overrides.educationSpending ?? 100;
    c.economy.welfareSpending = overrides.welfareSpending ?? 100;
    // Зануляем побочные источники дохода — иначе они раздувают знаменатель
    // в corruptionEquilibrium и ломают предсказуемость тестов.
    c.economy.taxRevenue = overrides.taxRevenue ?? 1000;
    c.economy.exportIncome = 0;
    c.economy.stateEnterpriseIncome = 0;
    c.economy.otherIncome = 0;
    c.politics.stability = overrides.stability ?? 50;
    c.politics.governmentSupport = overrides.governmentSupport ?? 50;
    c.politics.legitimacy = overrides.legitimacy ?? 60;
    c.politics.corruption = overrides.corruption ?? 30;
    c.politics.ideology = overrides.ideology ?? "Democracy";
    return c;
}

describe("politicsTick — stability", () => {
    it("растёт при низкой безработице и бездефицитном бюджете", () => {
        const c = makeCountry({ unemployment: 2, budgetBalance: 100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeGreaterThan(50);
    });

    it("падает при высокой безработице и дефиците", () => {
        const c = makeCountry({ unemployment: 20, budgetBalance: -100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeLessThan(50);
    });

    it("зажата в [0, 100]", () => {
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 1 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(c.politics.stability).toBeGreaterThanOrEqual(0);
        expect(c.politics.stability).toBeLessThanOrEqual(100);
    });

    it("высокая коррупция (> 60) давит на stability", () => {
        const c1 = makeCountry({ unemployment: 10, budgetBalance: 0, stability: 50, corruption: 70 });
        const c2 = makeCountry({ unemployment: 10, budgetBalance: 0, stability: 50, corruption: 10 });
        politicsTick(c1);
        politicsTick(c2);
        expect(c1.politics.stability).toBeLessThan(c2.politics.stability);
    });
});

describe("politicsTick — governmentSupport", () => {
    it("дрейфует быстрее stability при одинаковом зазоре до равновесия", () => {
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 80, governmentSupport: 80 });
        const stabilityBefore = c.politics.stability;
        const supportBefore = c.politics.governmentSupport;
        politicsTick(c);
        const deltaStability = stabilityBefore - c.politics.stability;
        const deltaSupport = supportBefore - c.politics.governmentSupport;
        expect(deltaSupport).toBeGreaterThan(deltaStability);
    });
});

describe("politicsTick — legitimacy", () => {
    it("дрейфует к базису идеологии", () => {
        const c = makeCountry({ ideology: "Democracy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeGreaterThan(50);
    });

    it("дрейфует очень медленно (< 1 пункта за тик)", () => {
        const c = makeCountry({ ideology: "Democracy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeLessThan(51);
    });

    it("неизвестная идеология дрейфует к 55", () => {
        const c = makeCountry({ ideology: "Monarchy", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeGreaterThan(50);
    });
});

describe("politicsTick — corruption", () => {
    it("Democracy дрейфует к низкому равновесию (~20)", () => {
        // При rate=0.003 полупериод ≈ 231 тик (19 лет). После 500 тиков (42 года)
        // corruption ≈ 20 + 40*(0.997^500) ≈ 29 — явно ниже 35.
        const c = makeCountry({ ideology: "Democracy", corruption: 60, stability: 60 });
        for (let i = 0; i < 500; i++) politicsTick(c);
        expect(c.politics.corruption).toBeLessThan(35);
    });

    it("Nationalism не падает ниже своего структурного уровня", () => {
        const c = makeCountry({ ideology: "Nationalism", corruption: 0, stability: 60 });
        for (let i = 0; i < 500; i++) politicsTick(c);
        // Базис Nationalism = 55; при стабильной обстановке должна подняться к нему
        expect(c.politics.corruption).toBeGreaterThan(40);
    });

    it("нестабильность (stability < 40) поднимает равновесие коррупции", () => {
        const cUnstable = makeCountry({ ideology: "Democracy", corruption: 20, stability: 30 });
        const cStable = makeCountry({ ideology: "Democracy", corruption: 20, stability: 60 });
        for (let i = 0; i < 50; i++) {
            politicsTick(cUnstable);
            politicsTick(cStable);
        }
        expect(cUnstable.politics.corruption).toBeGreaterThan(cStable.politics.corruption);
    });

    it("низкие расходы на образование повышают равновесие коррупции", () => {
        // taxRevenue = 1000, educationSpending < 5% → +10 к равновесию
        const cLowEdu = makeCountry({ ideology: "Democracy", corruption: 20, educationSpending: 10, taxRevenue: 1000 });
        const cHighEdu = makeCountry({ ideology: "Democracy", corruption: 20, educationSpending: 200, taxRevenue: 1000 });
        for (let i = 0; i < 50; i++) {
            politicsTick(cLowEdu);
            politicsTick(cHighEdu);
        }
        expect(cLowEdu.politics.corruption).toBeGreaterThan(cHighEdu.politics.corruption);
    });

    it("коррупция вызывает утечку из казны пропорционально ВВП", () => {
        const c = makeCountry({ corruption: 50, gdp: 1_000_000 });
        const treasuryBefore = c.economy.treasury;
        politicsTick(c);
        expect(c.economy.treasury).toBeLessThan(treasuryBefore);
    });

    it("при нулевом ВВП утечки нет", () => {
        const c = makeCountry({ corruption: 100, gdp: 0 });
        const treasuryBefore = c.economy.treasury;
        politicsTick(c);
        expect(c.economy.treasury).toBe(treasuryBefore);
    });

    it("зажата в [0, 100]", () => {
        const c = makeCountry({ ideology: "Democracy", corruption: 0, stability: 80 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(c.politics.corruption).toBeGreaterThanOrEqual(0);
        expect(c.politics.corruption).toBeLessThanOrEqual(100);
    });
});
