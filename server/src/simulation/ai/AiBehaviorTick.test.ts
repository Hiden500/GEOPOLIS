import { describe, it, expect } from "vitest";
import { aiBehaviorTick } from "./AiBehaviorTick";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { calculateBaseInfluence } from "../diplomacy/DiplomacyTick";
import { THREAT_LEVEL, INFLUENCE_GRAVITY } from "@shared/defines/ai";
import { type Country } from "@shared/types/Country";

// Хелпер: страна с заданным id и переопределением экономики/дипломатии/военки.
function country(id: string, over: Partial<Country> = {}): Country {
  return createTestCountry({ id, ...over });
}

describe("aiBehaviorTick — Правило A (аустерити)", () => {
  // gdp фикстуры = 500B; порог долг/ВВП = 0.6 → долг > 300B триггерит аустерити.
  const HIGH_DEBT = 400_000_000_000;

  it("урезает дискреционные расходы на 5% при дефиците И высоком долге/ВВП", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, debt: HIGH_DEBT },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBeCloseTo(30_000_000_000 * 0.95, 0);
    expect(ai.economy.welfareSpending).toBeCloseTo(15_000_000_000 * 0.95, 0);
  });

  it("не урезает, если бюджет не в дефиците", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: 100, debt: HIGH_DEBT },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBe(30_000_000_000);
  });

  it("не урезает, если долг/ВВП ниже порога (дефицит ещё финансируется без боли)", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, debt: 0 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBe(30_000_000_000);
  });

  it("не урезает ниже пола (50% старта)", () => {
    const ai = country("AI", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, debt: HIGH_DEBT, militarySpending: 15_000_000_000 },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    // 15e9 × 0.95 = 14.25e9 < пол 15e9 → остаётся на полу
    expect(ai.economy.militarySpending).toBe(15_000_000_000);
  });

  it("не трогает страну игрока", () => {
    const player = country("PLAYER", {
      economy: { ...createTestCountry().economy, budgetBalance: -1, debt: HIGH_DEBT },
    });
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player] });

    aiBehaviorTick(game);

    expect(player.economy.militarySpending).toBe(30_000_000_000);
  });
});

