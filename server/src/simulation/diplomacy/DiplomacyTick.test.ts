import { describe, it, expect } from "vitest";
import { diplomacyTick, calculateBaseInfluence } from "./DiplomacyTick";
import { createTestCountry, createTestRegion, createTestGameState } from "../../test-utils/fixtures";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type IdeologyCoordinates } from "@shared/types/politics/Ideology";
import {
  RELATION_MATERIALIZE_MIN,
  ALLY_RELATION_THRESHOLD,
} from "@shared/defines/diplomacy";

/**
 * Координаты, а не ярлыки: движок читает числа. Совпадающие точки дают
 * дистанцию 0, противоположные углы квадрата [-1,1]² — дистанцию 1.
 */
const LEFT_AUTHORITARIAN: IdeologyCoordinates = { economic: -1, political: -1 };
const RIGHT_DEMOCRATIC: IdeologyCoordinates = { economic: 1, political: 1 };

function countryAt(
  id: string,
  coordinates: IdeologyCoordinates,
  overrides: Partial<Country> = {}
): Country {
  const base = createTestCountry();
  return createTestCountry({
    id,
    ...overrides,
    politics: { ...base.politics, ideologyCoordinates: coordinates, ...overrides.politics },
    diplomacy: { ...base.diplomacy, ...overrides.diplomacy },
  });
}

/** Мир из перечисленных стран; соседство задаётся парой смежных регионов. */
function worldOf(countries: Country[], neighbours: [string, string][] = []): GameState {
  const regions = countries.map((c, i) =>
    createTestRegion({ id: i + 1, geoJsonId: `R${i + 1}`, ownerCountryId: c.id })
  );
  const regionOf = new Map(countries.map((c, i) => [c.id, regions[i]!]));
  for (const [a, b] of neighbours) {
    const ra = regionOf.get(a)!;
    const rb = regionOf.get(b)!;
    ra.neighboringRegionIds = [...ra.neighboringRegionIds, rb.id];
    rb.neighboringRegionIds = [...rb.neighboringRegionIds, ra.id];
  }
  return createTestGameState({ countries, regions, playerCountryId: countries[0]!.id });
}

function runTicks(game: GameState, count: number): void {
  for (let i = 0; i < count; i++) diplomacyTick(game);
}

function relation(game: GameState, from: string, to: string): number {
  return game.countries.find(c => c.id === from)!.diplomacy.relations[to] ?? 0;
}

describe("diplomacyTick: дрейф отношений", () => {
  it("тянет завышенные отношения вниз, к структурному тяготению пары", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, relations: { B: 50 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.relations["B"]).toBeLessThan(50);
    expect(a.diplomacy.relations["B"]).toBeGreaterThan(0);
  });

  it("тянет заниженные отношения вверх", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, relations: { B: -50 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.relations["B"]).toBeGreaterThan(-50);
    expect(a.diplomacy.relations["B"]).toBeLessThan(0);
  });

  it("целью дрейфа служит НЕ ноль: соседи-антиподы уходят в минус с нуля", () => {
    // Главное отличие от прежнего «затухания к нейтральности»: пара, которой
    // никто ничего не делал, всё равно расходится — потому что её тянет
    // собственное положение в мире, а не отсутствие событий.
    const a = countryAt("A", LEFT_AUTHORITARIAN);
    const b = countryAt("B", RIGHT_DEMOCRATIC);
    const game = worldOf([a, b], [["A", "B"]]);

    runTicks(game, 24);

    expect(relation(game, "A", "B")).toBeLessThan(-RELATION_MATERIALIZE_MIN);
    expect(relation(game, "B", "A")).toBeLessThan(-RELATION_MATERIALIZE_MIN);
  });

  it("пара без единого канала связи записи в состоянии не заводит", () => {
    // Цена решения названа числом: материализуются только пары с каналом,
    // иначе сейв получил бы всю матрицу n².
    const a = countryAt("A", LEFT_AUTHORITARIAN);
    const b = countryAt("B", RIGHT_DEMOCRATIC);
    const game = worldOf([a, b]);

    runTicks(game, 24);

    expect(Object.keys(game.countries[0]!.diplomacy.relations)).toEqual([]);
    expect(Object.keys(game.countries[1]!.diplomacy.relations)).toEqual([]);
  });

  it("затухание влияния не опускается ниже нуля", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, influence: { B: 40 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.influence["B"]).toBeLessThan(40);
    expect(a.diplomacy.influence["B"]).toBeGreaterThanOrEqual(0);
  });
});

