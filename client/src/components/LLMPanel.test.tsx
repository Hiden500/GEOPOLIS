import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import "../i18n";
import { LLMPanel } from "./LLMPanel";
import * as gameApi from "../api/gameApi";
import { type LlmCycleResult } from "../api/gameApi";
import { emptyResponseReceipt } from "@shared/types/ResponseReceipt";

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
  receipt: emptyResponseReceipt("1946-03-01"),
};

/** Квитанция поверх пустой: тесты меняют по одному каналу за раз. */
function receipt(patch: {
  factuality?: LlmCycleResult["receipt"]["factuality"];
  applied?: LlmCycleResult["receipt"]["primitives"]["applied"];
  rejected?: LlmCycleResult["receipt"]["primitives"]["rejected"];
}): LlmCycleResult["receipt"] {
  return {
    ...emptyResponseReceipt("1946-03-01"),
    ...(patch.factuality ? { factuality: patch.factuality } : {}),
    primitives: { applied: patch.applied ?? [], rejected: patch.rejected ?? [] },
  };
}

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
        receipt: receipt({ applied: [outcome] }),
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
        receipt: receipt({
          rejected: [{ verb: "repress", code: "agencyPlayerDecision", names: {} }],
        }),
      },
      /Режиссёр предложил невозможное/
    );

    expect(screen.getByText(/событие не записано/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Отклонено движком/ })).toBeTruthy();
    // Причина — по-русски: сервер прислал код отказа, локаль подставил клиент
    // (Милстоун 1). Раньше здесь стояла английская строка движка.
    expect(screen.getByText(/решение принимает/)).toBeTruthy();
  });

  it("частичное применение: и текст, и то, что было отклонено", async () => {
    // Канон строится по факту, а не по прозе: заголовок остаётся, но рядом с
    // ним видно, что часть предложенного не состоялась.
    await runAuto(
      {
        ...BASE,
        title: "Двойной ход",
        descriptions: "Нарратив.",
        receipt: receipt({
          factuality: "partial",
          applied: [outcome],
          rejected: [{ verb: "enact_reform", code: "reformNoDirection", names: {} }],
        }),
      },
      /Двойной ход/
    );

    expect(screen.getByRole("heading", { name: /Что произошло на самом деле/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Отклонено движком/ })).toBeTruthy();
    // Причина показана ЛОКАЛИЗОВАННОЙ: клиент рендерит код, а не английскую
    // строку движка (Милстоун 1).
    expect(screen.getByText(/не указывает ни одного направления/)).toBeTruthy();
    // Пометка стоит у самого текста: игрок читает его здесь первым, до ленты.
    expect(screen.getByRole("note").textContent).toMatch(/Подтверждено частично/);
  });

  it("чистый нарратив показан как заявление, а не как факт", async () => {
    // Ответ, ничего не предлагавший движку, — законное событие (§4), но
    // подтверждать в нём нечего (решение пользователя 2026-07-27).
    await runAuto(
      {
        ...BASE,
        title: "Мир замер",
        descriptions: "Нарратив.",
        receipt: receipt({ factuality: "unconfirmed" }),
      },
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
        receipt: receipt({ factuality: "confirmed", applied: [outcome] }),
      },
      /Волнения вспыхнули/
    );

    expect(screen.queryByRole("note")).toBeNull();
  });
});

/**
 * Словарь причин отказа против кодов, которые сервер реально присылает.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ БЛОК. Забытый ключ словаря не роняет ни тип, ни сборку:
 * `react-i18next` подставляет САМ КЛЮЧ, и игрок читает
 * «guaranteeAlreadyGiven» вместо объяснения. Проверять это глазами в браузере
 * ненадёжно — код отказа появляется только на конкретном состоянии мира,
 * поэтому проверка живёт тестом и перечисляет коды поимённо.
 *
 * Список — коды воздействий, переехавших из старого канала `actions`
 * (2026-08-02): именно у них словарь пополнялся, а значит именно они могли
 * остаться без перевода.
 */
describe("LLMPanel — новые коды отказа переведены, а не показаны ключом", () => {
  const MIGRATED_CODES = [
    "guaranteeAlreadyGiven",
    "focusNotDomestic",
    "unknownResearchDomain",
    "unknownEquipmentType",
    "noDepositInRegion",
    "extractionAtMaximum",
    "noExtractionToDismantle",
    "extractionUnaffordable",
    "legacyActionsChannel",
  ] as const;

  for (const code of MIGRATED_CODES) {
    it(`${code} рендерится человеческим текстом`, async () => {
      await runAuto(
        {
          ...BASE,
          narrativeCanonized: false,
          receipt: receipt({
            rejected: [
              {
                code,
                // Значения и имена даёт сервер; здесь важно лишь то, что
                // подстановка происходит и ключ не протекает наружу.
                values: {
                  domain: "armor",
                  equipmentType: "tanks",
                  resource: "coal",
                  level: 10,
                  max: 10,
                  cost: 2,
                  treasury: 1,
                  verb: "research_shift",
                  count: 3,
                },
                names: {
                  source: { ru: "СССР", en: "USSR" },
                  target: { ru: "Албания", en: "Albania" },
                  country: { ru: "Албания", en: "Albania" },
                  region: { ru: "Шяуляй", en: "Šiauliai" },
                },
              },
            ],
          }),
        },
        /Отклонено движком/
      );

      const list = screen.getByRole("heading", { name: /Отклонено движком/ })
        .parentElement!.textContent!;
      // Ключ наружу не протёк — значит перевод найден.
      expect(list).not.toContain(code);
      // И это не пустая строка: у причины есть текст.
      expect(list.replace(/Отклонено движком/, "").trim().length).toBeGreaterThan(10);
    });
  }
});
