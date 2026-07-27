import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import "../i18n";
import { PrimitiveOrdersPanel } from "./PrimitiveOrdersPanel";
import * as gameApi from "../api/gameApi";
import { type ApplyPrimitivesResult } from "../api/gameApi";

/**
 * Путь игрока (docs/PRIMITIVES.md §1): свободный текст → показ распознанного →
 * подтверждение → применение; быстрые кнопки — без перевода. Плюс два
 * требования к тексту: игрок не видит имён примитивов, а отказ показывается
 * человеческим языком.
 */

const applied: ApplyPrimitivesResult = {
  duplicate: false,
  outcomes: [
    {
      verb: "repress",
      headline: {
        key: "repress.headline",
        values: { addressed: 2, unaffected: 1 },
        names: { region: { ru: "Шяуляй", en: "Šiauliai" } },
      },
      details: [
        {
          key: "impact.suppression.changed",
          values: { delta: "+0.420", before: "0.000", after: "0.420" },
          names: { group: { ru: "Русские", en: "Russians" } },
        },
        {
          key: "impact.suppression.unchanged",
          values: { value: "1.000" },
          names: { group: { ru: "Литовцы", en: "Lithuanians" } },
        },
      ],
    },
  ],
  rejected: [],
};

const FIRST_TURN = "1946-02-01";

function renderPanel(selectedRegionId: number | null = 187) {
  const onApplied = vi.fn();
  const { rerender } = render(
    <PrimitiveOrdersPanel
      playerCountryId="SUN"
      selectedRegionId={selectedRegionId}
      currentDate={FIRST_TURN}
      onApplied={onApplied}
    />
  );
  /** Смена игрового месяца без перемонтирования — как в живом интерфейсе. */
  const advanceTo = (currentDate: string) =>
    rerender(
      <PrimitiveOrdersPanel
        playerCountryId="SUN"
        selectedRegionId={selectedRegionId}
        currentDate={currentDate}
        onApplied={onApplied}
      />
    );
  return { onApplied, advanceTo };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrimitiveOrdersPanel — быстрые кнопки", () => {
  it("кнопка отправляет примитив напрямую и показывает фактический результат", async () => {
    const apply = vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue(applied);
    const { onApplied } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const [primitives] = apply.mock.calls[0]!;
    expect(primitives).toEqual([
      {
        verb: "repress",
        sourceCountryId: "SUN",
        target: { regionId: 187 },
        params: { intensity: "moderate" },
      },
    ]);

    // Числа в тексте — те самые, что вернул движок; переформатирования нет.
    expect(await screen.findByText(/\+0\.420/)).toBeTruthy();
    // Цель с нулевой дельтой не выпадает из текста (docs/PRIMITIVES.md §4).
    expect(screen.getByText(/Литовцы.*без изменений|без изменений.*Литовцы/)).toBeTruthy();
    expect(onApplied).toHaveBeenCalled();
  });

  it("без выделенного своего региона региональные кнопки не предлагаются", () => {
    renderPanel(null);

    expect(screen.queryByRole("button", { name: "Подавить" })).toBeNull();
    expect(screen.getByText(/Выберите на карте свой регион/)).toBeTruthy();
    // Реформа общегосударственная — она доступна и без выделения.
    expect(screen.getByRole("button", { name: /Реформа: смягчить курс/ })).toBeTruthy();
  });

  it("реформа адресуется своей стране — источник и цель совпадают", async () => {
    const apply = vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue({
      duplicate: false,
      outcomes: [],
      rejected: [],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Реформа: ужесточить курс/ }));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0]![0]).toEqual([
      {
        verb: "enact_reform",
        sourceCountryId: "SUN",
        target: { countryId: "SUN" },
        params: { politicalDirection: "authoritarian", intensity: "moderate" },
      },
    ]);
  });

  it("разные приказы несут разные ключи идемпотентности", async () => {
    const apply = vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue({
      duplicate: false,
      outcomes: [],
      rejected: [],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Дать автономию" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    const [, firstKey] = apply.mock.calls[0]!;
    const [, secondKey] = apply.mock.calls[1]!;
    expect(firstKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("повтор той же кнопки ПОСЛЕ СБОЯ несёт тот же ключ — сервер узнает ретрай", async () => {
    // Сценарий, который прежний тест («каждый приказ несёт свой ключ»)
    // закреплял как норму: приказ применился, ответ потерялся в сети, игрок
    // видит «Не удалось» и жмёт ту же кнопку снова. С новым ключом сервер
    // считает это вторым приказом и применяет ещё раз.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const apply = vi
      .spyOn(gameApi, "applyPrimitives")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ duplicate: true, outcomes: [], rejected: [] });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    expect(apply.mock.calls[1]![1]).toBe(apply.mock.calls[0]![1]);
  });

  it("осознанный второй приказ после УСПЕХА несёт новый ключ — это не ретрай", async () => {
    // Обратная половина: дошедший запрос ключ освобождает. Иначе второй приказ
    // того же вида молча превращался бы в «дубль» на клиенте, и игрок не узнал
    // бы настоящую причину отказа — кап хода (docs/PRIMITIVES.md §4).
    const apply = vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue({
      duplicate: false,
      outcomes: [],
      rejected: [],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    expect(apply.mock.calls[1]![1]).not.toBe(apply.mock.calls[0]![1]);
  });

  it("ключ не переезжает в следующий ход — иначе законный приказ месяца проглотят как дубль", async () => {
    // Найдено ревью 2026-07-26. Панель не перемонтируется при смене месяца,
    // поэтому ключ, удержанный после сетевого сбоя в феврале, переиспользовался
    // в марте. Журнал ключей на сервере кольцевой (32 записи), февральский ключ
    // там ещё лежит — и мартовский приказ, законный по бюджету хода, вернулся бы
    // как «уже отдан».
    vi.spyOn(console, "error").mockImplementation(() => {});
    const apply = vi
      .spyOn(gameApi, "applyPrimitives")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ duplicate: false, outcomes: [], rejected: [] });
    const { advanceTo } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");

    advanceTo("1946-03-01");
    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    expect(apply.mock.calls[1]![1]).not.toBe(apply.mock.calls[0]![1]);
  });

  it("в ПРЕДЕЛАХ хода ключ по-прежнему держится: перерисовка — не новый ход", async () => {
    // Обратная половина: чистка привязана к дате, а не к любому обновлению
    // пропсов, иначе она снимала бы защиту от ретрая на каждой перерисовке.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const apply = vi
      .spyOn(gameApi, "applyPrimitives")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ duplicate: true, outcomes: [], rejected: [] });
    const { advanceTo } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");

    advanceTo(FIRST_TURN);
    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

    expect(apply.mock.calls[1]![1]).toBe(apply.mock.calls[0]![1]);
  });
});

