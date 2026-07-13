import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("выставляет aria-valuenow/min/max по значению", () => {
    render(<Meter value={42} max={100} label="Стабильность" />);
    const meter = screen.getByRole("progressbar", { name: "Стабильность" });
    expect(meter.getAttribute("aria-valuenow")).toBe("42");
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
  });

  it("клампит значение за пределами диапазона (не уезжает за 0/100%)", () => {
    const { container, rerender } = render(<Meter value={150} max={100} label="X" />);
    let fill = container.querySelector('[class*="fill"]') as HTMLElement;
    expect(fill.style.width).toBe("100%");

    rerender(<Meter value={-10} max={100} label="X" />);
    fill = container.querySelector('[class*="fill"]') as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});
