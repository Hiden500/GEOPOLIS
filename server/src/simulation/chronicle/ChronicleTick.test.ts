import { describe, it, expect } from "vitest";
import { type Event, type EventFactuality } from "@shared/types/Event";
import { emptyResponseReceipt } from "@shared/types/ResponseReceipt";
import { type PrimitiveOutcomeRecord } from "@shared/types/politics/PrimitiveOutcome";
import { chronicleTick } from "./ChronicleTick";
import { createTestGameState } from "../../test-utils/fixtures";

/** Событие ленты: по умолчанию подтверждённое — как до правки 2026-07-27. */
function event(
  id: string,
  date: string,
  title: string,
  factuality: EventFactuality = "confirmed",
  primitiveOutcomes?: PrimitiveOutcomeRecord[]
): Event {
  return {
    id,
    date,
    title,
    description: "x",
    receipt: {
      ...emptyResponseReceipt(date),
      factuality,
      countries: ["USA"],
      primitives: { applied: primitiveOutcomes ?? [], rejected: [] },
    },
  };
}

/** Фактический результат `repress` в Шяуляе — форма из `buildPrimitiveOutcome`. */
const repressInSiauliai: PrimitiveOutcomeRecord = {
  verb: "repress",
  headline: {
    key: "repress.headline",
    values: { addressed: 2, unaffected: 0 },
    names: { region: { en: "Šiauliai", ru: "Шяуляй" } },
  },
  details: [],
};

describe("chronicleTick (docs/plans/02_LLM_CONTRACT.md, Шаг 3)", () => {
  it("год с событиями даёт одну запись летописи, год = currentDate.year - 1", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [
        event("e1", "1946-03-01", "Marshall Plan announced"),
        event("e2", "1946-11-01", "Border skirmish"),
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
        event("e1", "1946-06-01", "Old year event"),
        event("e2", "1947-06-01", "Relevant event"),
      ],
    });

    chronicleTick(game);

    expect(game.chronicle).toHaveLength(1);
    expect(game.chronicle[0]!.year).toBe(1947);
    expect(game.chronicle[0]!.summary).toBe("Relevant event");
  });

  it("cap на последние 5 записей года", () => {
    const eventHistory = Array.from({ length: 8 }, (_, i) =>
      event(`e${i}`, `1946-${String(i + 1).padStart(2, "0")}-01`, `Event ${i}`)
    );
    const game = createTestGameState({ currentDate: "1947-01-01", eventHistory });

    chronicleTick(game);

    expect(game.chronicle[0]!.summary).toBe("Event 3; Event 4; Event 5; Event 6; Event 7");
  });

  it("не мутирует eventHistory", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [event("e1", "1946-03-01", "X")],
    });
    const before = [...game.eventHistory];

    chronicleTick(game);

    expect(game.eventHistory).toEqual(before);
  });

  it("накапливает записи по годам при повторных вызовах", () => {
    const game = createTestGameState({
      currentDate: "1947-01-01",
      eventHistory: [event("e1", "1946-06-01", "Year 1946")],
    });
    chronicleTick(game);

    game.currentDate = "1948-01-01";
    game.eventHistory.push(event("e2", "1947-06-01", "Year 1947"));
    chronicleTick(game);

    expect(game.chronicle).toEqual([
      { year: 1946, summary: "Year 1946" },
      { year: 1947, summary: "Year 1947" },
    ]);
  });

  /**
   * Летопись строится по ФАКТУ, а не по заголовку (решение пользователя
   * 2026-07-27 по итогам внешнего аудита, docs/PRIMITIVES.md §3). До правки
   * склейка брала `Event.title` дословно у любого события — то есть заголовок,
   * описывающий отклонённую половину ответа, через год становился многолетней
   * памятью кампании и уходил в каждый промт как факт.
   */
  describe("в летопись попадает только подтверждённое фактами", () => {
    it("неподтверждённое утверждение (чистый нарратив) не доходит до летописи", () => {
      const game = createTestGameState({
        currentDate: "1947-01-01",
        eventHistory: [
          event("e1", "1946-03-01", "Восстание в Прибалтике подавлено", "unconfirmed"),
        ],
      });

      chronicleTick(game);

      // Ни строкой, ни пустой записью: «1946: » читалось бы как год, о котором
      // достоверно известно ничего.
      expect(game.chronicle).toHaveLength(0);
    });

    it("частично подтверждённое отдаёт фактические следы, а не свой заголовок", () => {
      const game = createTestGameState({
        currentDate: "1947-01-01",
        eventHistory: [
          event(
            "e1",
            "1946-03-01",
            "Реформа проведена, восстание подавлено",
            "partial",
            [repressInSiauliai]
          ),
        ],
      });

      chronicleTick(game);

      expect(game.chronicle).toHaveLength(1);
      expect(game.chronicle[0]!.summary).toBe("applied: repress in Šiauliai");
      // Заголовок, который мог описывать отклонённую реформу, в долгую память
      // не попал вовсе.
      expect(game.chronicle[0]!.summary).not.toContain("Реформа");
    });

    it("частично подтверждённое без машиночитаемых следов не даёт летописи ничего", () => {
      // Отклонён был элемент СТАРОГО канала `actions` — фактического результата
      // у него нет, выдумывать его склейке не из чего.
      const game = createTestGameState({
        currentDate: "1947-01-01",
        eventHistory: [event("e1", "1946-03-01", "Аннексия Эльзаса", "partial")],
      });

      chronicleTick(game);

      expect(game.chronicle).toHaveLength(0);
    });

    it("кап 5 считается по подтверждённым записям, а не по всем событиям года", () => {
      // Иначе неподтверждённые события «съедали» бы окно: год из 8 заявлений и
      // 5 фактов оставлял бы в летописи 1–2 строки.
      const eventHistory = [
        ...Array.from({ length: 8 }, (_, i) =>
          event(`n${i}`, `1946-0${(i % 9) + 1}-01`, `Narrative ${i}`, "unconfirmed")
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          event(`c${i}`, `1946-1${i % 3}-01`, `Confirmed ${i}`)
        ),
      ];
      const game = createTestGameState({ currentDate: "1947-01-01", eventHistory });

      chronicleTick(game);

      expect(game.chronicle[0]!.summary).toBe(
        "Confirmed 0; Confirmed 1; Confirmed 2; Confirmed 3; Confirmed 4"
      );
    });

    it("год смешанного состава: подтверждённые заголовки и следы частичных вперемешку", () => {
      const game = createTestGameState({
        currentDate: "1947-01-01",
        eventHistory: [
          event("e1", "1946-02-01", "Фултонская речь", "confirmed"),
          event("e2", "1946-05-01", "Мятеж утоплен в крови", "partial", [repressInSiauliai]),
          event("e3", "1946-09-01", "Слухи о заговоре", "unconfirmed"),
        ],
      });

      chronicleTick(game);

      expect(game.chronicle[0]!.summary).toBe(
        "Фултонская речь; applied: repress in Šiauliai"
      );
    });
  });
});
