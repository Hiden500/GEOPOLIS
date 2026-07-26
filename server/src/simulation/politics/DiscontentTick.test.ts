import { describe, it, expect } from "vitest";
import { discontentTick } from "./DiscontentTick";
import {
  ideologyDistance,
  regionDiscontent,
  regionWelfare,
  resolveIdeologyCoordinates,
} from "@shared/utils/discontent";
import {
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  SUPPRESSION_DECAY_RATE,
  ALIENATION_DECAY_RATE,
  IDEOLOGY_LABEL_COORDINATES,
} from "@shared/defines/discontent";
import { IDEOLOGY_MAX_DISTANCE } from "@shared/types/politics/Ideology";
import { createTestRegion } from "../../test-utils/fixtures";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";

/**
 * Ядро вертикального среза (docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md):
 * недовольство ВЫВОДИТСЯ из геометрии «идеология власти ↔ желаемая позиция
 * группы» + экономики региона + памяти воздействий, а не хранится и не
 * назначается сверху.
 */

function regionById(game: ReturnType<typeof createDiscontentTestGame>, id: number) {
  return game.regions.find(r => r.id === id)!;
}

describe("ideologyDistance — геометрия спектра (docs/CONCEPT.md §4.2)", () => {
  it("совпадающие позиции дают нулевую дистанцию", () => {
    expect(ideologyDistance({ economic: -0.5, political: 0.2 }, { economic: -0.5, political: 0.2 }))
      .toBe(0);
  });

  it("противоположные углы спектра дают ровно 1 (нормировка на 2√2)", () => {
    expect(ideologyDistance({ economic: -1, political: -1 }, { economic: 1, political: 1 }))
      .toBeCloseTo(1, 10);
    expect(IDEOLOGY_MAX_DISTANCE).toBeCloseTo(Math.hypot(2, 2), 10);
  });

  it("симметрична", () => {
    const a = { economic: -0.95, political: -0.9 };
    const b = { economic: -0.1, political: 0.45 };
    expect(ideologyDistance(a, b)).toBeCloseTo(ideologyDistance(b, a), 12);
  });
});

describe("resolveIdeologyCoordinates — фолбэк по ярлыку", () => {
  it("явные координаты приоритетнее ярлыка", () => {
    const explicit = { economic: -0.95, political: -0.9 };
    const coords = resolveIdeologyCoordinates({
      ideology: "Liberal Democracy",
      governmentType: "republic",
      stability: 50, legitimacy: 50, corruption: 20, governmentSupport: 50,
      ideologyCoordinates: explicit,
    });
    expect(coords).toEqual(explicit);
  });

  it("страна без координат читается по ярлыку — это штатное поведение, не ошибка", () => {
    const coords = resolveIdeologyCoordinates({
      ideology: "Communism",
      governmentType: "single-party",
      stability: 50, legitimacy: 50, corruption: 20, governmentSupport: 50,
    });
    expect(coords).toEqual(IDEOLOGY_LABEL_COORDINATES["Communism"]);
  });

  it("неизвестный ярлык даёт центр спектра, а не выдуманный уклон", () => {
    const coords = resolveIdeologyCoordinates({
      ideology: "Technocratic Anarcho-Monarchism",
      governmentType: "?",
      stability: 50, legitimacy: 50, corruption: 20, governmentSupport: 50,
    });
    expect(coords).toEqual({ economic: 0, political: 0 });
  });
});

describe("regionDiscontent — вывод из состояния", () => {
  it("guard-тест критериев приёмки: разные координаты власти → разное недовольство", () => {
    const game = createDiscontentTestGame();
    const region = regionById(game, TEST_REGION_NATIONAL);

    const underStalinism = regionDiscontent(game, region)!;

    game.countries[0]!.politics.ideologyCoordinates = { economic: -0.1, political: 0.45 };
    const underMatchingRegime = regionDiscontent(game, region)!;

    expect(underStalinism).toBeGreaterThan(underMatchingRegime);
    // Совпадение позиции власти с желаемой убирает главный член формулы —
    // остаётся только фоновое недовольство.
    expect(underMatchingRegime).toBeLessThan(0.2);
  });

  it("национальный регион стоит выше кризисного порога, контрольный — ниже", () => {
    const game = createDiscontentTestGame();

    const national = regionDiscontent(game, regionById(game, TEST_REGION_NATIONAL))!;
    const control = regionDiscontent(game, regionById(game, TEST_REGION_CONTROL))!;

    expect(national).toBeGreaterThanOrEqual(REGION_CRISIS_DISCONTENT_THRESHOLD);
    expect(control).toBeLessThan(REGION_CRISIS_DISCONTENT_THRESHOLD);
  });

  it("бедность региона добавляет недовольства при той же дистанции", () => {
    const game = createDiscontentTestGame();
    const region = regionById(game, TEST_REGION_NATIONAL);

    const wellOff = regionDiscontent(game, region)!;
    expect(regionWelfare(region, game.countries[0])).toBeCloseTo(1, 10);

    region.gdp = region.gdp / 2;
    const impoverished = regionDiscontent(game, region)!;

    expect(impoverished).toBeGreaterThan(wellOff);
  });

  it("неразмеченный регион даёт undefined («неизвестно»), а не 0 («спокоен»)", () => {
    const game = createDiscontentTestGame();
    const blank = createTestRegion({ id: 999, ownerCountryId: "SUN" });
    game.regions.push(blank);

    expect(regionDiscontent(game, blank)).toBeUndefined();
  });
});

