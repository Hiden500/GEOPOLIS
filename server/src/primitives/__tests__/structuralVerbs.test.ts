import { describe, it, expect } from "vitest";
import { type GameState } from "@shared/types/GameState";
import { SOVEREIGN_STATUS } from "@shared/types/politics/Government";
import { VASSALAGE_MIN_INFLUENCE } from "@shared/defines/diplomacy";
import { createGame } from "../../game/CreateGame";
import {
  createDiscontentTestGame,
  seedSeparatistDiscontent,
  giveVassalageLeverage,
  holdTerritoryOf,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";
import { createTestCountry } from "../../test-utils/fixtures";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { findStateViolations } from "../invariants";
import { findDanglingCountryReferences } from "../countryRefs";
import { findSubordinationViolations, reconcileSubordination } from "../subordination";
import { splitCountry } from "../polityLifecycle";

/**
 * Структурные глаголы подчинения и поглощения (Милстоун 1).
 *
 * Проверяются СВОЙСТВА: два представления зависимости не расходятся, суммы
 * регионов сходятся, страна без территории не исчезает, кампания решается
 * движком. Ни один тест не фиксирует идентификатор страны 1946 и ни один не
 * хардкодит порог — оба берутся из состояния и из констант, потому что данные
 * наполняются и будут уточняться.
 */

function sun(game: GameState) {
  return game.countries.find(c => c.id === "SUN")!;
}
function usa(game: GameState) {
  return game.countries.find(c => c.id === "USA")!;
}

/** Мир, где SUN дотягивается до USA влиянием — рычаг подчинения без войны. */
function leverageGame(): GameState {
  const game = createDiscontentTestGame();
  giveVassalageLeverage(game, "SUN", "USA");
  return game;
}

// --------------------------------------------------------------------------
// 1. Два представления зависимости не расходятся
// --------------------------------------------------------------------------

describe("puppet: юридический статус и рантайм-отношение меняются ОДНИМ действием", () => {
  it("после подчинения обе половины пары на месте", () => {
    const game = leverageGame();
    const statusBefore = usa(game).politics.sovereigntyStatus ?? SOVEREIGN_STATUS;
    expect(statusBefore).toBe(SOVEREIGN_STATUS);

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(1);

    // Рантайм-половина: по ней втягивают в войну и считают тяготение пары.
    expect(sun(game).diplomacy.puppets).toContain("USA");
    // Юридическая половина: обе её части, статус и сюзерен.
    expect(usa(game).politics.overlordIds).toContain("SUN");
    expect(usa(game).politics.sovereigntyStatus).not.toBe(SOVEREIGN_STATUS);

    expect(findSubordinationViolations(game)).toEqual([]);
    expect(findStateViolations(game)).toEqual([]);
  });

  it("НЕГАТИВНЫЙ КОНТРОЛЬ: половина пары, записанная в одиночку, роняет пост-инварианты", () => {
    // Ровно то поведение, которое было ДО этой сессии: примитив менял
    // `puppets`, не трогая юридический статус. Проверка обязана падать на нём,
    // иначе она не проверяет ничего.
    const game = leverageGame();
    sun(game).diplomacy.puppets = ["USA"];

    const violations = findStateViolations(game);
    expect(violations.some(v => v.includes("legally sovereign"))).toBe(true);
    expect(violations.some(v => v.includes("overlordIds"))).toBe(true);
  });

  it("уже несуверенный субъект СОХРАНЯЕТ свой статус и получает второго сюзерена", () => {
    // Колония, перешедшая под патронаж другой державы, не превращается в
    // протекторат: её статус точнее описывает природу подчинения.
    const game = leverageGame();
    const target = usa(game);
    target.politics.sovereigntyStatus = "colony";
    target.politics.overlordIds = ["OLD"];
    game.countries.push(createTestCountry({ id: "OLD" }));
    game.countries.find(c => c.id === "OLD")!.diplomacy.puppets = ["USA"];

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(usa(game).politics.sovereigntyStatus).toBe("colony");
    expect(usa(game).politics.overlordIds).toEqual(expect.arrayContaining(["OLD", "SUN"]));
    expect(findStateViolations(game)).toEqual([]);
  });
});

describe("puppet: предпосылки", () => {
  it("без рычага отклоняется, и причина называет ОБА пути и оба порога", () => {
    const game = createDiscontentTestGame();

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("noVassalageLeverage");
    expect(sun(game).diplomacy.puppets).toEqual([]);
  });

  it("влияние ровно на пороге РАБОТАЕТ: граница включающая, а не исключающая", () => {
    const game = createDiscontentTestGame();
    sun(game).diplomacy.influence["USA"] = VASSALAGE_MIN_INFLUENCE;

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
  });

  it("рычаг силы работает БЕЗ влияния: контроль над землёй — второй путь", () => {
    const game = createDiscontentTestGame();
    // USA владеет одним регионом, и весь он под контролем SUN.
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);
    expect(sun(game).diplomacy.influence["USA"]).toBeUndefined();

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0]!;
    expect(applied.verb).toBe("puppet");
    if (applied.verb === "puppet") expect(applied.leverage).toBe("occupation");
  });

  it("цепочка подчинения не замыкается в цикл", () => {
    const game = leverageGame();
    // SUN уже марионетка USA — обратное подчинение сделало бы обоих ведущими
    // внешнюю политику друг друга.
    usa(game).diplomacy.puppets = ["SUN"];
    sun(game).politics.overlordIds = ["USA"];
    sun(game).politics.sovereigntyStatus = "protectorate";

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("vassalageCycle");
  });

  it("повторное подчинение уже своего клиента отклоняется", () => {
    const game = leverageGame();
    applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);
    // Второй ход — бюджет структурного слота обнуляется сменой месяца.
    game.currentDate = "1946-03-01";

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("alreadyVassal");
  });
});

