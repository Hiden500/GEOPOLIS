import { describe, it, expect } from "vitest";
import { aiBehaviorTick } from "./AiBehaviorTick";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { type Country } from "@shared/types/Country";

// Хелпер: страна с заданным id и переопределением экономики/дипломатии/военки.
function country(id: string, over: Partial<Country> = {}): Country {
  return createTestCountry({ id, ...over });
}

describe("aiBehaviorTick — Правило A (аустерити)", () => {
  it("урезает дискреционные расходы на 5% при дефиците и отрицательной казне", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, treasury: -1 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBeCloseTo(30_000_000_000 * 0.95, 0);
    expect(ai.economy.welfareSpending).toBeCloseTo(15_000_000_000 * 0.95, 0);
  });

  it("не урезает, если бюджет не в дефиците", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: 100, treasury: -1 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBe(30_000_000_000);
  });

  it("не урезает, если казна неотрицательна (есть резервы)", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, treasury: 100 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBe(30_000_000_000);
  });

  it("не урезает ниже пола (50% старта)", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, treasury: -1, militarySpending: 15_000_000_000 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    // 15e9 × 0.95 = 14.25e9 < пол 15e9 → остаётся на полу
    expect(ai.economy.militarySpending).toBe(15_000_000_000);
  });

  it("не трогает страну игрока", () => {
    const player = country("PLAYER", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, treasury: -1 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player] });

    aiBehaviorTick(game);

    expect(player.economy.militarySpending).toBe(30_000_000_000);
  });
});

describe("aiBehaviorTick — Правило B (угроза)", () => {
  // Игрок ~×3 по манпаверу и ВВП → dom = 30+30+5 = 65 > порога 50.
  const strongPlayer = () =>
    country("PLAYER", {
      military: { ...createTestCountry().military, manpower: 3_000_000 },
      economy: { ...createTestCountry().economy, gdp: 1_500_000_000_000 },
    });
  const weakRival = (id: string, relToPlayer: number) =>
    country(id, {
      military: { ...createTestCountry().military, manpower: 1_000_000 },
      economy: { ...createTestCountry().economy, gdp: 500_000_000_000 },
      diplomacy: { ...createTestCountry().diplomacy, relations: { PLAYER: relToPlayer } },
    });

  it("балансировка: соперник под угрозой наращивает military (×1.05, в пределах потолка)", () => {
    const rival = weakRival("RIVAL", -20);
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer(), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.militarySpending).toBeCloseTo(30_000_000_000 * 1.05, 0);
  });

  it("балансировка: со-угрожаемые соперники сближаются (контр-блок, +5 обоюдно)", () => {
    const a = weakRival("A", -10);
    const b = weakRival("B", -10);
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer(), a, b] });

    aiBehaviorTick(game);

    expect(a.diplomacy.relations["B"]).toBe(5);
    expect(b.diplomacy.relations["A"]).toBe(5);
  });

  it("бандвагонинг: дружественная угрожаемая страна → растёт влияние игрока над ней", () => {
    const friendly = weakRival("FRIEND", 10); // rel ≥ 0
    const player = strongPlayer();
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, friendly] });

    aiBehaviorTick(game);

    // influence: 0 + (dom 65 − 0) × 0.1 = 6.5
    expect(player.diplomacy.influence["FRIEND"]).toBeCloseTo(6.5, 1);
    // военного билд-апа против игрока нет
    expect(friendly.economy.militarySpending).toBe(30_000_000_000);
  });

  it("союзник игрока не считается угрожаемым (нет билд-апа)", () => {
    const ally = weakRival("ALLY", -50); // даже при плохом отношении
    const player = strongPlayer();
    player.diplomacy.allies = ["ALLY"];
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, ally] });

    aiBehaviorTick(game);

    expect(ally.economy.militarySpending).toBe(30_000_000_000);
  });

  it("ниже порога угрозы (равные силы) — ничего не происходит", () => {
    const peer = country("PEER", {
      diplomacy: { ...createTestCountry().diplomacy, relations: { PLAYER: -50 } },
    });
    const player = country("PLAYER"); // равные → dom ≈ 25 < 50
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, peer] });

    aiBehaviorTick(game);

    expect(peer.economy.militarySpending).toBe(30_000_000_000);
    expect(peer.diplomacy.relations["PLAYER"]).toBe(-50);
  });

  it("military не превышает потолок 40% дохода", () => {
    // income фикстуры = 100+50+20+10 = 180e9 → потолок 72e9. Старт уже у потолка.
    const rival = weakRival("RIVAL", -20);
    rival.economy.militarySpending = 72_000_000_000;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer(), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.militarySpending).toBe(72_000_000_000);
  });
});
