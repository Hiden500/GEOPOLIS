import { describe, it, expect } from "vitest";
import { parseDatedEvents, MAX_DATED_EVENTS } from "../datedEvents";

/**
 * Разбор датированных событий ответа.
 *
 * Тесты проверяют СВОЙСТВА границы, а не снимок конкретного ответа: что кривой
 * элемент не уносит соседей, что дата обязана лежать в месяце хода и что чужой
 * id страны не стоит потери верно датированного факта.
 */

const TURN_DATE = "1946-03-01";
const known = (id: string): boolean => ["USA", "SUN", "GBR"].includes(id);

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date: "1946-03-05",
    title: "Речь в Фултоне",
    description: "Черчилль произнёс речь о железном занавесе.",
    ...overrides,
  };
}

describe("parseDatedEvents", () => {
  it("поля отсутствуют — событий нет и отказов нет: месяц без датируемого события законен", () => {
    expect(parseDatedEvents(undefined, TURN_DATE, known)).toEqual({ drafts: [], rejections: [] });
    expect(parseDatedEvents(null, TURN_DATE, known)).toEqual({ drafts: [], rejections: [] });
  });

  it("принимает корректное событие и нормализует список стран", () => {
    const parsed = parseDatedEvents(
      [event({ countries: ["USA", "USA", " GBR ", "NARNIA", 42] })],
      TURN_DATE,
      known
    );

    expect(parsed.rejections).toEqual([]);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0]!.claimedCountries).toEqual(["USA", "GBR"]);
  });

  it("кривой элемент отбрасывается со своей причиной, соседние остаются", () => {
    const parsed = parseDatedEvents(
      [event({ date: "не дата" }), event({ title: "Испытание на Бикини" })],
      TURN_DATE,
      known
    );

    expect(parsed.drafts.map(d => d.title)).toEqual(["Испытание на Бикини"]);
    expect(parsed.rejections).toHaveLength(1);
    expect(parsed.rejections[0]).toMatchObject({ code: "datedEventInvalid", position: 0 });
  });

  it("дата вне месяца хода не принимается: ответ покрывает ровно один месяц", () => {
    const parsed = parseDatedEvents([event({ date: "1946-02-28" })], TURN_DATE, known);

    expect(parsed.drafts).toEqual([]);
    expect(parsed.rejections[0]!.code).toBe("datedEventInvalid");
  });

  it("несуществующая календарная дата не принимается", () => {
    expect(parseDatedEvents([event({ date: "1946-03-32" })], TURN_DATE, known).drafts).toEqual([]);
    expect(parseDatedEvents([event({ date: "1946-02-30" })], "1946-02-01", known).drafts).toEqual(
      []
    );
  });

  it("хвост сверх капа отбрасывается С ПРИЧИНОЙ, а не молча", () => {
    const many = Array.from({ length: MAX_DATED_EVENTS + 2 }, (_, i) =>
      event({ title: `Событие ${i}` })
    );
    const parsed = parseDatedEvents(many, TURN_DATE, known);

    expect(parsed.drafts).toHaveLength(MAX_DATED_EVENTS);
    expect(parsed.rejections).toHaveLength(2);
    expect(parsed.rejections.every(r => r.code === "datedEventInvalid")).toBe(true);
  });

  it("не массив — одна причина, а не молчание", () => {
    const parsed = parseDatedEvents({ date: "1946-03-05" }, TURN_DATE, known);

    expect(parsed.drafts).toEqual([]);
    expect(parsed.rejections).toHaveLength(1);
  });

  it("пустые и переросшие тексты не принимаются", () => {
    expect(parseDatedEvents([event({ title: "   " })], TURN_DATE, known).drafts).toEqual([]);
    expect(parseDatedEvents([event({ description: "" })], TURN_DATE, known).drafts).toEqual([]);
    expect(
      parseDatedEvents([event({ title: "я".repeat(200) })], TURN_DATE, known).drafts
    ).toEqual([]);
  });
});