// --------------------------------------------------------------------------
// 2. Перенос ссылок не оставляет половину пары
// --------------------------------------------------------------------------

describe("подчинение переживает исчезновение стороны", () => {
  /** Мир, где метрополия не переживает раскол, а её клиент остаётся. */
  function collapsingOverlordGame(): GameState {
    const game = createDiscontentTestGame();
    seedSeparatistDiscontent(game);
    const control = game.regions.find(r => r.id === TEST_REGION_CONTROL)!;
    control.ownerCountryId = "USA";
    usa(game).capitalRegionId = control.id;
    sun(game).capitalRegionId = TEST_REGION_NATIONAL;
    game.playerCountryId = "USA";
    return game;
  }

  it("раскол СЮЗЕРЕНА проходит палитру и не оставляет односторонней зависимости", () => {
    // Регрессия предсуществующего дефекта: `countryRefs` переносит
    // `politics.overlordIds`, но этого пути не было в палитре `split_country`,
    // и раскол государства, состоящего в отношениях подчинения, откатывался
    // собственной палитрой. На данных 1946 достижимо.
    const game = collapsingOverlordGame();
    sun(game).diplomacy.puppets = ["USA"];
    usa(game).politics.overlordIds = ["SUN"];
    usa(game).politics.sovereigntyStatus = "protectorate";

    const result = applyPrimitiveBatch(game, [
      {
        verb: "split_country", sourceCountryId: "SUN",
        target: { countryId: "SUN" }, params: { intensity: "severe" },
      },
    ]);

    expect(result.rejected).toEqual([]);
    expect(findSubordinationViolations(game)).toEqual([]);
    expect(findDanglingCountryReferences(game)).toEqual([]);
    expect(findStateViolations(game)).toEqual([]);
  });

  it("КЛИЕНТ, исчезнувший с правопреемником, передаёт подчинение преемнику", () => {
    // Асимметрия, которую способен породить перенос: запись сюзерена переезжает
    // на правопреемника, а юридическая половина исчезает вместе с субъектом.
    const game = collapsingOverlordGame();
    // Третья страна — сюзерен распадающейся SUN.
    game.countries.push(createTestCountry({ id: "PAT" }));
    const patron = game.countries.find(c => c.id === "PAT")!;
    patron.diplomacy.puppets = ["SUN"];
    sun(game).politics.overlordIds = ["PAT"];
    sun(game).politics.sovereigntyStatus = "protectorate";

    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });

    expect(result.dissolvedCountryId).toBe("SUN");
    const successor = game.countries.find(c => c.id === result.successorCountryId)!;
    expect(patron.diplomacy.puppets).toContain(successor.id);
    // Юридическая половина ДОСТРОЕНА правопреемнику, а не потеряна.
    expect(successor.politics.overlordIds).toContain("PAT");
    expect(successor.politics.sovereigntyStatus).not.toBe(SOVEREIGN_STATUS);
    expect(findSubordinationViolations(game)).toEqual([]);
  });

  it("НЕГАТИВНЫЙ КОНТРОЛЬ: без согласования перенос оставляет пару односторонней", () => {
    // Восстанавливаем старое поведение вручную: сюзерен есть, юридической
    // половины нет. Проверка обязана это увидеть — иначе предыдущий тест
    // проходил бы и без починки.
    const game = createDiscontentTestGame();
    game.countries.push(createTestCountry({ id: "PAT" }));
    game.countries.find(c => c.id === "PAT")!.diplomacy.puppets = ["USA"];

    expect(findSubordinationViolations(game).length).toBeGreaterThan(0);
    reconcileSubordination(game);
    expect(findSubordinationViolations(game)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 3. Поглощение: земля, суммы и конец партии
// --------------------------------------------------------------------------

describe("annex: земля переходит, а число регионов в мире сохраняется", () => {
  /** Мир, где USA владеет одним регионом, а держит его SUN. */
  function heldGame(): GameState {
    const game = createDiscontentTestGame();
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);
    return game;
  }

  it("удерживаемый регион переходит во владение, оккупация с него снимается", () => {
    const game = heldGame();
    const regionsBefore = game.regions.length;
    const ownedBySun = game.regions.filter(r => r.ownerCountryId === "SUN").length;

    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    // Сумма регионов мира не меняется: земля переходит, а не создаётся.
    expect(game.regions).toHaveLength(regionsBefore);
    expect(game.regions.filter(r => r.ownerCountryId === "SUN")).toHaveLength(ownedBySun + 1);
    expect(game.regions.filter(r => r.ownerCountryId === "USA")).toHaveLength(0);
    // Оккупация потеряла смысл: страна не оккупирует собственную землю.
    expect(game.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!.occupiedBy).toBeUndefined();
    expect(findStateViolations(game)).toEqual([]);
  });

  it("страна, потерявшая ВСЮ территорию, остаётся в мире, а не растворяется в победителе", () => {
    // §7.1: тотальное поражение даёт переход в подчинённое положение, а не во
    // владение победителем. Государство без территории — законное состояние.
    const game = heldGame();

    applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(game.countries.map(c => c.id)).toContain("USA");
    expect(findDanglingCountryReferences(game)).toEqual([]);
  });

  it("аннексия НЕ своей земли отклоняется: захвата на расстоянии не бывает", () => {
    const game = createDiscontentTestGame();
    // USA владеет регионом, но никто его не оккупирует.
    const region = game.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!;
    region.ownerCountryId = "USA";
    usa(game).capitalRegionId = region.id;

    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("annexNothingHeld");
    expect(region.ownerCountryId).toBe("USA");
  });

  it("столица, ушедшая победителю, переезжает в оставшийся регион", () => {
    const game = createDiscontentTestGame();
    // Два региона у USA; удерживается только столичный.
    for (const id of [TEST_REGION_NEIGHBOUR, TEST_REGION_NATIONAL]) {
      game.regions.find(r => r.id === id)!.ownerCountryId = "USA";
    }
    usa(game).capitalRegionId = TEST_REGION_NEIGHBOUR;
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);

    applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(usa(game).capitalRegionId).toBe(TEST_REGION_NATIONAL);
    // Инвариант «столица среди своих регионов» — то, ради чего перенос и нужен.
    expect(findStateViolations(game)).toEqual([]);
  });
});

describe("annex и машина состояний кампании (docs/CONCEPT.md §6)", () => {
  /** Мир, где страна ИГРОКА владеет одним регионом, удерживаемым противником. */
  function playerLastRegionGame(): GameState {
    const game = createDiscontentTestGame();
    game.playerCountryId = "USA";
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);
    return game;
  }

  it("аннексия последнего региона игрока ведёт в поражение, а не удаляет игрока из партии", () => {
    const game = playerLastRegionGame();

    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    // Вердикт вычислен движком в тот же ход, а не отложен до конца месяца.
    expect(game.campaign.status).toBe("defeated");
    // Игрок остался собой: подмена страны игрока победителем — ровно то, что
    // §7.1 запрещает («не во владение победителем»).
    expect(game.playerCountryId).toBe("USA");
    expect(game.countries.map(c => c.id)).toContain("USA");
    expect(findStateViolations(game)).toEqual([]);

    const applied = result.applied[0]!;
    expect(applied.verb).toBe("annex");
    if (applied.verb === "annex") {
      expect(applied.campaignEnded).toBe("defeated");
      expect(applied.targetRegionsLeft).toBe(0);
    }
  });

  it("та же аннексия по стране НЕ игрока партию не заканчивает", () => {
    // Единственное различие между этим миром и предыдущим — кто игрок. Если бы
    // конец партии выводился из потери территории кем угодно, тест бы упал.
    const game = createDiscontentTestGame();
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);
    expect(game.playerCountryId).toBe("SUN");

    applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(game.campaign.status).toBe("active");
  });

  it("НЕГАТИВНЫЙ КОНТРОЛЬ: пока у игрока остаётся регион, поражения нет", () => {
    // Проверка не срабатывает «просто от аннексии»: партию заканчивает
    // потеря ПОСЛЕДНЕГО региона, а не любая потеря земли.
    const game = createDiscontentTestGame();
    game.playerCountryId = "USA";
    for (const id of [TEST_REGION_NEIGHBOUR, TEST_REGION_NATIONAL]) {
      game.regions.find(r => r.id === id)!.ownerCountryId = "USA";
    }
    usa(game).capitalRegionId = TEST_REGION_NATIONAL;
    holdTerritoryOf(game, "SUN", "USA", TEST_REGION_NEIGHBOUR);

    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(game.campaign.status).toBe("active");
  });
});

