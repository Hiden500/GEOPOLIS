import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("aria-pressed отражает active", () => {
    const { rerender } = render(
      <IconButton aria-label="Легенда">L</IconButton>,
    );
    expect(screen.getByRole("button", { name: "Легенда" }).getAttribute("aria-pressed")).toBe("false");

    rerender(
      <IconButton aria-label="Легенда" active>
        L
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Легенда" }).getAttribute("aria-pressed")).toBe("true");
  });
});
