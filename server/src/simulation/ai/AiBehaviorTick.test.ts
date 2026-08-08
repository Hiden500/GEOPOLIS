import { describe, it, expect } from "vitest";
import { aiBehaviorTick } from "./AiBehaviorTick";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { calculateBaseInfluence } from "../diplomacy/DiplomacyTick";
import {
  THREAT_LEVEL,
  INFLUENCE_GRAVITY,
  MILITARY_CAP_SHARE,
  WELFARE_SHIFT_RATE,
  AUSTERITY_RESTORE,
  AUSTERITY_RECOVERY_SURPLUS_MARGIN,
} from "@shared/defines/ai";
import { DEBT_GDP_PENALTY_THRESHOLD } from "@shared/defines/economy";
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

    // Режется ДОЛЯ (2026-08-01): сумма — производная от неё и от дохода,
    // поэтому проверять надо источник, а не следствие.
    expect(ai.economy.spendingShares!.military).toBeCloseTo((30 / 180) * 0.95, 6);
    expect(ai.economy.spendingShares!.welfare).toBeCloseTo((15 / 180) * 0.95, 6);
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
      economy: { ...createTestCountry().economy, budgetBalance: -1, debt: HIGH_DEBT },
    });
    const floor = ai.economy.spendingFloor!.militarySpending;
    ai.economy.spendingShares!.military = floor; // уже на полу
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [ai] });

    aiBehaviorTick(game);

    // floor × 0.95 < floor → остаётся на полу
    expect(ai.economy.spendingShares!.military).toBeCloseTo(floor, 9);
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