// --------------------------------------------------------------------------
// 4. Боевые данные 1946 — масштаб, а не фикстура
// --------------------------------------------------------------------------

describe("структурные глаголы на боевых данных 1946", () => {
  /**
   * Пара «источник → цель», где источник дотягивается влиянием до порога
   * вассалитета, а цель ещё не его клиент. Ищется В СОСТОЯНИИ, а не
   * хардкодится: наполнение влияния будет уточняться.
   */
  function leveragePair(game: GameState): { sourceId: string; targetId: string } | undefined {
    for (const country of game.countries) {
      for (const [targetId, value] of Object.entries(country.diplomacy.influence)) {
        if (value < VASSALAGE_MIN_INFLUENCE) continue;
        if (country.diplomacy.puppets.includes(targetId)) continue;
        if (!game.countries.some(c => c.id === targetId)) continue;
        return { sourceId: country.id, targetId };
      }
    }
    return undefined;
  }

  it("поставляемый сценарий сам по себе согласован по подчинению", () => {
    // 157 стран, 89 несуверенных, 77 марионеток — инвариант, до этой сессии
    // живший на слое данных, теперь исполняется движком на каждой загрузке.
    const game = createGame("1946", "SUN", "ru", 1);
    expect(findSubordinationViolations(game)).toEqual([]);
    expect(findStateViolations(game)).toEqual([]);
  });

  it("подчинение реальной пары держав проходит и оставляет мир целым", () => {
    const game = createGame("1946", "SUN", "ru", 1);
    const pair = leveragePair(game);
    expect(pair).toBeDefined();

    const result = applyPrimitiveBatch(game, [
      { verb: "puppet", sourceCountryId: pair!.sourceId, target: { countryId: pair!.targetId } },
    ]);

    expect(result.rejected).toEqual([]);
    const vassal = game.countries.find(c => c.id === pair!.targetId)!;
    expect(vassal.politics.overlordIds).toContain(pair!.sourceId);
    expect(vassal.politics.sovereigntyStatus).not.toBe(SOVEREIGN_STATUS);
    expect(findStateViolations(game)).toEqual([]);
    expect(findDanglingCountryReferences(game)).toEqual([]);
  });

  it("в январе 1946 аннексировать нечего: оккупации в мире нет ни одной", () => {
    // Не украшение, а проверка семантики: аннексия конвертирует удержанное, а
    // войны на старте сценария не идёт. Если бы предпосылка была слабее,
    // держава аннексировала бы соседа с первого хода.
    const game = createGame("1946", "SUN", "ru", 1);
    expect(game.regions.filter(r => r.occupiedBy !== undefined)).toHaveLength(0);

    const other = game.countries.find(c => c.id !== "SUN" && game.regions.some(r => r.ownerCountryId === c.id))!;
    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: other.id } },
    ]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("annexNothingHeld");
  });

  it("аннексия крупной колониальной державы переживает масштаб 1946", () => {
    const game = createGame("1946", "SUN", "ru", 1);
    // Держава с наибольшим числом регионов — цель, на которой масштаб виден.
    const owners = new Map<string, number>();
    for (const region of game.regions) {
      owners.set(region.ownerCountryId, (owners.get(region.ownerCountryId) ?? 0) + 1);
    }
    const [targetId, ownedCount] = [...owners.entries()]
      .filter(([id]) => id !== "SUN")
      .sort((a, b) => b[1] - a[1])[0]!;
    expect(ownedCount).toBeGreaterThan(1);

    // Половина её регионов оказывается под фактическим контролем СССР.
    const target = game.regions.filter(r => r.ownerCountryId === targetId);
    const seized = target.slice(0, Math.ceil(target.length / 2));
    for (const region of seized) region.occupiedBy = "SUN";

    const regionsBefore = game.regions.length;
    const sunBefore = game.regions.filter(r => r.ownerCountryId === "SUN").length;

    const result = applyPrimitiveBatch(game, [
      { verb: "annex", sourceCountryId: "SUN", target: { countryId: targetId } },
    ]);

    expect(result.rejected).toEqual([]);
    // Суммы: ни один регион не потерян и ни один не создан.
    expect(game.regions).toHaveLength(regionsBefore);
    expect(game.regions.filter(r => r.ownerCountryId === "SUN")).toHaveLength(
      sunBefore + seized.length
    );
    expect(game.regions.filter(r => r.ownerCountryId === targetId)).toHaveLength(
      ownedCount - seized.length
    );
    expect(findStateViolations(game)).toEqual([]);
    expect(findDanglingCountryReferences(game)).toEqual([]);
  });
});