describe("discontentTick — затухание памяти воздействий", () => {
  it("следы гаснут с разной скоростью: репрессии быстро, отчуждение почти нет", () => {
    const game = createDiscontentTestGame();
    game.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0.8,
      alienation: 0.8,
      concession: 0,
      emboldenment: 0,
    });

    discontentTick(game);

    const memory = game.groupImpactMemory[0]!;
    expect(memory.suppression).toBeCloseTo(0.8 * (1 - SUPPRESSION_DECAY_RATE), 10);
    expect(memory.alienation).toBeCloseTo(0.8 * (1 - ALIENATION_DECAY_RATE), 10);
    expect(memory.alienation).toBeGreaterThan(memory.suppression);
  });

  it("полностью затухшая запись удаляется — память не растёт монотонно", () => {
    const game = createDiscontentTestGame();
    game.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0.0001,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });

    discontentTick(game);

    expect(game.groupImpactMemory).toHaveLength(0);
  });
});

describe("discontentTick — кризисный факт", () => {
  it("выдаёт типизированный факт по региону выше порога и не повторяет его каждый месяц", () => {
    const game = createDiscontentTestGame();

    discontentTick(game);

    const crisisFacts = game.pendingWorldFacts.filter(f => f.kind === "region_crisis");
    expect(crisisFacts).toHaveLength(2); // национальный регион и его сосед
    expect(crisisFacts.every(f => f.countryId === "SUN")).toBe(true);
    expect(crisisFacts.map(f => f.regionId).sort()).toEqual([185, 187]);
    expect(game.regionCrisisLatch).toEqual([185, 187]);

    game.pendingWorldFacts = [];
    discontentTick(game);
    expect(game.pendingWorldFacts.filter(f => f.kind === "region_crisis")).toHaveLength(0);
  });

  it("контрольный регион не даёт кризиса ни разу", () => {
    const game = createDiscontentTestGame();

    for (let i = 0; i < 12; i++) discontentTick(game);

    expect(game.regionCrisisLatch).not.toContain(TEST_REGION_CONTROL);
    expect(
      game.pendingWorldFacts.some(f => f.kind === "region_crisis" && f.regionId === TEST_REGION_CONTROL)
    ).toBe(false);
  });

  it("подавленный и снова вскипевший регион даёт НОВЫЙ кризис (петля замыкается)", () => {
    const game = createDiscontentTestGame();
    discontentTick(game);
    expect(game.regionCrisisLatch).toContain(TEST_REGION_NATIONAL);

    // Сильное подавление сбивает недовольство ниже порога снятия — латч уходит.
    game.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 1,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });
    discontentTick(game);
    expect(game.regionCrisisLatch).not.toContain(TEST_REGION_NATIONAL);

    // След репрессий выдыхается — недовольство возвращается и даёт новый факт.
    game.pendingWorldFacts = [];
    for (let i = 0; i < 24; i++) discontentTick(game);

    expect(game.regionCrisisLatch).toContain(TEST_REGION_NATIONAL);
    expect(
      game.pendingWorldFacts.some(f => f.kind === "region_crisis" && f.regionId === TEST_REGION_NATIONAL)
    ).toBe(true);
  });

  it("латч хранится отсортированным — состояние детерминировано независимо от порядка обхода", () => {
    const game = createDiscontentTestGame();
    game.regions.reverse();

    discontentTick(game);

    expect(game.regionCrisisLatch).toEqual([...game.regionCrisisLatch].sort((a, b) => a - b));
  });
});