describe("diplomacyTick: пороговые переходы", () => {
  it("автоматически добавляет соперника при отношениях ниже -70", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, relations: { B: -75 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.rivals).toContain("B");
  });

  it("союз требует взаимного порога (регрессия на flip-flop)", () => {
    // Раньше: одностороннее высокое relation (A->B) приводило к addAlly(), а при
    // обработке B в том же тике его низкое relation немедленно снимало союз.
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, relations: { B: 75 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);
    const game = worldOf([a, b]);

    diplomacyTick(game);

    expect(a.diplomacy.allies).not.toContain("B");
    expect(b.diplomacy.allies).not.toContain("A");
  });

  it("снимает соперника при отношениях выше -30", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, {
      diplomacy: { ...createTestCountry().diplomacy, relations: { B: -20 }, rivals: ["B"] },
    });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.rivals).not.toContain("B");
  });

  it("снимает союзника при отношениях ниже порога распада", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, {
      diplomacy: { ...createTestCountry().diplomacy, relations: { B: 10 }, allies: ["B"] },
    });
    const b = countryAt("B", LEFT_AUTHORITARIAN, {
      diplomacy: { ...createTestCountry().diplomacy, relations: { A: 10 }, allies: ["A"] },
    });

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.allies).not.toContain("B");
  });

  it("добавляет страну в сферу влияния при влиянии выше 50", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, { diplomacy: { ...createTestCountry().diplomacy, influence: { B: 60 } } });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.sphereOfInfluence).toContain("B");
  });

  it("убирает страну из сферы влияния при влиянии ниже 20", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN, {
      diplomacy: { ...createTestCountry().diplomacy, influence: { B: 10 }, sphereOfInfluence: ["B"] },
    });
    const b = countryAt("B", LEFT_AUTHORITARIAN);

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.sphereOfInfluence).not.toContain("B");
  });

  it("не падает на стране без записанных отношений", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN);

    expect(() => diplomacyTick(worldOf([a]))).not.toThrow();
  });
});

describe("diplomacyTick: идеология модифицирует, а не запрещает", () => {
  it("союз заключают страны, которых прежний гейт не пускал ни к кому", () => {
    // Прямая регрессия дефекта 103 стран. Ярлык `Traditionalism` не содержит ни
    // одной из шести подстрок старой проверки (democracy/republic/communism/
    // socialism/fascism/monarchy), поэтому до 2026-07-28 две такие страны не
    // могли заключить союз ни при каких отношениях — включая союз друг с другом
    // при полностью совпадающих координатах.
    const shared = { economic: 0.2, political: -0.45 };
    const a = countryAt("A", shared, {
      politics: { ...createTestCountry().politics, ideology: "Traditionalism" },
      diplomacy: { ...createTestCountry().diplomacy, relations: { B: 75 } },
    });
    const b = countryAt("B", shared, {
      politics: { ...createTestCountry().politics, ideology: "Traditionalism" },
      diplomacy: { ...createTestCountry().diplomacy, relations: { A: 75 } },
    });

    diplomacyTick(worldOf([a, b]));

    expect(a.diplomacy.allies).toContain("B");
    expect(b.diplomacy.allies).toContain("A");
  });

  it("движок читает координаты, а не ярлык: смена ярлыка ничего не решает", () => {
    // Требование решения пользователя дословно: «числа — для движка, ярлык —
    // для показа; тест обязан удерживать это разделение». Две пары различаются
    // ТОЛЬКО текстом ярлыка при одних и тех же координатах — исход обязан
    // совпасть. На старом гейте эта пара тестов расходилась бы: первая пара
    // союзники (обе `democracy`), вторая — нет.
    const shared = { economic: -0.9, political: -0.8 };
    const build = (labelA: string, labelB: string): [Country, Country] => [
      countryAt("A", shared, {
        politics: { ...createTestCountry().politics, ideology: labelA },
        diplomacy: { ...createTestCountry().diplomacy, relations: { B: 78 } },
      }),
      countryAt("B", shared, {
        politics: { ...createTestCountry().politics, ideology: labelB },
        diplomacy: { ...createTestCountry().diplomacy, relations: { A: 78 } },
      }),
    ];

    const [sameLabelA, sameLabelB] = build("democracy", "democracy");
    const [oddLabelA, oddLabelB] = build("Nationalism", "Authoritarianism");
    diplomacyTick(worldOf([sameLabelA, sameLabelB]));
    diplomacyTick(worldOf([oddLabelA, oddLabelB]));

    expect(oddLabelA.diplomacy.allies).toEqual(sameLabelA.diplomacy.allies);
    expect(oddLabelB.diplomacy.allies).toEqual(sameLabelB.diplomacy.allies);
    expect(sameLabelA.diplomacy.allies).toContain("B");
  });

  it("антиподам нужны более высокие отношения, чем родственным", () => {
    // Порог перестал быть общим: одно и то же значение отношений открывает союз
    // родственным и не открывает антиподам.
    const between = ALLY_RELATION_THRESHOLD + 1;
    const pair = (coordinatesA: IdeologyCoordinates, coordinatesB: IdeologyCoordinates): Country[] => [
      countryAt("A", coordinatesA, {
        diplomacy: { ...createTestCountry().diplomacy, relations: { B: between } },
      }),
      countryAt("B", coordinatesB, {
        diplomacy: { ...createTestCountry().diplomacy, relations: { A: between } },
      }),
    ];

    const kindred = pair(LEFT_AUTHORITARIAN, LEFT_AUTHORITARIAN);
    const opposites = pair(LEFT_AUTHORITARIAN, RIGHT_DEMOCRATIC);
    diplomacyTick(worldOf(kindred, [["A", "B"]]));
    diplomacyTick(worldOf(opposites, [["A", "B"]]));

    expect(kindred[0]!.diplomacy.allies).toContain("B");
    expect(opposites[0]!.diplomacy.allies).not.toContain("B");
  });
});

