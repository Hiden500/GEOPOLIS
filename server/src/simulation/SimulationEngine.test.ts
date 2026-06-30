import { describe, it, expect } from "vitest";
import { simulateMonth } from "./SimulationEngine";
import { createTestGameState } from "../test-utils/fixtures";

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
