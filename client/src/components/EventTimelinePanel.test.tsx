import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { type Event, type EventFactuality } from "@shared/types/Event";
import { emptyResponseReceipt } from "@shared/types/ResponseReceipt";
import { EventTimelinePanel } from "./EventTimelinePanel";

/**
 * Пометка подтверждённости в ленте событий (решение пользователя 2026-07-27,
 * docs/PRIMITIVES.md §3).
 *
 * Проверяется одна граница: текст, который движок не подтвердил, не должен
 * читаться как установленный факт. Заголовок при этом остаётся на месте —
 * решение пользователя именно среднее: заявление режиссёра видно игроку, но
 * помечено, а в долгую память кампании (летопись) не идёт.
 */
function event(factuality: EventFactuality, title: string): Event {
  return {
    kind: "response",
    id: `e-${factuality}`,
    date: "1946-03-01",
    title,
    description: "Войска вошли в город.",
    receipt: { ...emptyResponseReceipt("1946-03-01"), factuality },
  };
}

/** Датированное событие того же ответа: своей квитанции нет, есть ссылка. */
function datedEvent(responseEventId: string, date: string, title: string): Event {
  return {
    kind: "dated",
    id: `${responseEventId}-${date}`,
    date,
    title,
    description: "Черчилль произнёс речь о железном занавесе.",
    responseEventId,
    claimedCountries: [],
  };
}

function renderTimeline(events: Event[]) {
  render(
    <EventTimelinePanel events={events} countries={[]} onSelectCountry={vi.fn()} />
  );
}

describe("EventTimelinePanel — заявление режиссёра отделено от факта", () => {
  it("частично подтверждённое событие помечено, но заголовок игрок видит", () => {
    renderTimeline([event("partial", "Восстание подавлено, реформа проведена")]);

    expect(screen.getByText("Восстание подавлено, реформа проведена")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/Подтверждено частично/);
  });

  it("неподтверждённое (чистый нарратив) названо заявлением режиссёра", () => {
    renderTimeline([event("unconfirmed", "По Европе поползли слухи")]);

    expect(screen.getByRole("note").textContent).toMatch(/Фактами не подтверждено/);
  });

  it("подтверждённое событие пометки не несёт", () => {
    // Отсутствие пометки — само по себе утверждение: всё, что ответ предлагал
    // движку, движок применил. Поэтому её нельзя показывать «на всякий случай».
    renderTimeline([event("confirmed", "Фултонская речь произнесена")]);

    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("Фултонская речь произнесена")).toBeTruthy();
  });

  it("лента упорядочена по ДАТЕ, а не по порядку записи движком", () => {
    // Различающий случай: модель перечислила события месяца не по возрастанию.
    // Простой разворот массива дал бы 5-е марта выше 12-го — то есть порядок
    // ленты держится именно сортировкой, а не тем, что движок пишет по порядку.
    renderTimeline([
      event("confirmed", "Март 1946: раскол углубляется"),
      datedEvent("e-confirmed", "1946-03-12", "Переговоры в Москве"),
      datedEvent("e-confirmed", "1946-03-05", "Речь в Фултоне"),
    ]);

    const titles = screen.getAllByRole("heading").map(node => node.textContent);
    expect(titles).toEqual([
      "Переговоры в Москве",
      "Речь в Фултоне",
      "Март 1946: раскол углубляется",
    ]);
  });

  it("датированное событие наследует пометку от своего ответа", () => {
    // Пометки у него своей быть не может: квитанция описывает ответ целиком.
    // Но и молчать нельзя — иначе неподтверждённый текст читается как факт.
    renderTimeline([
      event("partial", "Март 1946: раскол углубляется"),
      datedEvent("e-partial", "1946-03-05", "Речь в Фултоне"),
    ]);

    expect(screen.getAllByRole("note")).toHaveLength(2);
  });

  it("в смешанной ленте помечены ровно неподтверждённые", () => {
    renderTimeline([
      event("confirmed", "Первое"),
      event("partial", "Второе"),
      event("unconfirmed", "Третье"),
    ]);

    expect(screen.getAllByRole("note")).toHaveLength(2);
  });
});