describe("diplomacyTick: общий враг перевешивает идеологическую вражду", () => {
  /** Мир «двое антиподов и их общий враг», война — по требованию теста. */
  function antipodesAgainst(commonEnemy: boolean): GameState {
    const a = countryAt("A", LEFT_AUTHORITARIAN);
    const b = countryAt("B", RIGHT_DEMOCRATIC);
    const foe = countryAt("FOE", { economic: 0, political: 0 });
    const game = worldOf([a, b, foe], [["A", "B"]]);
    if (commonEnemy) {
      game.wars = [
        {
          id: "w1",
          attackers: ["A", "B"],
          defenders: ["FOE"],
          supporters: [],
          startDate: game.currentDate,
          active: true,
          territoryFlips: { toAttackers: 0, toDefenders: 0 },
          casualties: {},
        },
      ];
    }
    return game;
  }

  it("союз идеологических антиподов складывается САМ, пока жив общий враг", () => {
    const game = antipodesAgainst(true);

    runTicks(game, 120);

    expect(game.countries[0]!.diplomacy.allies).toContain("B");
    expect(game.countries[1]!.diplomacy.allies).toContain("A");
  });

  it("исчез общий враг — исчезло основание: союз антиподов распадается", () => {
    const game = antipodesAgainst(true);
    runTicks(game, 120);
    expect(game.countries[0]!.diplomacy.allies).toContain("B");

    game.wars[0]!.active = false;
    runTicks(game, 120);

    expect(game.countries[0]!.diplomacy.allies).not.toContain("B");
    expect(game.countries[1]!.diplomacy.allies).not.toContain("A");
  });

  it("без общего врага антиподы союз не заключают вовсе", () => {
    const game = antipodesAgainst(false);

    runTicks(game, 240);

    expect(game.countries[0]!.diplomacy.allies).not.toContain("B");
  });

  it("союз родственных идеологий переживает исчезновение общего врага", () => {
    // Вторая половина требования «дороже и недолговечнее»: недолговечен именно
    // союз антиподов, а не всякий союз, рождённый войной.
    const a = countryAt("A", LEFT_AUTHORITARIAN);
    const b = countryAt("B", LEFT_AUTHORITARIAN);
    const foe = countryAt("FOE", RIGHT_DEMOCRATIC);
    const game = worldOf([a, b, foe], [["A", "B"]]);
    game.wars = [
      {
        id: "w1",
        attackers: ["A", "B"],
        defenders: ["FOE"],
        supporters: [],
        startDate: game.currentDate,
        active: true,
        territoryFlips: { toAttackers: 0, toDefenders: 0 },
        casualties: {},
      },
    ];

    runTicks(game, 120);
    expect(game.countries[0]!.diplomacy.allies).toContain("B");

    game.wars[0]!.active = false;
    runTicks(game, 240);

    expect(game.countries[0]!.diplomacy.allies).toContain("B");
  });

  it("мир не сваливается в блоки сам: родственные соседи без врага союз не образуют", () => {
    const a = countryAt("A", LEFT_AUTHORITARIAN);
    const b = countryAt("B", LEFT_AUTHORITARIAN);
    const game = worldOf([a, b], [["A", "B"]]);

    runTicks(game, 600);

    expect(game.countries[0]!.diplomacy.allies).toEqual([]);
    expect(relation(game, "A", "B")).toBeGreaterThan(0);
  });
});

describe("calculateBaseInfluence", () => {
  it("выше у того, кто сильнее экономически и военно", () => {
    const strong = createTestCountry({ id: "STRONG" });
    const weak = createTestCountry({
      id: "WEAK",
      military: { ...createTestCountry().military, manpower: 1 },
      economy: { ...createTestCountry().economy, gdp: 1 },
    });

    expect(calculateBaseInfluence(strong, weak)).toBeGreaterThan(calculateBaseInfluence(weak, strong));
  });

  it("ограничен сотней", () => {
    const dominant = createTestCountry({
      id: "DOMINANT",
      military: { ...createTestCountry().military, manpower: 1_000_000_000 },
      economy: { ...createTestCountry().economy, gdp: 1_000_000_000_000_000 },
    });
    const tiny = createTestCountry({
      id: "TINY",
      military: { ...createTestCountry().military, manpower: 1 },
      economy: { ...createTestCountry().economy, gdp: 1 },
    });

    expect(calculateBaseInfluence(dominant, tiny)).toBe(100);
  });
});
