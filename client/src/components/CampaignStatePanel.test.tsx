import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import "../i18n";
import { type GameState } from "@shared/types/GameState";
import { CampaignStatePanel } from "./CampaignStatePanel";
import * as gameApi from "../api/gameApi";

/**
 * Состояние кампании в интерфейсе (docs/CONCEPT.md §6, §7.1).
 *
 * Проверяются три границы, каждая — правило, а не оформление: активная партия
 * панели не показывает; распад ПРЕДЛАГАЕТ выбор, а не делает его; поражение
 * называет причину, а не печатает код.
 */
function stateWith(campaign: GameState["campaign"]): GameState {
  return {
    campaign,
    countries: [
      { id: "LIT", name: { ru: "Литовцы", en: "Lithuanians" } },
      { id: "RUS", name: { ru: "Русские", en: "Russians" } },
    ],
    regions: [
      { id: 1, ownerCountryId: "LIT" },
      { id: 2, ownerCountryId: "LIT" },
      { id: 3, ownerCountryId: "RUS" },
    ],
  } as unknown as GameState;
}

describe("CampaignStatePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("активная кампания не показывает ничего — панель не занимает место без причины", () => {
    const { container } = render(
      <CampaignStatePanel game={stateWith({ status: "active" })} onChosen={vi.fn()} />
    );
    expect(container.textContent).toBe("");
  });

  it("распад предлагает выбор осколка и называет предшественника", () => {
    render(
      <CampaignStatePanel
        game={stateWith({
          status: "succession_choice_pending",
          predecessor: { ru: "СССР", en: "USSR" },
          successorCountryIds: ["LIT", "RUS"],
          since: "1946-03-01",
        })}
        onChosen={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog").textContent).toMatch(/СССР/);
    // Осколков ровно столько, сколько объявил движок, — панель их не выдумывает
    // и не отфильтровывает.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("выбор уходит на сервер и сообщает вызывающему, а не решает сам", () => {
    const choose = vi
      .spyOn(gameApi, "chooseSuccessor")
      .mockResolvedValue({ playerCountryId: "RUS" });
    const onChosen = vi.fn();

    render(
      <CampaignStatePanel
        game={stateWith({
          status: "succession_choice_pending",
          predecessor: { ru: "СССР", en: "USSR" },
          successorCountryIds: ["LIT", "RUS"],
          since: "1946-03-01",
        })}
        onChosen={onChosen}
      />
    );

    fireEvent.click(screen.getAllByRole("button")[1]!);

    return waitFor(() => {
      expect(choose).toHaveBeenCalledWith("RUS");
      expect(onChosen).toHaveBeenCalled();
    });
  });

  it("поражение называет ПРИЧИНУ человеческим текстом, а не кодом", () => {
    render(
      <CampaignStatePanel
        game={stateWith({
          status: "defeated",
          reason: { code: "absorbed", by: { ru: "США", en: "USA" } },
          since: "1949-08-01",
        })}
        onChosen={vi.fn()}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/США/);
    expect(alert.textContent).not.toMatch(/absorbed/);
  });
});
