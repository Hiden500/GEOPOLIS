import { describe, it, expect } from "vitest";
import { simulateMonth } from "./SimulationEngine";
import { createTestGameState, createTestCountry, createTestRegion } from "../test-utils/fixtures";

describe("simulateMonth — date advancement", () => {
    it("продвигает дату на один месяц", () => {
        const game = createTestGameState({ currentDate: "1946-01-01" });
        simulateMonth(game);
        expect(game.currentDate).toBe("1946-02-01");
    });

    it("переходит на следующий год в декабре", () => {
        const game = createTestGameState({ currentDate: "1946-12-01" });
        simulateMonth(game);
        expect(game.currentDate).toBe("1947-01-01");
    });

    it("корректно работает несколько месяцев подряд", () => {
        const game = createTestGameState({ currentDate: "1946-01-01" });
        for (let i = 0; i < 12; i++) simulateMonth(game);
        expect(game.currentDate).toBe("1947-01-01");
    });
});

describe("simulateMonth — детерминированные вехи (pendingWorldFacts, 2026-07-06)", () => {
    it("пересечение тира домена кладёт факт в game.pendingWorldFacts", () => {
        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({
                id: "USA",
                name: { en: "United States" },
                technology: { domains: { armor: 99 } }, // почти на пороге тира 1
            })],
        });

        simulateMonth(game);

        expect(game.pendingWorldFacts).toHaveLength(1);
        expect(game.pendingWorldFacts[0]).toMatchObject({ countryId: "USA" });
        expect(game.pendingWorldFacts[0]!.text).toContain("tier 1");
        expect(game.pendingWorldFacts[0]!.text).toContain("armor");
    });

    it("без пересечения тира — pendingWorldFacts остаётся пустым", () => {
        const game = createTestGameState({
            countries: [createTestCountry({
                id: "USA",
                technology: { domains: { armor: 0 } },
            })],
        });

        simulateMonth(game);

        expect(game.pendingWorldFacts).toEqual([]);
    });

    it("экономический кризис: inflation впервые пересекает порог 20 кладёт факт", () => {
        const base = createTestCountry();
        const economy = { ...base.economy };
        delete economy.taxRate; // иначе updateBudget() пересчитает taxRevenue из gdp×taxRate поверх оверрайда ниже

        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({
                id: "USA",
                name: { en: "United States" },
                economy: {
                    ...economy,
                    // Устойчивый дефицит много выше насыщения: цель инфляции
                    // уходит заведомо за порог 20. Стартуем чуть ниже порога.
                    //
                    // Раньше тест ждал пересечения за ОДИН тик и держался на
                    // старой арифметике «0.1 × дефицит/ВВП = 10 пунктов за
                    // месяц». С переводом приращения в проценты (2026-07-31)
                    // модель стала возвратом к цели: инфляция подтягивается
                    // постепенно, скачков на десять пунктов за месяц больше нет.
                    // Поэтому проверяется САМО пересечение и факт, а не срок.
                    inflation: 19,
                    gdp: 1_000_000,
                    taxRevenue: 0, exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
                    militarySpending: 100_000_000, researchSpending: 0, educationSpending: 0,
                    infrastructureSpending: 0, welfareSpending: 0, debt: 0, debtInterest: 0, otherExpenses: 0,
                    importSpending: 0,
                },
            })],
            regions: [createTestRegion({ id: 1, ownerCountryId: "USA", gdp: 1_000_000 })],
        });

        // Предел прогона — страховка от вечного цикла, а не ожидаемый срок.
        for (let month = 0; month < 24; month++) {
            simulateMonth(game);
            if (game.pendingWorldFacts.some(f => f.text.includes("inflation"))) break;
        }

        const fact = game.pendingWorldFacts.find(f => f.text.includes("inflation"));
        expect(fact).toBeDefined();
        expect(fact!.countryId).toBe("USA");
    });

    it("без пересечения порога инфляции — факта кризиса нет", () => {
        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({ id: "USA" })], // дефолтная фикстура — сбалансированный бюджет
        });

        simulateMonth(game);

        expect(game.pendingWorldFacts.find(f => f.text.includes("inflation"))).toBeUndefined();
    });

    it("политический кризис: stability впервые проваливается ниже 20 кладёт факт", () => {
        const base = createTestCountry();
        const economy = { ...base.economy };
        delete economy.taxRate; // иначе updateBudget() пересчитает taxRevenue из gdp×taxRate поверх оверрайда ниже

        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({
                id: "USA",
                name: { en: "United States" },
                politics: { ...base.politics, stability: 21, corruption: 90 }, // > STABILITY_HIGH_CORRUPTION_THRESHOLD(60)
                economy: {
                    ...economy,
                    unemployment: 50, // > STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD(15)
                    inflation: 100, // > STABILITY_HIGH_INFLATION_THRESHOLD(20)
                    gdp: 1_000_000_000,
                    // Доход ~0, огромный расход -> budgetBalance после updateBudget()
                    // глубоко отрицателен относительно gdp (> STABILITY_SEVERE_DEFICIT_GDP_SHARE=0.05).
                    taxRevenue: 0, exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
                    militarySpending: 1_000_000_000, researchSpending: 0, educationSpending: 0,
                    infrastructureSpending: 0, welfareSpending: 0, debt: 0, debtInterest: 0, otherExpenses: 0,
                    importSpending: 0,
                },
            })],
        });

        simulateMonth(game);

        const fact = game.pendingWorldFacts.find(f => f.text.includes("stability"));
        expect(fact).toBeDefined();
        expect(fact!.countryId).toBe("USA");
    });

    it("без пересечения порога stability — факта переворота нет", () => {
        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({ id: "USA" })], // дефолтная фикстура — stability=70
        });

        simulateMonth(game);

        expect(game.pendingWorldFacts.find(f => f.text.includes("stability"))).toBeUndefined();
    });

    it("долговой кризис: долг/ВВП впервые пересекает 1.0 кладёт факт «на грани дефолта»", () => {
        const base = createTestCountry();
        const economy = { ...base.economy };
        delete economy.taxRate; // иначе updateBudget пересчитает taxRevenue из gdp×taxRate

        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({
                id: "USA",
                name: { en: "United States" },
                economy: {
                    ...economy,
                    gdp: 1_000_000_000,
                    debt: 999_000_000, // долг/ВВП = 0.999, чуть ниже порога 1.0
                    treasury: 0,
                    // Доход 0, расход > 0 → дефицит финансируется долгом, долг/ВВП > 1.0.
                    taxRevenue: 0, exportIncome: 0, stateEnterpriseIncome: 0, otherIncome: 0,
                    militarySpending: 50_000_000, researchSpending: 0, educationSpending: 0,
                    infrastructureSpending: 0, welfareSpending: 0, debtInterest: 0, otherExpenses: 0,
                    importSpending: 0,
                },
            })],
        });

        simulateMonth(game);

        const fact = game.pendingWorldFacts.find(f => f.text.includes("brink of default"));
        expect(fact).toBeDefined();
        expect(fact!.countryId).toBe("USA");
    });

    it("без пересечения долгового порога — факта дефолта нет", () => {
        const game = createTestGameState({
            currentDate: "1946-01-01",
            countries: [createTestCountry({ id: "USA" })], // debt=0 по фикстуре
        });

        simulateMonth(game);

        expect(game.pendingWorldFacts.find(f => f.text.includes("brink of default"))).toBeUndefined();
    });
});
