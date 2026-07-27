import { describe, it, expect } from "vitest";
import { type GameState } from "@shared/types/GameState";
import { createGame } from "../../game/CreateGame";
import { createTestCountry, createTestRegion, createTestGameState } from "../../test-utils/fixtures";
import {
  createDiscontentTestGame,
  seedSeparatistDiscontent,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";
import {
  collectCountryReferences,
  findDanglingCountryReferences,
  remapCountryReferences,
} from "../countryRefs";
import {
  splitAmount,
  splitCountry,
  removeCountry,
  closeBrokenWars,
} from "../polityLifecycle";
import { findStateViolations } from "../invariants";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { chooseSuccessor, evaluateCampaign } from "../campaign";

/**
 * Жизненный цикл государств (docs/CONCEPT.md §7.1).
 *
 * Проверяются СВОЙСТВА, а не снимки: суммы сходятся, идентификаторы уникальны,
 * висячих ссылок ноль. Ни один тест не хардкодит id региона или страны,
 * возникших в ходе операции, и ни один не фиксирует долю или порог — разметка
 * демографии покрывает 14 регионов из 1399 и будет расширяться.
 */

// --------------------------------------------------------------------------
// 1. Полнота реестра ссылок — выводится из СОСТОЯНИЯ, а не переписана руками
// --------------------------------------------------------------------------

/**
 * Пути, где строка, равная идентификатору страны, ссылкой НЕ является.
 *
 * Каждая запись — решение с причиной, а не «чтобы тест прошёл». Список закрытый
 * и сравнивается на точное совпадение пути: новое поле состояния, куда попадёт
 * идентификатор страны, не совпадёт ни с одной записью и уронит тест.
 */
const NOT_A_COUNTRY_REFERENCE: { path: string; why: string }[] = [
  { path: "countries[*].id", why: "идентичность страны, а не ссылка на неё" },
  {
    path: "countries[*].name.en",
    why: "ИМЯ страны; у части стран оно совпадает с кодом (USA)",
  },
  { path: "countries[*].shortName.en", why: "то же имя, короткая форма" },
  {
    path: "eventHistory[*].receipt.countries[*]",
    why: "ЗАПИСЬ О ПРОШЛОМ: событие 1949 года действительно касалось государства, распавшегося позже",
  },
  {
    path: "eventHistory[*].receipt.actions.applied[*].sourceCountryId",
    why: "то же: история применённых действий не переписывается",
  },
  {
    path: "eventHistory[*].receipt.actions.applied[*].targetCountryId",
    why: "то же",
  },
];

/** Нормализация пути: индексы массивов в `[*]`, ключи-страны в `{*}`. */
function sweepCountryReferencePaths(game: GameState): Set<string> {
  const ids = new Set(game.countries.map(c => c.id));
  const found = new Set<string>();

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${path}[*]`);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        // Ключ-идентификатор страны — это словарь, ключуемый страной
        // (`relations`, `influence`, `sanctions`, `casualties`).
        if (ids.has(key)) {
          found.add(`${path}{*}`);
          visit(child, `${path}{*}`);
          continue;
        }
        visit(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (typeof value === "string" && ids.has(value)) found.add(path);
  };

  visit(game, "");
  return found;
}

/** Канонический вид: `relations.{*}` и `relations{*}` — один и тот же путь. */
function canonical(path: string): string {
  return path.replace(/\.\{\*\}/g, "{*}");
}

describe("реестр ссылок на страну полон (docs/CONCEPT.md §7.1)", () => {
  /**
   * Мир, где заполнено КАЖДОЕ поле, способное сослаться на страну, — включая
   * необязательные, которых в сценарии 1946 нет вовсе. Без него сторож
   * подтверждал бы полноту реестра на тех полях, которые данные и так
   * заполняют, то есть молчал бы ровно там, где ошибка вероятнее всего.
   */
  function denselyReferencedGame(): GameState {
    const game = createTestGameState({
      playerCountryId: "AAA",
      countries: [
        createTestCountry({ id: "AAA", capitalRegionId: 1 }),
        createTestCountry({ id: "BBB", capitalRegionId: 2 }),
        createTestCountry({ id: "CCC", capitalRegionId: 3 }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "AAA", occupiedBy: "BBB" }),
        createTestRegion({ id: 2, ownerCountryId: "BBB" }),
        createTestRegion({ id: 3, ownerCountryId: "CCC" }),
      ],
    });

    game.llmSpotlightCountryId = "BBB";
    const aaa = game.countries[0]!;
    aaa.currencyZoneAnchor = "CCC";
    aaa.diplomacy.allies = ["BBB"];
    aaa.diplomacy.rivals = ["CCC"];
    aaa.diplomacy.puppets = ["BBB"];
    aaa.diplomacy.sphereOfInfluence = ["CCC"];
    aaa.diplomacy.guarantees = ["BBB"];
    aaa.diplomacy.relations = { BBB: 20, CCC: -30 };
    aaa.diplomacy.influence = { BBB: 10 };
    aaa.diplomacy.sanctions = { CCC: ["trade_embargo"] };

    game.wars = [
      {
        id: "w-1",
        attackers: ["AAA"],
        defenders: ["BBB"],
        supporters: [{ countryId: "CCC", side: "attackers" }],
        startDate: game.currentDate,
        active: true,
        territoryFlips: { toAttackers: 0, toDefenders: 0 },
        casualties: { AAA: 100, BBB: 200 },
      },
    ];
    game.modifiers = [
      { id: "mod-1", source: "test", target: { kind: "country", id: "BBB" },
        attribute: "stability", op: "add", value: 1 },
      { id: "mod-2", source: "test", target: { kind: "region", id: 1 },
        attribute: "stability", op: "add", value: 1 },
    ];
    game.mapFeatures = [{ id: "mf-1", type: "city", regionId: 1, ownerId: "CCC", tags: [] }];
    game.pendingWorldFacts = [{ countryId: "BBB", text: "x" }];
    game.pendingPromptConsumption = { facts: [{ countryId: "CCC", text: "y" }], hingePointIds: [] };
    game.primitiveTurnBudget = {
      date: game.currentDate,
      softUsed: 0,
      structuralUsed: 0,
      targetUses: { "enact_reform -> country BBB": 1 },
      impactAccrued: {},
    };
    game.campaign = {
      status: "succession_choice_pending",
      predecessor: { en: "Gone" },
      successorCountryIds: ["BBB", "CCC"],
      since: game.currentDate,
    };
    return game;
  }

  it.each([
    ["плотно заполненный мир", denselyReferencedGame],
    ["боевые данные 1946", () => createGame("1946", "SUN", "ru", 1)],
  ])(
    "%s: каждое место, где состояние называет страну, объявлено обходом либо исключением",
    (_label, build) => {
      const game = build();
      const declared = new Set(collectCountryReferences(game).map(r => canonical(r.path)));
      const excluded = new Set(NOT_A_COUNTRY_REFERENCE.map(e => canonical(e.path)));

      const undeclared = [...sweepCountryReferencePaths(game)]
        .map(canonical)
        .filter(path => !declared.has(path) && !excluded.has(path))
        .sort();

      expect(undeclared).toEqual([]);
    }
  );

  it("сторож не ложный: поле, которого обход не знает, роняет проверку", () => {
    // Негативный контроль самого сторожа. Без него «ноль незадекларированных
    // путей» означало бы только то, что обход по этому состоянию ничего не
    // нашёл, — в том числе если бы он не находил вообще ничего.
    const game = denselyReferencedGame();
    (game as unknown as Record<string, unknown>)["someNewFieldWithACountry"] = "BBB";

    const declared = new Set(collectCountryReferences(game).map(r => canonical(r.path)));
    const excluded = new Set(NOT_A_COUNTRY_REFERENCE.map(e => canonical(e.path)));
    const undeclared = [...sweepCountryReferencePaths(game)]
      .map(canonical)
      .filter(path => !declared.has(path) && !excluded.has(path));

    expect(undeclared).toContain("someNewFieldWithACountry");
  });

  it("перенос переписывает ВСЕ объявленные места, а не часть", () => {
    const game = denselyReferencedGame();
    const before = collectCountryReferences(game).filter(r => r.countryId === "BBB");
    expect(before.length).toBeGreaterThan(0);

    remapCountryReferences(game, id => (id === "BBB" ? "CCC" : id));

    expect(collectCountryReferences(game).filter(r => r.countryId === "BBB")).toEqual([]);
  });

  it("снятие ссылки на страну без правопреемника не оставляет следов в живом состоянии", () => {
    const game = denselyReferencedGame();
    // Регионы «BBB» сначала переезжают: владение снять нельзя, и обход обязан
    // это сказать исключением, а не молча оставить регион без хозяина.
    for (const region of game.regions) {
      if (region.ownerCountryId === "BBB") region.ownerCountryId = "AAA";
    }
    game.campaign = { status: "active" };

    removeCountry(game, "BBB", undefined);

    expect(game.countries.map(c => c.id)).not.toContain("BBB");
    expect(collectCountryReferences(game).filter(r => r.countryId === "BBB")).toEqual([]);
  });

  it("удалить страну, за которой числится регион, невозможно — это громкий отказ, а не тихий", () => {
    const game = denselyReferencedGame();
    game.campaign = { status: "active" };
    expect(() => removeCountry(game, "BBB", undefined)).toThrow(/cannot be dropped/);
  });
});

// --------------------------------------------------------------------------
// 2. Точное деление величин
// --------------------------------------------------------------------------

describe("делимое имущество делится БЕЗ потерь", () => {
  it.each([
    [1_000_000, [3, 1]],
    [7, [1, 1, 1]],
    [0, [5, 5]],
    [999_999_999, [17, 3, 1, 1]],
  ])("сумма частей от %i по долям %j равна целому", (total, shares) => {
    const parts = splitAmount(total, shares);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(parts.every(p => p >= 0)).toBe(true);
  });

  it("нулевые доли не создают денег из воздуха", () => {
    expect(splitAmount(100, [0, 0])).toEqual([0, 0]);
  });
});

// --------------------------------------------------------------------------
// 3. Раскол: свойства состояния
// --------------------------------------------------------------------------

/** Мир, где титульная группа двух регионов перешла порог отделения. */
function separatistGame(): GameState {
  const game = createDiscontentTestGame();
  seedSeparatistDiscontent(game);
  return game;
}

function totals(game: GameState, ids: readonly string[]) {
  const countries = game.countries.filter(c => ids.includes(c.id));
  return {
    population: countries.reduce((s, c) => s + c.population, 0),
    treasury: countries.reduce((s, c) => s + c.economy.treasury, 0),
    manpower: countries.reduce((s, c) => s + c.military.manpower, 0),
    regions: game.regions.filter(r => ids.includes(r.ownerCountryId)).length,
  };
}

describe("split_country: суммы сходятся, id уникальны, висячих ссылок ноль", () => {
  it("население, казна, живая сила и число регионов сохраняются целиком", () => {
    const game = separatistGame();
    const before = totals(game, ["SUN"]);
    expect(before.regions).toBeGreaterThan(1);

    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });
    expect(result.shards.length).toBeGreaterThan(0);

    const after = totals(game, ["SUN", ...result.shards.map(s => s.countryId)]);
    expect(after.population).toBe(before.population);
    expect(after.treasury).toBe(before.treasury);
    expect(after.manpower).toBe(before.manpower);
    expect(after.regions).toBe(before.regions);
  });

  it("идентификаторы стран остаются уникальными", () => {
    const game = separatistGame();
    splitCountry(game, { countryId: "SUN", intensity: "severe" });

    const ids = game.countries.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("после раскола мир проходит инварианты движка целиком", () => {
    const game = separatistGame();
    splitCountry(game, { countryId: "SUN", intensity: "severe" });
    expect(findStateViolations(game)).toEqual([]);
    expect(findDanglingCountryReferences(game)).toEqual([]);
  });

  it("осколок получает регионы своей группы и НИ ОДНОГО чужого", () => {
    const game = separatistGame();
    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });

    for (const shard of result.shards) {
      const owned = game.regions.filter(r => r.ownerCountryId === shard.countryId);
      expect(owned.map(r => r.id).sort()).toEqual([...shard.regionIds].sort());
      for (const region of owned) {
        const dominant = [...(region.demographics ?? [])].sort((a, b) => b.share - a.share)[0];
        expect(dominant?.groupId).toBe(shard.groupId);
      }
    }
  });

  it("осколок воплощает желаемую позицию своей группы — дистанция схлопывается", () => {
    const game = separatistGame();
    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });

    for (const shard of result.shards) {
      const country = game.countries.find(c => c.id === shard.countryId)!;
      const group = game.ethnicGroups.find(g => g.id === shard.groupId)!;
      expect(country.politics.ideologyCoordinates).toEqual(group.desiredIdeology);
    }
  });

  it("хинт двигает ПОРОГ, а не величину: mild оставляет страну целой там, где severe её колет", () => {
    // Контрфакт с изменением ровно одного входа — качественного хинта.
    const severe = separatistGame();
    const severeResult = splitCountry(severe, { countryId: "SUN", intensity: "severe" });
    expect(severeResult.shards.length).toBeGreaterThan(0);

    const mild = separatistGame();
    expect(() => splitCountry(mild, { countryId: "SUN", intensity: "mild" })).toThrow();
  });

  it("столица, ушедшая с осколком, переезжает в оставшийся регион метрополии", () => {
    const game = separatistGame();
    const sun = game.countries.find(c => c.id === "SUN")!;
    // Столицу ставим в регион, который заведомо отделится.
    sun.capitalRegionId = TEST_REGION_NATIONAL;

    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });

    expect(result.capitalReassignments).toHaveLength(1);
    const rumpRegions = game.regions.filter(r => r.ownerCountryId === "SUN");
    expect(rumpRegions.map(r => r.id)).toContain(sun.capitalRegionId);
    expect(findStateViolations(game)).toEqual([]);
  });
});

describe("split_country: роспуск метрополии и правопреемство", () => {
  /** Мир, где ВСЕ регионы страны уходят: метрополия не переживает раскол. */
  function totalCollapseGame(): GameState {
    const game = separatistGame();
    // Контрольный регион отдаём другой стране: у SUN остаются только те, что
    // отделяются. Демографию не трогаем — меняется ровно один вход.
    const control = game.regions.find(r => r.id === TEST_REGION_CONTROL)!;
    control.ownerCountryId = "USA";
    const usa = game.countries.find(c => c.id === "USA")!;
    usa.capitalRegionId = control.id;
    game.countries.find(c => c.id === "SUN")!.capitalRegionId = TEST_REGION_NATIONAL;
    return game;
  }

  it("метрополия без территории исчезает, а её ссылки переходят правопреемнику", () => {
    const game = totalCollapseGame();
    const sun = game.countries.find(c => c.id === "SUN")!;
    // Ссылка третьей страны на SUN обязана переехать, а не повиснуть.
    game.countries.find(c => c.id === "USA")!.diplomacy.rivals = ["SUN"];
    game.wars = [
      {
        id: "w-1", attackers: ["SUN"], defenders: ["USA"], supporters: [],
        startDate: game.currentDate, active: true,
        territoryFlips: { toAttackers: 0, toDefenders: 0 }, casualties: { SUN: 10 },
      },
    ];
    const treasuryBefore = sun.economy.treasury;

    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });

    expect(result.dissolvedCountryId).toBe("SUN");
    expect(result.successorCountryId).toBeDefined();
    expect(game.countries.map(c => c.id)).not.toContain("SUN");

    const successor = result.successorCountryId!;
    expect(game.countries.find(c => c.id === "USA")!.diplomacy.rivals).toEqual([successor]);
    expect(game.wars[0]!.attackers).toEqual([successor]);
    expect(game.wars[0]!.casualties[successor]).toBe(10);
    expect(findDanglingCountryReferences(game)).toEqual([]);
    // Казна не испаряется вместе с государством.
    expect(
      game.countries
        .filter(c => c.id !== "USA")
        .reduce((s, c) => s + c.economy.treasury, 0)
    ).toBe(treasuryBefore);
  });

  it("война, потерявшая сторону целиком, закрывается движком", () => {
    // Сторона исчезает не «в принципе», а именно из-за операции жизненного
    // цикла: страна распущена без правопреемника. Оставленная активной, такая
    // война продолжала бы тикать фронтом и копить потери стороны, которой нет.
    const game = createDiscontentTestGame();
    game.wars = [
      {
        id: "w-1", attackers: ["SUN"], defenders: ["USA"], supporters: [],
        startDate: game.currentDate, active: true,
        territoryFlips: { toAttackers: 0, toDefenders: 0 }, casualties: {},
      },
    ];
    for (const region of game.regions) region.ownerCountryId = "USA";
    game.countries.find(c => c.id === "USA")!.capitalRegionId = TEST_REGION_CONTROL;
    game.playerCountryId = "USA";

    removeCountry(game, "SUN", undefined);
    closeBrokenWars(game);

    expect(game.wars[0]!.active).toBe(false);
    expect(findStateViolations(game)).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 4. Машина состояний кампании
// --------------------------------------------------------------------------

describe("машина состояний кампании (docs/CONCEPT.md §6, §7.1)", () => {
  /** Мир, где страна ИГРОКА распадается на два осколка и не выживает. */
  function playerCollapseGame(): GameState {
    const game = createDiscontentTestGame();
    // Два национальных региона с РАЗНЫМИ титульными группами — два осколка.
    const neighbour = game.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!;
    neighbour.demographics = [{ groupId: "russians", share: 1 }];
    // Русским тоже даём повод уйти: их желаемая позиция уводится от власти.
    game.ethnicGroups.find(g => g.id === "russians")!.desiredIdeology = {
      economic: 0.5,
      political: 0.6,
    };
    for (const region of game.regions) {
      for (const share of region.demographics ?? []) {
        game.groupImpactMemory.push({
          regionId: region.id, groupId: share.groupId,
          suppression: 0, alienation: 0, concession: 0, emboldenment: 0.6,
        });
      }
    }
    game.countries.find(c => c.id === "SUN")!.capitalRegionId = TEST_REGION_NATIONAL;
    return game;
  }

  it("распад страны игрока переводит кампанию в ожидание выбора осколка, а не в поражение", () => {
    const game = playerCollapseGame();
    const result = applyPrimitiveBatch(game, [{
      verb: "split_country", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { intensity: "severe" },
    }]);

    expect(result.rejected).toEqual([]);
    expect(game.campaign.status).toBe("succession_choice_pending");
    if (game.campaign.status !== "succession_choice_pending") throw new Error("unreachable");
    expect(game.campaign.successorCountryIds.length).toBeGreaterThanOrEqual(2);
    // Игрок ни на мгновение не остаётся без страны.
    expect(game.countries.some(c => c.id === game.playerCountryId)).toBe(true);
    expect(findStateViolations(game)).toEqual([]);
  });

  it("выбор осколка возвращает кампанию в active и меняет страну игрока", () => {
    const game = playerCollapseGame();
    applyPrimitiveBatch(game, [{
      verb: "split_country", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { intensity: "severe" },
    }]);
    if (game.campaign.status !== "succession_choice_pending") throw new Error("no succession");

    const other = game.campaign.successorCountryIds.find(id => id !== game.playerCountryId)!;
    expect(chooseSuccessor(game, other)).toEqual({ ok: true });
    expect(game.playerCountryId).toBe(other);
    expect(game.campaign.status).toBe("active");
  });

  it("ручка выбора не позволяет сменить страну на произвольную", () => {
    const game = playerCollapseGame();
    applyPrimitiveBatch(game, [{
      verb: "split_country", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { intensity: "severe" },
    }]);

    const result = chooseSuccessor(game, "USA");
    expect(result).toEqual({ ok: false, rejection: { code: "notASuccessor", countryId: "USA" } });
    expect(game.playerCountryId).not.toBe("USA");
  });

  it("выбор вне ожидания отклоняется", () => {
    const game = createDiscontentTestGame();
    expect(chooseSuccessor(game, "USA")).toEqual({ ok: false, rejection: { code: "notPending" } });
  });

  it("game over — потеря ВЛАДЕНИЯ всеми регионами, и причина называет поглотителя", () => {
    const game = createDiscontentTestGame();
    for (const region of game.regions) region.ownerCountryId = "USA";
    game.countries.find(c => c.id === "USA")!.capitalRegionId = TEST_REGION_CONTROL;

    const campaign = evaluateCampaign(game);
    expect(campaign.status).toBe("defeated");
    if (campaign.status !== "defeated") throw new Error("unreachable");
    expect(campaign.reason.code).toBe("absorbed");
  });

  it("ОККУПАЦИЯ всех регионов концом кампании НЕ является (§6: оккупация ≠ аннексия)", () => {
    // Контрфакт к предыдущему тесту: меняется ровно один вход — вместо смены
    // владельца ставится оккупация.
    const game = createDiscontentTestGame();
    for (const region of game.regions) region.occupiedBy = "USA";

    expect(evaluateCampaign(game).status).toBe("active");
  });

  it("поражение терминально: движок не пересматривает его следующим ходом", () => {
    const game = createDiscontentTestGame();
    for (const region of game.regions) region.ownerCountryId = "USA";
    game.countries.find(c => c.id === "USA")!.capitalRegionId = TEST_REGION_CONTROL;
    evaluateCampaign(game);

    // Мир вернул игроку регион — партия всё равно окончена.
    game.regions[0]!.ownerCountryId = "SUN";
    expect(evaluateCampaign(game).status).toBe("defeated");
  });

  it("страна-НЕигрок, потерявшая все регионы, не удаляется и не переходит победителю", () => {
    // §7.1: «тотальное поражение: rebel → subject, не overlord».
    const game = createDiscontentTestGame();
    const loser = createTestCountry({ id: "LOS", capitalRegionId: TEST_REGION_CONTROL });
    game.countries.push(loser);

    evaluateCampaign(game);

    expect(game.countries.map(c => c.id)).toContain("LOS");
    expect(game.campaign.status).toBe("active");
  });
});

// --------------------------------------------------------------------------
// 5. Раскол на боевых данных 1946
// --------------------------------------------------------------------------

describe("split_country на данных 1946", () => {
  it("сохраняет суммы и целостность мира на полном сценарии", () => {
    const game = createGame("1946", "SUN", "ru", 1);
    // Доводим размеченные группы до порога отделения тем же каналом, каким это
    // делает `incite_unrest`, — без правки порогов и долей.
    for (const region of game.regions) {
      if (region.ownerCountryId !== "SUN") continue;
      for (const share of region.demographics ?? []) {
        game.groupImpactMemory.push({
          regionId: region.id, groupId: share.groupId,
          suppression: 0, alienation: 1, concession: 0, emboldenment: 1,
        });
      }
    }

    const before = totals(game, ["SUN"]);
    const worldRegions = game.regions.length;

    const result = splitCountry(game, { countryId: "SUN", intensity: "severe" });
    expect(result.shards.length).toBeGreaterThan(0);

    const after = totals(game, ["SUN", ...result.shards.map(s => s.countryId)]);
    expect(after.population).toBe(before.population);
    expect(after.treasury).toBe(before.treasury);
    expect(after.manpower).toBe(before.manpower);
    expect(after.regions).toBe(before.regions);
    // Регионы не создаются и не исчезают — они меняют владельца.
    expect(game.regions).toHaveLength(worldRegions);
    expect(findStateViolations(game)).toEqual([]);
  });
});
