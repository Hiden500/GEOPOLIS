import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../../i18n";
import { Onboarding } from "./Onboarding";
import { ONBOARDING_STORAGE_KEY, shouldStartOnboarding } from "./onboardingState";

function renderTour(onClose = vi.fn()) {
  render(
    <>
      <div data-onboarding="stats" />
      <div data-onboarding="books" />
      <div data-onboarding="llm" />
      <div data-onboarding="orders" />
      <div data-onboarding="turn" />
      <Onboarding open onClose={onClose} />
    </>,
  );
  return onClose;
}

describe("Onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("автоматически нужен только до первого завершения", () => {
    expect(shouldStartOnboarding()).toBe(true);
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    expect(shouldStartOnboarding()).toBe(false);
  });

  it("объясняет все шесть статов на первом шаге", () => {
    renderTour();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("ВВП")).toBeTruthy();
    expect(screen.getByText("Казна")).toBeTruthy();
    expect(screen.getByText("Население")).toBeTruthy();
    expect(screen.getByText("Военный ресурс")).toBeTruthy();
    expect(screen.getByText("Стабильность")).toBeTruthy();
    expect(screen.getByText("Легитимность")).toBeTruthy();
  });

  it("проходит пять шагов и сохраняет завершение", () => {
    const onClose = renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText("Разделы управления")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText("Статус хода")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    expect(screen.getByText("Ваши приказы")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));

    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("complete");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("закрывается по Escape и не навязывается снова", () => {
    const onClose = renderTour();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("complete");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
