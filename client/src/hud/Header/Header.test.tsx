import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Country } from "@shared/types/Country";
import "../../i18n";
import { Header } from "./Header";

const country = {
  id: "TEST",
  color: "#334455",
  population: 10_000_000,
  economy: { gdp: 500_000_000_000, treasury: 50_000_000_000 },
  military: { manpower: 1_000_000 },
  politics: { stability: 70, legitimacy: 60 },
  stockpile: {},
} as Country;

function renderHeader(llmRespondedThisTurn: boolean, reset = vi.fn()) {
  return render(
    <Header
      country={country}
      currentDate="1946-01-01"
      llmTurn={1}
      llmRespondedThisTurn={llmRespondedThisTurn}
      loading={false}
      activeBook={null}
      onTabClick={vi.fn()}
      onNextTurn={vi.fn()}
      onOpenLlmCycle={vi.fn()}
      onOpenCountryOverview={vi.fn()}
      onOpenOnboarding={vi.fn()}
      onResetWindowLayout={reset}
      onBackToMenu={vi.fn()}
    />,
  );
}

describe("Header turn gate", () => {
  it("блокирует следующий ход и объясняет причину до ответа LLM", () => {
    renderHeader(false);

    const button = screen.getByRole("button", { name: "Следующий ход" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Сначала завершите ручной или автоматический LLM-цикл");
  });

  it("разблокирует следующий ход после ответа LLM и даёт сбросить окна", () => {
    const reset = vi.fn();
    renderHeader(true, reset);

    expect((screen.getByRole("button", { name: "Следующий ход" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Сбросить расположение окон" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
