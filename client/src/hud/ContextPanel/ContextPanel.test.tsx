import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type GameState } from "@shared/types/GameState";
import { type GroupImpactMemory } from "@shared/types/politics/Demographics";
import "../../i18n";
import { ContextPanel } from "./ContextPanel";

/**
 * Отклик в интерфейсе (Милстоун 0, сессия B).
 *
 * Главное требование, которое здесь проверяется, — не «панель что-то рисует», а
 * «три ответа на кризис РАЗЛИЧИМЫ для игрока». Механически ветки расходятся
 * (доказано `branchDivergence.test.ts` на сервере), но если интерфейс покажет
 * только индекс недовольства, для игрока они будут косметикой: индекс падает у
 * всех трёх. Различает их то, ЧТО осталось после — отчуждение, уступка,
 * сдвинутая координата курса.
 */

const REGION_ID = 187;

function baseGame(memory: GroupImpactMemory[], political = -0.9): GameState {
  return {
    currentDate: "1946-03-01",
    playerCountryId: "SUN",
    countries: [
      {
        id: "SUN",
        name: { ru: "СССР", en: "USSR" },
        shortName: { ru: "СССР", en: "USSR" },
        color: "#c33",
        population: 3_000_000,
        economy: { gdp: 1_200_000_000, treasury: 1000, budgetBalance: 10 },
        politics: {
          ideology: "Communism",
          governmentType: "One-party state",
          stability: 70,
          legitimacy: 50,
          governmentSupport: 50,
          ideologyCoordinates: { economic: -0.95, political },
        },
        diplomacy: { relations: {}, allies: [], rivals: [] },
      },
    ] as unknown as GameState["countries"],
    regions: [
      {
        id: REGION_ID,
        geoJsonId: "T-187",
        names: { ru: "Шяуляй", en: "Šiauliai" },
        ownerCountryId: "SUN",
        population: 1_000_000,
        area: 1,
        urbanization: 0.3,
        stability: 0.6,
        infrastructure: 0.5,
        development: 0.5,
        gdp: 400_000_000,
        deposits: {},
        extraction: {},
        neighboringRegionIds: [],
        demographics: [
          { groupId: "lithuanians", share: 0.88 },
          { groupId: "russians", share: 0.12 },
        ],
      },
    ] as unknown as GameState["regions"],
    // Каталог именованных зон пуст намеренно: тест проверяет, что сдвиг
    // координат виден игроку, а склейка ступеней шкалы показывает его так же,
    // как имя якоря, и не зависит от содержимого каталога эпохи.
    ideologyAnchors: [],
    ethnicGroups: [
      {
        id: "lithuanians",
        names: { ru: "Литовцы", en: "Lithuanians" },
        desiredIdeology: { economic: -0.1, political: 0.45 },
      },
      {
        id: "russians",
        names: { ru: "Русские", en: "Russians" },
        desiredIdeology: { economic: -0.7, political: -0.55 },
      },
    ],
    groupImpactMemory: memory,
    regionCrisisLatch: [REGION_ID],
    mapFeatures: [],
  } as unknown as GameState;
}

function trace(overrides: Partial<GroupImpactMemory>): GroupImpactMemory {
  return {
    regionId: REGION_ID,
    groupId: "lithuanians",
    suppression: 0,
    alienation: 0,
    concession: 0,
    emboldenment: 0,
    ...overrides,
  };
}

function renderRegion(game: GameState): string {
  const { container } = render(
    <ContextPanel
      selection={{ type: "region", regionId: REGION_ID }}
      game={game}
      onClose={() => {}}
      onSelectCountry={() => {}}
      onCompare={() => {}}
    />
  );
  return container.textContent ?? "";
}

describe("ContextPanel — недовольство региона", () => {
  it("показывает индекс, разложение по группам и пометку кризиса", () => {
    const text = renderRegion(baseGame([]));

    expect(text).toContain("Индекс недовольства");
    expect(text).toContain("Литовцы");
    expect(text).toContain("Русские");
    expect(text).toContain("Кризис");
  });

  it("три ветки ответа дают ТРИ РАЗНЫХ текста, а не одно и то же число", () => {
    // Следы, которые оставляют три ответа: подавление пишет suppression +
    // alienation, уступка — concession, реформа не пишет в память региона вовсе,
    // но двигает координату курса страны.
    const afterRepress = renderRegion(
      baseGame([trace({ suppression: 0.42, alienation: 0.11 })])
    );
    const afterAutonomy = renderRegion(baseGame([trace({ concession: 0.39 })]));
    const afterReform = renderRegion(baseGame([], -0.86));

    expect(afterRepress).toContain("отчуждение");
    expect(afterRepress).toContain("подавление");

    expect(afterAutonomy).toContain("уступки");
    expect(afterAutonomy).not.toContain("отчуждение");

    // Реформа следа в регионе не оставляет — и панель этого не выдумывает.
    expect(afterReform).not.toContain("отчуждение");
    expect(afterReform).not.toContain("уступки");

    expect(new Set([afterRepress, afterAutonomy, afterReform]).size).toBe(3);
  });

  it("сдвиг курса от реформы виден в панели страны", () => {
    const before = render(
      <ContextPanel
        selection={{ type: "country", countryId: "SUN" }}
        game={baseGame([], -0.9)}
        onClose={() => {}}
        onSelectCountry={() => {}}
        onCompare={() => {}}
      />
    ).container.textContent;

    const after = render(
      <ContextPanel
        selection={{ type: "country", countryId: "SUN" }}
        game={baseGame([], -0.86)}
        onClose={() => {}}
        onSelectCountry={() => {}}
        onCompare={() => {}}
      />
    ).container.textContent;

    expect(before).toContain("-0.90");
    expect(after).toContain("-0.86");
    expect(before).not.toBe(after);
    expect(after).toContain("Поддержка правительства");
  });
});

describe("ContextPanel — история места (docs/CONCEPT.md §5.6)", () => {
  it("рендерит записи локалью интерфейса, свежие сверху", () => {
    const game = baseGame([]);
    game.regions[0]!.placeHistory = [
      {
        date: "1946-02-01",
        verb: "repress",
        line: {
          key: "repress.headline",
          values: { addressed: 2, unaffected: 0 },
          names: { region: { ru: "Шяуляй", en: "Šiauliai" } },
        },
      },
      {
        date: "1946-03-01",
        verb: "grant_autonomy",
        line: {
          key: "grantAutonomy.headline",
          names: { region: { ru: "Шяуляй", en: "Šiauliai" } },
        },
      },
    ];

    const text = renderRegion(game);

    expect(text).toContain("История места");
    expect(text).toContain("Автономия предоставлена");
    expect(text).toContain("Силовое подавление");
    // Свежая запись выше старой.
    expect(text.indexOf("Автономия предоставлена")).toBeLessThan(
      text.indexOf("Силовое подавление")
    );
  });

  it("регион без истории секцию не показывает — пустых заголовков не бывает", () => {
    expect(renderRegion(baseGame([]))).not.toContain("История места");
  });
});
