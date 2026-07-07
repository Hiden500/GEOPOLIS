import { describe, it, expect } from "vitest";
import { simulateMonth } from "./SimulationEngine";
import { createTestGameState, createTestCountry } from "../test-utils/fixtures";

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
                name: "United States",
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
});