describe("aiBehaviorTick — Правило B (угроза)", () => {
  /**
   * ФИКСТУРА ПЕРЕСОБРАНА 2026-07-31 вместе с `calculateBaseInfluence`.
   *
   * Прежняя задавала перевес «×3» и комментировала итог как `30+30+5 = 65`, то
   * есть держала в себе снимок ЛИНЕЙНОЙ формулы. С насыщением по ПОРЯДКУ
   * перевеса тот же ×3 даёт около трёх, и все три теста Правила B проверяли бы
   * невзятую ветку — самый дорогой вид зелёного теста
   * (`.agent/audits/formula-audit-2026-07-30.md`).
   *
   * Поэтому перевес задан ПОРЯДКОМ (×3000 и по армии, и по экономике), а канал
   * связи — стартовым присутствием игрока: без канала перевес значит вчетверо
   * меньше, каким бы он ни был, и порог угрозы не берётся принципиально.
   */
  const CHANNEL_SEED = 5;
  const strongPlayer = (...tiedTo: string[]) =>
    country("PLAYER", {
      military: { ...createTestCountry().military, manpower: 3_000_000 },
      economy: { ...createTestCountry().economy, gdp: 1_500_000_000_000 },
      diplomacy: {
        ...createTestCountry().diplomacy,
        influence: Object.fromEntries(tiedTo.map(id => [id, CHANNEL_SEED])),
      },
    });
  const weakRival = (id: string, relToPlayer: number) =>
    country(id, {
      military: { ...createTestCountry().military, manpower: 1_000 },
      economy: { ...createTestCountry().economy, gdp: 500_000_000 },
      diplomacy: { ...createTestCountry().diplomacy, relations: { PLAYER: relToPlayer } },
    });

  it("балансировка: соперник под угрозой наращивает military (×1.05, в пределах потолка)", () => {
    const rival = weakRival("RIVAL", -20);
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer("RIVAL"), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.militarySpending).toBeCloseTo(30_000_000_000 * 1.05, 0);
  });

  it("балансировка: со-угрожаемые соперники сближаются (контр-блок, +5 обоюдно)", () => {
    const a = weakRival("A", -10);
    const b = weakRival("B", -10);
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer("A", "B"), a, b] });

    aiBehaviorTick(game);

    expect(a.diplomacy.relations["B"]).toBe(5);
    expect(b.diplomacy.relations["A"]).toBe(5);
  });

  it("бандвагонинг: дружественная угрожаемая страна → растёт влияние игрока над ней", () => {
    const friendly = weakRival("FRIEND", 10); // rel ≥ 0
    const player = strongPlayer("FRIEND");
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, friendly] });

    // Ожидание считается ОТ ФОРМУЛЫ доминирования, а не литералом «6,5»: литерал
    // был снимком линейной шкалы и пережил бы любую её перекалибровку молча.
    // Проверяется здесь ставка сближения, а величина цели — дело
    // `influenceSaturation.test.ts`.
    const dominance = calculateBaseInfluence(player, friendly);
    expect(dominance).toBeGreaterThan(THREAT_LEVEL); // ветка вообще берётся

    aiBehaviorTick(game);

    expect(player.diplomacy.influence["FRIEND"]).toBeCloseTo(
      CHANNEL_SEED + (dominance - CHANNEL_SEED) * INFLUENCE_GRAVITY,
      6
    );
    // военного билд-апа против игрока нет
    expect(friendly.economy.militarySpending).toBe(30_000_000_000);
  });

  it("союзник игрока не считается угрожаемым (нет билд-апа)", () => {
    const ally = weakRival("ALLY", -50); // даже при плохом отношении
    const player = strongPlayer("ALLY");
    player.diplomacy.allies = ["ALLY"];
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, ally] });

    aiBehaviorTick(game);

    expect(ally.economy.militarySpending).toBe(30_000_000_000);
  });

  it("ниже порога угрозы (равные силы) — ничего не происходит", () => {
    const peer = country("PEER", {
      diplomacy: { ...createTestCountry().diplomacy, relations: { PLAYER: -50 } },
    });
    const player = country("PLAYER"); // равные силы и ни одного канала → dom ≪ 50
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player, peer] });

    aiBehaviorTick(game);

    expect(peer.economy.militarySpending).toBe(30_000_000_000);
    expect(peer.diplomacy.relations["PLAYER"]).toBe(-50);
  });

  it("military не превышает потолок 40% дохода", () => {
    // income фикстуры = 100+50+20+10 = 180e9 → потолок 72e9. Старт уже у потолка.
    const rival = weakRival("RIVAL", -20);
    rival.economy.militarySpending = 72_000_000_000;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer("RIVAL"), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.militarySpending).toBe(72_000_000_000);
  });
});