describe("aiBehaviorTick — Правило A, обратный ход (восстановление после аустерити, 2026-08-02)", () => {
  // Доход фикстуры = 180e9; порог запаса профицита — доля этого дохода.
  const INCOME = 180_000_000_000;
  const MARGIN = AUSTERITY_RECOVERY_SURPLUS_MARGIN * INCOME;

  /**
   * Страна после аустерити: все пять дискреционных долей дорезаны до пола
   * (50% старта). stability — в гистерезисной зоне Правила C (40…45), чтобы
   * его сдвиги не примешивались к проверяемому обратному ходу Правила A.
   */
  function austereAI(economyOver: Partial<Country["economy"]> = {}): Country {
    const c = country("AI");
    c.politics.stability = 42;
    const shares = c.economy.spendingShares!;
    for (const k of Object.keys(shares) as (keyof typeof shares)[]) shares[k] *= 0.5;
    Object.assign(c.economy, { budgetBalance: MARGIN, debt: 0 }, economyOver);
    return c;
  }

  it("при профиците с запасом и долге ниже порога все доли растут на +5%", () => {
    const ai = austereAI();
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.education).toBeCloseTo((20 / 180) * 0.5 * AUSTERITY_RESTORE, 9);
    expect(ai.economy.spendingShares!.military).toBeCloseTo((30 / 180) * 0.5 * AUSTERITY_RESTORE, 9);
    expect(ai.economy.spendingShares!.welfare).toBeCloseTo((15 / 180) * 0.5 * AUSTERITY_RESTORE, 9);
    // Сумма приведена к доле сразу, не дожидаясь следующего EconomyTick.
    expect(ai.economy.educationSpending).toBeCloseTo(INCOME * ai.economy.spendingShares!.education, 3);
  });

  it("потолок — стартовая доля: восстановление доходит до неё и останавливается", () => {
    const ai = austereAI();
    const start = ai.economy.spendingFloor!.educationSpending * 2;
    ai.economy.spendingShares!.education = start / 1.01; // меньше шага до потолка

    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });
    aiBehaviorTick(game);
    expect(ai.economy.spendingShares!.education).toBeCloseTo(start, 12);

    aiBehaviorTick(game);
    expect(ai.economy.spendingShares!.education).toBeCloseTo(start, 12);
  });

  it("долю выше стартовой (welfare после Правила C) не трогает — и уж точно не режет", () => {
    const ai = austereAI();
    const inflated = ai.economy.spendingFloor!.welfareSpending * 2 * 1.2;
    ai.economy.spendingShares!.welfare = inflated;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.welfare).toBe(inflated);
  });

  it("гистерезис: профицит есть, но меньше запаса — восстановление не идёт", () => {
    const ai = austereAI({ budgetBalance: MARGIN * 0.5 });
    const before = ai.economy.spendingShares!.education;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.education).toBe(before);
  });

  it("при долге/ВВП выше порога восстановление не идёт даже при большом профиците", () => {
    const ai = austereAI({ budgetBalance: MARGIN * 10, debt: 400_000_000_000 }); // 0.8 × gdp
    const before = ai.economy.spendingShares!.education;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.education).toBe(before);
  });

  it("нет осцилляции cut/restore в соседних тиках: после урезания малый профицит не запускает восстановление", () => {
    // Тик 1 — урезание: дефицит и долг выше порога.
    const ai = austereAI({ budgetBalance: -1, debt: 400_000_000_000 });
    ai.economy.spendingShares!.education = ai.economy.spendingFloor!.educationSpending * 1.5; // есть что резать
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);
    const afterCut = ai.economy.spendingShares!.education;
    expect(afterCut).toBeLessThan(ai.economy.spendingFloor!.educationSpending * 1.5);

    // Тик 2 — состояние, в которое урезание и выводит бюджет: небольшой
    // профицит (меньше запаса), долг уже погашен под порог. Восстановление
    // молчит — именно это и разрывает цикл cut → restore → cut.
    ai.economy.budgetBalance = MARGIN * 0.9;
    ai.economy.debt = 0;
    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.education).toBe(afterCut);
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

    expect(rival.economy.spendingShares!.military).toBeCloseTo((30 / 180) * 1.05, 6);
  });

  /**
   * ОБРАТНЫЙ ХОД ВОЕННОГО ОТВЕТА (2026-08-08) — третье правило, которому
   * потребовалась вторая сторона, после аустерити и сдвига по стабильности.
   * Пока ветка балансировки не бралась (замер 2026-08-08: 0 балансирующих из 11
   * угрожаемых на пяти контрольных точках), храповик был невидим; с появлением
   * обиды за подчинение он стал стоить миру 6 стран в вечном долгу.
   */
  it("разоружение: страна, которой больше не угрожают, возвращает military к стартовой доле", () => {
    const calm = country("CALM");
    // Состояние «Правило B уже подняло долю»: выше стартовой, ниже потолка.
    const startShare = calm.economy.spendingFloor!.militarySpending * 2;
    calm.economy.spendingShares!.military = startShare * 1.2;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), calm] });

    aiBehaviorTick(game);

    expect(calm.economy.spendingShares!.military).toBeLessThan(startShare * 1.2);
    expect(calm.economy.spendingShares!.military).toBeGreaterThanOrEqual(startShare);
  });

  it("разоружение отменяет ровно СВОЙ сдвиг: ниже стартовой доли не опускает", () => {
    const calm = country("CALM");
    const startShare = calm.economy.spendingFloor!.militarySpending * 2;
    calm.economy.spendingShares!.military = startShare;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), calm] });

    for (let i = 0; i < 24; i++) aiBehaviorTick(game);

    expect(calm.economy.spendingShares!.military).toBeCloseTo(startShare, 6);
  });

  it("вооружается только платёжеспособный: придавленный долгом не наращивает армию", () => {
    const rival = weakRival("RIVAL", -20);
    // Долг выше порога, с которого Правило A начинает резать расходы: два
    // правила обязаны реагировать на одно событие согласованно, а не спорить.
    rival.economy.debt = rival.economy.gdp * (DEBT_GDP_PENALTY_THRESHOLD + 0.1);
    const before = rival.economy.spendingShares!.military;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer("RIVAL"), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.spendingShares!.military).toBeLessThanOrEqual(before);
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
    const rival = weakRival("RIVAL", -20);
    rival.economy.spendingShares!.military = MILITARY_CAP_SHARE; // старт уже у потолка
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [strongPlayer("RIVAL"), rival] });

    aiBehaviorTick(game);

    expect(rival.economy.spendingShares!.military).toBe(MILITARY_CAP_SHARE);
  });
});

