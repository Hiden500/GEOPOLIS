import { describe, it, expect } from "vitest";
import { chronicleTick } from "./ChronicleTick";
import { createTestGameState } from "../../test-utils/fixtures";

describe("chronicleTick (docs/plans/02_LLM_CONTRACT.md, Шаг 3)", () => {
  it("год с событиями даёт одну запись летописи, год = currentDate.year - 1", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [
        { id: "e1", date: "1946-03-01", title: "Marshall Plan announced", description: "x", countries: ["USA"] },
        { id: "e2", date: "1946-11-01", title: "Border skirmish", description: "x", countries: ["USA", "SUN"] },
      ],
    });

    chronicleTick(game);

    expect(game.chronicle).toHaveLength(1);
    expect(game.chronicle[0]!.year).toBe(1946);
    expect(game.chronicle[0]!.summary).toBe("Marshall Plan announced; Border skirmish");
  });

  it("пустой год (LLM не отвечала) не создаёт запись", () => {
    const game = createTestGameState({ currentDate: "1947-01-01", eventHistory: [] });

    chronicleTick(game);

    expect(game.chronicle).toHaveLength(0);
  });

  it("не трогает события другого года", () => {
    const game = createTestGameState({
      currentDate: "1948-01-01",
      eventHistory: [
        { id: "e1", date: "1946-06-01", title: "Old year event", description: "x", countries: ["USA"] },
        { id: "e2", date: "1947-06-01", title: "Relevant event", description: "x", countries: ["USA"] },
      ],
    });

    chronicleTick(game);

    expect(game.chronicle).toHaveLength(1);
    expect(game.chronicle[0]!.year).toBe(1947);
    expect(game.chronicle[0]!.summary).toBe("Relevant event");
  });

  it("cap на последние 5 заголовков года", () => {
    const eventHistory = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      date: `1946-${String(i + 1).padStart(2, "0")}-01`,
      title: `Event ${i}`,
      description: "x",
      countries: ["USA"],
    }));
    const game = createTestGameState({ currentDate: "1947-01-01", eventHistory });

    chronicleTick(game);

    expect(game.chronicle[0]!.summary).toBe("Event 3; Event 4; Event 5; Event 6; Event 7");
  });

  it("не мутирует eventHistory", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [{ id: "e1", date: "1946-03-01", title: "X", description: "x", countries: ["USA"] }],
    });
    const before = [...game.eventHistory];

    chronicleTick(game);

    expect(game.eventHistory).toEqual(before);
  });

  it("накапливает записи по годам при повторных вызовах", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [{ id: "e1", date: "1946-06-01", title: "Year 1946", description: "x", countries: ["USA"] }],
    });
    chronicleTick(game);

    game.currentDate = "1948-01-01";
    game.eventHistory.push({ id: "e2", date: "1947-06-01", title: "Year 1947", description: "x", countries: ["USA"] });
    chronicleTick(game);

    expect(game.chronicle).toEqual([
      { year: 1946, summary: "Year 1946" },
      { year: 1947, summary: "Year 1947" },
    ]);
  });
});