describe("PrimitiveOrdersPanel — свободный текст", () => {
  it("показывает распознанное и применяет только после подтверждения", async () => {
    const translate = vi.spyOn(gameApi, "translatePlayerOrder").mockResolvedValue({
      primitives: [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: 187 } }],
      preview: [
        {
          verb: "repress",
          headline: {
            key: "preview.repress.region",
            names: { region: { ru: "Шяуляй", en: "Šiauliai" } },
          },
          details: [{ key: "preview.intensity.severe" }],
        },
      ],
      invalid: [],
    });
    const apply = vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue(applied);
    renderPanel();

    fireEvent.change(screen.getByLabelText("Текст приказа"), { target: { value: "жёстко подавить волнения" } });
    fireEvent.click(screen.getByRole("button", { name: "Распознать приказ" }));

    await waitFor(() => expect(translate).toHaveBeenCalledWith("жёстко подавить волнения", 187));
    // Распознанное показано, но НИЧЕГО ещё не применено.
    expect(screen.getByText(/Подавить волнения во всём регионе Шяуляй/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить и выполнить" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it("отмена не применяет ничего", async () => {
    vi.spyOn(gameApi, "translatePlayerOrder").mockResolvedValue({
      primitives: [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: 187 } }],
      preview: [
        { verb: "repress", headline: { key: "preview.repress.region", names: {} }, details: [] },
      ],
      invalid: [],
    });
    const apply = vi.spyOn(gameApi, "applyPrimitives");
    renderPanel();

    fireEvent.change(screen.getByLabelText("Текст приказа"), { target: { value: "подавить" } });
    fireEvent.click(screen.getByRole("button", { name: "Распознать приказ" }));
    await screen.findByRole("button", { name: "Отмена" });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(apply).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Подтвердить и выполнить" })).toBeNull();
  });

  it("текст без приказа честно сообщает, что распознавать нечего", async () => {
    vi.spyOn(gameApi, "translatePlayerOrder").mockResolvedValue({
      primitives: [],
      preview: [],
      invalid: [],
    });
    renderPanel();

    fireEvent.change(screen.getByLabelText("Текст приказа"), { target: { value: "хочу мира во всём мире" } });
    fireEvent.click(screen.getByRole("button", { name: "Распознать приказ" }));

    expect(await screen.findByText(/не нашлось приказа/)).toBeTruthy();
  });
});

describe("PrimitiveOrdersPanel — отказы и повторы", () => {
  it("отказ показан человеческим языком, без кода примитива", async () => {
    vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue({
      duplicate: false,
      outcomes: [],
      rejected: [
        {
          verb: "spawn_incident",
          reason: "Discontent 0.41 in Šiauliai is enough for a protest but below the 0.65",
        },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));

    const rejection = await screen.findByText(/Не удалось: инцидент/);
    expect(rejection).toBeTruthy();
    // Имя глагола движка игроку не показывается (докs/PRIMITIVES.md §1).
    expect(screen.queryByText(/spawn_incident/)).toBeNull();
  });

  it("повтор уже применённого приказа сообщается прямо, а не как «ничего не произошло»", async () => {
    vi.spyOn(gameApi, "applyPrimitives").mockResolvedValue({
      duplicate: true,
      outcomes: [],
      rejected: [],
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Подавить" }));

    expect(await screen.findByText(/уже был выполнен/)).toBeTruthy();
  });

  it("ошибка перевода объясняется игроку, а не выглядит как пустой ответ", async () => {
    vi.spyOn(gameApi, "translatePlayerOrder").mockRejectedValue(new Error("502"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPanel();

    fireEvent.change(screen.getByLabelText("Текст приказа"), { target: { value: "подавить" } });
    fireEvent.click(screen.getByRole("button", { name: "Распознать приказ" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
