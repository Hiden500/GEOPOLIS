import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Country } from "@shared/types/Country";
import "../../i18n";
import { NationalBriefing } from "./NationalBriefing";

const country = {
  goals: [
    { id: "g1", kind: "reach_power_rank", targetRank: 3, completed: false },
    { id: "g2", kind: "control_regions", targetCount: 12, completed: true },
  ],
} as Country;

describe("NationalBriefing", () => {
  it("показывает standing, следующую цель и детерминированный результат хода", () => {
    render(
      <NationalBriefing
        country={country}
        standing={{ power: 123.4, rank: 5, total: 126 }}
        report={{
          fromDate: "1946-01-01",
          toDate: "1946-02-01",
          months: 1,
          changes: [
            { metric: "rank", before: 6, after: 5 },
            { metric: "stability", before: 70, after: 68 },
          ],
          completedGoalIds: ["g2"],
        }}
      />,
    );

    expect(screen.getByText("№5 / 126")).toBeTruthy();
    expect(screen.getByText("Подняться до №3 в рейтинге силы")).toBeTruthy();
    expect(screen.getByText("6 → 5")).toBeTruthy();
    expect(screen.getByText("Выполнено целей за ход: 1")).toBeTruthy();
  });
});