describe("aiBehaviorTick — Правило C (низкая stability → welfare)", () => {
  function unstableAI(stability: number): Country {
    const c = country("AI");
    c.politics.stability = stability;
    // income = taxRevenue (1000) + exportIncome (500) + stateEnterprise (200) + other (100) = 1800
    c.economy.taxRevenue = 1000;
    c.economy.exportIncome = 500;
    c.economy.stateEnterpriseIncome = 200;
    c.economy.otherIncome = 100;
    c.economy.militarySpending = 500;
    c.economy.welfareSpending = 100;
    c.economy.spendingFloor = {
      militarySpending: 200,
      researchSpending: 50,
      educationSpending: 50,
      infrastructureSpending: 50,
      welfareSpending: 50,
    };
    return c;
  }

  it("при stability < 40 переносит расходы с military на welfare", () => {
    const ai = unstableAI(30);
    const milBefore = ai.economy.militarySpending;
    const welfareBefore = ai.economy.welfareSpending;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBeLessThan(milBefore);
    expect(ai.economy.welfareSpending).toBeGreaterThan(welfareBefore);
  });

  it("перевод military → welfare равен по сумме (zero-sum)", () => {
    const ai = unstableAI(30);
    const totalBefore = ai.economy.militarySpending + ai.economy.welfareSpending;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    const totalAfter = ai.economy.militarySpending + ai.economy.welfareSpending;
    expect(totalAfter).toBeCloseTo(totalBefore, 5);
  });

  it("при stability >= 40 нудж не срабатывает", () => {
    const ai = unstableAI(40);
    const milBefore = ai.economy.militarySpending;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBe(milBefore);
  });

  it("military не опускается ниже пола", () => {
    const ai = unstableAI(10);
    ai.economy.militarySpending = ai.economy.spendingFloor!.militarySpending + 1; // почти у пола
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBeGreaterThanOrEqual(ai.economy.spendingFloor!.militarySpending);
  });

  it("welfare не превышает 30% дохода", () => {
    const ai = unstableAI(10);
    const income = 1800;
    ai.economy.welfareSpending = income * 0.30 - 1; // почти у потолка
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.welfareSpending).toBeLessThanOrEqual(income * 0.30 + 0.001);
  });

  it("не трогает страну игрока", () => {
    const player = unstableAI(10);
    player.id = "PLAYER";
    const milBefore = player.economy.militarySpending;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [player] });

    aiBehaviorTick(game);

    expect(player.economy.militarySpending).toBe(milBefore);
  });

  it("модификатор stability учитывается в effectiveValue: раw stability >= порога, но модификатор опускает эффективное значение ниже — нудж срабатывает (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2)", () => {
    const ai = unstableAI(45); // raw >= STABILITY_LOW(40) — без модификатора нудж не сработал бы
    const milBefore = ai.economy.militarySpending;
    const game = createTestGameState({
      playerCountryId: "PLAYER",
      countries: [country("PLAYER"), ai],
      modifiers: [{
        id: "mod-000000",
        source: "event:coup",
        target: { kind: "country", id: "AI" },
        attribute: "stability",
        op: "add",
        value: -10, // effective = 45 - 10 = 35 < 40
      }],
    });

    aiBehaviorTick(game);

    expect(ai.economy.militarySpending).toBeLessThan(milBefore);
  });
});

describe("aiBehaviorTick — войну не объявляет никто, кроме игрока и LLM", () => {
  /**
   * Правило D удалено 2026-07-31 (разбор — в `AiBehaviorTick.ts`). Шесть его
   * тестов сняты вместе с ним, а на их место встал ОДИН инвариант обратного
   * свойства: сколько ни давай ИИ поводов, детерминированный тик войну не
   * начинает.
   *
   * Условия ниже — ровно те, при которых прежнее правило гарантированно
   * стреляло: соперники, отношения на дне шкалы, многократный перевес армии,
   * оба non-major, максимальная агрессивность. Тест падает, если правило
   * вернут, — а вернуть его случайно легко, потому что `declareWar` доступен
   * из тика одной строкой.
   */
  it("не объявляет войну даже при всех предпосылках прежнего Правила D", () => {
    const a = country("A", {
      tier: "minor",
      military: { ...createTestCountry().military, activePersonnel: 1_000_000 },
      diplomacy: { ...createTestCountry().diplomacy, rivals: ["B"], relations: { B: -100 } },
      aiTraits: { aggressiveness: 1.4, riskTolerance: 1.4 },
    });
    const b = country("B", {
      tier: "minor",
      military: { ...createTestCountry().military, activePersonnel: 1 },
    });
    const game = createTestGameState({
      playerCountryId: "PLAYER",
      countries: [country("PLAYER"), a, b],
    });

    for (let month = 0; month < 12; month++) aiBehaviorTick(game);

    expect(game.wars).toHaveLength(0);
  });
});