describe("aiBehaviorTick — Правило C (кризис → welfare, кризис позади → обратно)", () => {
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
    // Пол и доли — ДОЛИ дохода 1800 (2026-08-01): у военных запас над полом
    // 500/1800 − 250/1800, у welfare место до потолка.
    //
    // ПОЛ ВОЕННЫХ ПРИВЕДЁН К ИНВАРИАНТУ ИГРЫ 2026-08-08 (было 200/1800). В
    // продакшне пол — РОВНО половина стартовой доли (`CreateGame.ts`), и на этом
    // равенстве стоит вся арифметика возвратов: Правило C считает стартовую долю
    // как `пол × 2`, а с 2026-08-08 так же считает её обратный ход военного
    // ответа Правила B. Фикстура с полом 200/1800 при доле 500/1800 утверждала,
    // что страна СТАРТОВАЛА выше своей стартовой доли, — состояние, которого в
    // игре не бывает, и ловила бы ошибки, которых нет в продакшне (то же
    // требование записано в `test-utils/fixtures.ts`).
    c.economy.spendingFloor = {
      militarySpending: 250 / 1800,
      researchSpending: 50 / 1800,
      educationSpending: 50 / 1800,
      infrastructureSpending: 50 / 1800,
      welfareSpending: 50 / 1800,
    };
    c.economy.spendingShares = {
      military: 500 / 1800,
      research: 100 / 1800,
      education: 100 / 1800,
      infrastructure: 100 / 1800,
      welfare: 100 / 1800,
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

  // --- обратный ход: кризис позади (2026-08-01) ---

  /**
   * Страна, просевшая ровно так, как её просаживает само Правило C: доля
   * military ниже стартовой на столько же, на сколько welfare выше своей.
   * Стартовые доли фикстуры — military 30/180, welfare 15/180; пол = половина.
   */
  function drainedAI(stability: number): Country {
    const c = country("AI");
    c.politics.stability = stability;
    const moved = 6 / 180;
    c.economy.spendingShares!.military -= moved;
    c.economy.spendingShares!.welfare += moved;
    return c;
  }

  it("кризис позади (stability ≥ 45) — доля military возвращается к стартовой", () => {
    const ai = drainedAI(50);
    const milBefore = ai.economy.spendingShares!.military;
    const welfareBefore = ai.economy.spendingShares!.welfare;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.military).toBeGreaterThan(milBefore);
    expect(ai.economy.spendingShares!.welfare).toBeLessThan(welfareBefore);
    // Возврат тоже zero-sum: бюджет не создаётся и не исчезает.
    expect(ai.economy.spendingShares!.military + ai.economy.spendingShares!.welfare)
      .toBeCloseTo(milBefore + welfareBefore, 9);
  });

  it("в гистерезисной зоне (40…45) не двигается ни туда, ни обратно", () => {
    const ai = drainedAI(42);
    const milBefore = ai.economy.spendingShares!.military;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.military).toBe(milBefore);
  });

  it("возврат не поднимает military выше стартовой доли", () => {
    const ai = country("AI");
    ai.politics.stability = 90;
    // Просела на пол-шага возврата — за один тик должна дойти ровно до старта.
    const start = ai.economy.spendingShares!.military;
    ai.economy.spendingShares!.military = start - WELFARE_SHIFT_RATE / 2;
    ai.economy.spendingShares!.welfare += WELFARE_SHIFT_RATE / 2;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);
    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.military).toBeCloseTo(start, 9);
  });

  it("возврат не опускает welfare ниже стартовой доли — урезание аустерити не отыгрывается", () => {
    const ai = country("AI");
    ai.politics.stability = 90;
    // Так выглядит страна после Правила A: обе доли ниже стартовых. Донора для
    // возврата нет, хотя military и просела.
    ai.economy.spendingShares!.military *= 0.9;
    ai.economy.spendingShares!.welfare *= 0.9;
    const milBefore = ai.economy.spendingShares!.military;
    const game = createTestGameState({ playerCountryId: "PLAYER", countries: [country("PLAYER"), ai] });

    aiBehaviorTick(game);

    expect(ai.economy.spendingShares!.military).toBe(milBefore);
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
