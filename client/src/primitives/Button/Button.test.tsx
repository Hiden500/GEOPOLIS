import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("вызывает onClick при клике", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Ход</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Ход" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled блокирует клик", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Ход
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ход" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("type по умолчанию — button, не submit (не должен сабмитить форму)", () => {
    render(<Button>Ход</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});
