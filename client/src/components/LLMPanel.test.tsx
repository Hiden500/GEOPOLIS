import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import "../i18n";
import { LLMPanel } from "./LLMPanel";
import * as gameApi from "../api/gameApi";
import { type LlmCycleResult } from "../api/gameApi";

/**
 * Отклик цикла режиссёра (docs/CONCEPT.md §7.2).
 *
 * Проверяется одна граница: текст модели показывается как произошедшее ТОЛЬКО
 * когда он стал каноном. До правки 2026-07-26 (внешний аудит) панель рисовала
 * `title`/`descriptions` безусловно, поэтому «Восстание подавлено» при
 * отклонённом примитиве выглядело для игрока ровно как настоящее событие.
 */

const BASE: LlmCycleResult = {
  success: true,
  narrativeCanonized: true,
  appliedActions: [],
  rejectedActions: [],
  primitiveOutcomes: [],
  rejectedPrimitives: [],
};

const outcome = {
  verb: "repress",
  headline: {
    key: "repress.headline",
    values: { addressed: 1, unaffected: 0 },
    names: { region: { ru: "Шяуляй", en: "Šiauliai" } },
  },
  details: [],
};

function renderPanel() {
  render(<LLMPanel llmTurn={3} onApplied={vi.fn()} />);
}

/** Прогоняет автоцикл и дожидается отрисовки его результата. */
async function runAuto(result: LlmCycleResult, waitForText: RegExp) {
  vi.spyOn(gameApi, "runAutoLlmCycle").mockResolvedValue(result);
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: /Сгенерировать и применить/i }));
  await waitFor(() => expect(screen.getByText(waitForText)).toBeTruthy());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LLMPanel — канон отделён от предложенного", () => {
  it("применённый ответ показывается текстом модели и фактическим результатом", async () => {
    await runAuto(
      {
        ...BASE,
        title: "Волнения вспыхнули",
        descriptions: "Три абзаца нарратива.",
        primitiveOutcomes: [outcome],
      },
      /Волнения вспыхнули/
    );

    expect(screen.getByText("Три абзаца нарратива.")).toBeTruthy();
    // Рядом с текстом — что произошло НА САМОМ ДЕЛЕ, локализованным откликом.
    expect(screen.getByRole("heading", { name: /Что произошло на самом деле/ })).toBeTruthy();
    expect(screen.getByText(/Шяуляй/)).toBeTruthy();
  });

  it("полный отказ: вместо нарратива — сообщение о невозможном и причины", async () => {
    // Ровно сценарий аудита: сервер не отдаёт текст, потому что он не стал
    // каноном; панель обязана сказать об этом человеческим языком.
    await runAuto(
      {
        ...BASE,
        narrativeCanonized: false,
        rejectedPrimitives: [
          { verb: "repress", reason: "The director cannot act as the player's country" },
        ],
      },
      /Режиссёр предложил невозможное/
    );

    expect(screen.getByText(/событие не записано/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Отклонено движком/ })).toBeTruthy();
    expect(screen.getByText(/cannot act as the player's country/)).toBeTruthy();
  });

  it("частичное применение: и текст, и то, что было отклонено", async () => {
    // Канон строится по факту, а не по прозе: заголовок остаётся, но рядом с
    // ним видно, что часть предложенного не состоялась.
    await runAuto(
      {
        ...BASE,
        title: "Двойной ход",
        descriptions: "Нарратив.",
        factuality: "partial",
        primitiveOutcomes: [outcome],
        rejectedPrimitives: [{ verb: "enact_reform", reason: "at least one direction" }],
      },
      /Двойной ход/
    );

    expect(screen.getByRole("heading", { name: /Что произошло на самом деле/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Отклонено движком/ })).toBeTruthy();
    expect(screen.getByText(/at least one direction/)).toBeTruthy();
    // Пометка стоит у самого текста: игрок читает его здесь первым, до ленты.
    expect(screen.getByRole("note").textContent).toMatch(/Подтверждено частично/);
  });

  it("чистый нарратив показан как заявление, а не как факт", async () => {
    // Ответ, ничего не предлагавший движку, — законное событие (§4), но
    // подтверждать в нём нечего (решение пользователя 2026-07-27).
    await runAuto(
      { ...BASE, title: "Мир замер", descriptions: "Нарратив.", factuality: "unconfirmed" },
      /Мир замер/
    );

    expect(screen.getByRole("note").textContent).toMatch(/Фактами не подтверждено/);
  });

  it("полностью подтверждённый ответ пометки не несёт", async () => {
    await runAuto(
      {
        ...BASE,
        title: "Волнения вспыхнули",
        descriptions: "Нарратив.",
        factuality: "confirmed",
        primitiveOutcomes: [outcome],
      },
      /Волнения вспыхнули/
    );

    expect(screen.queryByRole("note")).toBeNull();
  });
});
