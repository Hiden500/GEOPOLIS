import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { type Region } from "@shared/types/map/Region";
import { PlayerIntentPanel } from "./PlayerIntentPanel";

/**
 * Синхронизация поля ввода с пропом `intent`.
 *
 * Правило, которое здесь держится: поле следует за пропом, когда намерение
 * пришло извне (загрузка сохранёнки, смена хода), и НЕ теряет то, что игрок
 * набрал сам, пока проп не изменился. Раньше это делал `useEffect`, теперь —
 * сравнение с предыдущим значением во время рендера (react.dev, «You Might Not
 * Need an Effect»); тест написан против поведения, а не против механизма,
 * поэтому переживёт следующую смену реализации.
 */
function regions(): Region[] {
  return [
    {
      id: 1,
      geoJsonId: "GEO-1",
      names: { ru: "Москва", en: "Moscow" },
      ownerCountryId: "SUN",
      neighboringRegionIds: [],
      area: 1,
      population: 1,
      urbanization: 0,
      stability: 50,
      infrastructure: 0,
      development: 0,
      gdp: 1,
      deposits: {},
      extraction: {},
    } as unknown as Region,
  ];
}

describe("PlayerIntentPanel", () => {
  it("подхватывает новое намерение, пришедшее извне", () => {
    const { rerender } = render(
      <PlayerIntentPanel regions={regions()} intent="первое" onSave={vi.fn()} />
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("первое");

    rerender(<PlayerIntentPanel regions={regions()} intent="второе" onSave={vi.fn()} />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("второе");
  });

  it("не затирает набранное игроком, пока проп не менялся", () => {
    const { rerender } = render(
      <PlayerIntentPanel regions={regions()} intent="исходное" onSave={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "я печатаю" } });
    // Родитель перерисовался с ТЕМ ЖЕ намерением — ввод обязан уцелеть.
    rerender(<PlayerIntentPanel regions={regions()} intent="исходное" onSave={vi.fn()} />);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("я печатаю");
  });
});
