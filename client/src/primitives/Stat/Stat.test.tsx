import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("название стата уходит в title/aria-label, не в видимый текст (docs/plans/12_UI_REDESIGN.md §2)", () => {
    render(<Stat icon="💰" value="128" label="Казна" />);
    const stat = screen.getByLabelText("Казна");
    expect(stat.getAttribute("title")).toBe("Казна");
    // Видимый текст — только значение, само слово "Казна" на экране не рендерится.
    expect(stat.textContent).toBe("💰128");
  });

  it("value рендерится видимо", () => {
    render(<Stat icon="💰" value="128" label="Казна" />);
    expect(screen.getByText("128")).not.toBeNull();
  });
});
