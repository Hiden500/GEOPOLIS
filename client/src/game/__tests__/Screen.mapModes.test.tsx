// @vitest-environment happy-dom
/**
 * РЕЖИМЫ и ЛЕГЕНДА игрового экрана — на модели, собранной АДАПТЕРОМ.
 *
 * Окружение задано пофайлово: остальным тестам клиента DOM не нужен, и менять
 * его для всех ради одного файла значило бы платить за него везде.
 *
 * Модель здесь собирается `buildScreenModel` из фикстуры `GameState`, а не
 * пишется прямо под тест. Это принципиально: проверяется СТЫК адаптера с
 * экраном. Дефект, ради которого тест написан, жил именно на стыке — экран
 * искал иконку и легенду по ключам ПЕСОЧНИЦЫ (`discontent`, `armies`,
 * `terrain`), а игра передавала шифры движка (`sta`, `mil`, `inf`).
 * Пересечение множеств было пустым: в игре все кнопки режимов рисовались без
 * иконок, а легенда не появлялась никогда. Модель, написанная под тест, этого
 * не показала бы — она повторила бы словарь автора теста.
 *
 * Снимков вёрстки здесь нет намеренно: снимок ломается от любой правки
 * оформления и не проверяет ни одного свойства.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { activeCampaign } from "@shared/types/Campaign";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import i18n from "../../i18n";
import { buildScreenModel } from "../adapter";
import { computeMapModeColors, legendForMode } from "../mapModeColors";
import { MAP_MODE_ORDER, type MapMode, type ScreenModel } from "../model";
import { Screen } from "../Screen";

/* ── Фикстура состояния ─────────────────────────────────────────── */

/**
 * Полный набор ключей с нулями. Не приведение пустого объекта: тип требует все
 * ключи, и фикстура, которая о них соврала, скрыла бы от теста как раз то, что
 * читает адаптер (склад показывается только тем, что в нём реально лежит).
 */
function zeros<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function country(id: string, relationToPlayer: number): Country {
  return {
    id,
    name: { ru: id, en: id },
    shortName: { ru: id, en: id },
    color: "#888888",
    tier: "major",
    capitalRegionId: 1,
    population: 1_000_000,
    economyProfile: {
      taxRate: 0.2,
      spending: {
        military: 0.3,
        research: 0.2,
        education: 0.2,
        infrastructure: 0.1,
        welfare: 0.15,
        other: 0.05,
      },
      treasuryShare: 0.2,
      exportShare: 0.1,
      stateEnterpriseShare: 0.04,
      otherIncomeShare: 0.02,
      inflation: 2,
      unemployment: 5,
      tradeBalance: 0,
    },
    economy: {
      gdp: 100_000_000_000,
      treasury: 10_000_000_000,
      taxRevenue: 20_000_000_000,
      taxRate: 0.2,
      exportIncome: 0,
      importSpending: 0,
      stateEnterpriseIncome: 0,
      otherIncome: 0,
      militarySpending: 0,
      researchSpending: 0,
      educationSpending: 0,
      infrastructureSpending: 0,
      welfareSpending: 0,
      debt: 0,
      debtInterest: 0,
      otherExpenses: 0,
      inflation: 2,
      unemployment: 5,
      tradeBalance: 0,
      budgetBalance: 0,
    },
    economyType: "market",
    technology: { domains: {} },
    researchedTechnologyIds: [],
    military: {
      manpower: 0,
      activePersonnel: 0,
      reservePersonnel: 0,
      militaryBudget: 0,
      armyStrength: 0.5,
      navyStrength: 0.5,
      airStrength: 0.5,
      nuclearWarheads: 0,
      units: [],
      equipment: zeros(Object.values(EquipmentType)),
    },
    diplomacy: {
      allies: [],
      rivals: [],
      puppets: [],
      sphereOfInfluence: [],
      // Отношение ВЛАДЕЛЬЦА региона к игроку — именно его читает раскраска
      // режима «Блоки».
      relations: { SUN: relationToPlayer },
      influence: {},
      guarantees: [],
      sanctions: {},
    },
    politics: {
      ideology: "communism",
      stability: 70,
      legitimacy: 60,
      corruption: 30,
      governmentSupport: 50,
    },
    stockpile: zeros(Object.values(ResourceType)),
    goals: [],
    aiTraits: { aggressiveness: 1, riskTolerance: 1 },
  };
}

function region(
  id: number,
  ownerCountryId: string,
  values: { level: number; stability: number; population: number; deposits: number },
): Region {
  return {
    id,
    geoJsonId: `R-${id}`,
    names: { ru: `Регион ${id}`, en: `Region ${id}` },
    ownerCountryId,
    population: values.population,
    area: 1000,
    urbanization: 0.5,
    stability: values.stability,
    infrastructure: values.level,
    development: values.level,
    gdp: 1_000_000_000,
    deposits: { oil: values.deposits },
    extraction: {},
    neighboringRegionIds: [],
  };
}

/**
 * Регионы фикстуры покрывают ВСЕ ведра раскраски: по одному на каждую градацию
 * каждого режима и по одному на каждое отношение к игроку. Без этого проверка
 * «легенда объясняет ровно те цвета, которые карта рисует» была бы слабее, чем
 * выглядит: непокрытое ведро легенда обещала бы, а карта не показывала.
 */
const PLAYER_ID = "SUN";

function gameState(): GameState {
  return {
    currentDate: "1946-03-01",
    playerCountryId: PLAYER_ID,
    campaign: activeCampaign(),
    countries: [country(PLAYER_ID, 100), country("ALY", 50), country("FOE", -50), country("NEU", 0)],
    era: {
      id: "1946",
      name: "1946",
      startYear: 1946,
      endYear: 2000,
      technologyDomains: [],
    },
    regions: [
      region(1, PLAYER_ID, { level: 0.9, stability: 0.9, population: 2_000_000, deposits: 2000 }),
      region(2, "ALY", { level: 0.45, stability: 0.5, population: 500_000, deposits: 500 }),
      region(3, "FOE", { level: 0.1, stability: 0.2, population: 100_000, deposits: 10 }),
      region(4, "NEU", { level: 0.1, stability: 0.2, population: 100_000, deposits: 10 }),
    ],
    rngState: 1,
    nextFeatureId: 0,
    locale: "ru",
    playerIntent: "",
    eventHistory: [],
    chronicle: [],
    mapFeatures: [],
    wars: [],
    modifiers: [],
    pendingWorldFacts: [],
    ethnicGroups: [],
    ideologyAnchors: [],
    groupImpactMemory: [],
    regionCrisisLatch: [],
    primitiveBatchKeys: [],
    primitiveNoopBatchKeys: [],
    primitiveTurnBudget: emptyPrimitiveTurnBudget("1946-03-01"),
    hingePointShowCount: {},
    llmRespondedThisTurn: true,
    playerStanding: { power: 1, rank: 1, total: 4 },
  };
}

/* ── Сборка модели ровно так, как её собирает игра ───────────────── */

const t = i18n.getFixedT(null, "screen");

function buildModel(game: GameState): ScreenModel {
  return buildScreenModel({
    game,
    locale: "ru",
    renderLine: () => "",
    // Тот же способ, что в `GameShell`: список режимов и подписи приходят из
    // словаря по одному и тому же порядку.
    mapModes: MAP_MODE_ORDER.map((mode) => ({ id: mode, name: t(`mapModes.${mode}`) })),
    isIrreversible: () => false,
    monthsNominative: t("monthsNominative", { returnObjects: true }) as string[],
    monthsGenitive: t("monthsGenitive", { returnObjects: true }) as string[],
    ordersPerTurn: 10,
    domainName: (id) => id,
    campaign: null,
  });
}

function renderScreen(mapMode: MapMode) {
  const game = gameState();
  return render(
    <Screen
      model={buildModel(game)}
      mapMode={mapMode}
      onMapMode={() => undefined}
      selectedRegionId={null}
      onSelectRegion={() => undefined}
      onAdvance={() => undefined}
      mapSlot={<div data-testid="map" />}
    />,
  );
}

/** «#7aa653» и «rgb(122, 166, 83)» — один цвет; сравнивать надо не строки. */
function rgb(value: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const n = Number.parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const parts = value.match(/\d+/g);
  if (parts === null) throw new Error(`образец легенды без цвета: «${value}»`);
  return parts.slice(0, 3).join(",");
}

afterEach(cleanup);

describe("РЕЖИМЫ карты", () => {
  it("проверяет непустой список режимов — иначе проверки ниже ничего не значат", () => {
    expect(MAP_MODE_ORDER.length).toBeGreaterThan(0);
  });

  it("у каждой кнопки режима есть иконка", () => {
    renderScreen("powers");

    for (const mode of MAP_MODE_ORDER) {
      const button = screen.getByRole("button", { name: t(`mapModes.${mode}`) });
      expect(button.querySelector("svg"), `режим ${mode} без иконки`).not.toBeNull();
    }
  });

  /*
   * Состояние кнопки обязано быть доступно не только глазам: вид нажатой кнопки
   * скринридеру не виден, а «какой режим включён» — это ровно то, что панель
   * сообщает (`docs/UI_DESIGN.md` §9). Крючок `aria-pressed` держит ещё и
   * акцентную подсветку глифа в CSS — то есть свойство и вид не разойдутся.
   */
  it("включённый режим назван нажатым, остальные — нет", () => {
    renderScreen("unrest");

    for (const mode of MAP_MODE_ORDER) {
      const button = screen.getByRole("button", { name: t(`mapModes.${mode}`) });
      expect(button.getAttribute("aria-pressed"), `режим ${mode}`).toBe(
        mode === "unrest" ? "true" : "false",
      );
    }
  });

  it("сетка режимов названа группой", () => {
    renderScreen("powers");

    const group = screen.getByRole("group", { name: t("mapModesGroup") });
    expect(within(group).getAllByRole("button")).toHaveLength(MAP_MODE_ORDER.length);
  });

  it("кнопок ровно столько, сколько режимов в словаре", () => {
    renderScreen("powers");

    const labels = MAP_MODE_ORDER.map((mode) => t(`mapModes.${mode}`));
    const shown = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((label): label is string => label !== null && labels.includes(label));
    expect(shown).toHaveLength(MAP_MODE_ORDER.length);
  });
});

describe("ЛЕГЕНДА карты", () => {
  /*
   * Свойство: легенда объясняет РОВНО те цвета, которые раскраска действительно
   * выдаёт на этих данных. Не «легенда непустая» и не «цвета из палитры» —
   * именно совпадение множеств. Разошлись — либо легенда обещает градацию,
   * которой карта не рисует, либо карта рисует цвет, которого легенда не
   * объясняет.
   */
  it.each(MAP_MODE_ORDER)("в режиме %s объясняет ровно нарисованные цвета", (mode) => {
    const game = gameState();
    const painted = computeMapModeColors(mode, game.regions, game.countries, game.playerCountryId);
    const explained = legendForMode(mode).map((item) => item.swatch);

    expect(new Set(Object.values(painted ?? {}))).toEqual(new Set(explained));
  });

  it("не рисуется там, где цвет не означает величину", () => {
    renderScreen("powers");

    expect(legendForMode("powers")).toHaveLength(0);
    expect(screen.queryByRole("list", { name: t("mapModes.powers") })).toBeNull();
    // Имя режима видно и без легенды: панель обязана называть то, что показывает.
    expect(screen.getByText(t("mapModes.powers"))).not.toBeNull();
  });

  it.each(MAP_MODE_ORDER.filter((mode) => legendForMode(mode).length > 0))(
    "в режиме %s показывает подпись и образец каждой градации",
    (mode) => {
      renderScreen(mode);

      /*
       * Легенда ищется по ИМЕНИ АКТИВНОГО РЕЖИМА: её доступное имя — тот самый
       * видимый заголовок панели (`aria-labelledby`), поэтому проверка заодно
       * доказывает, что панель называет показанное.
       */
      const legenda = screen.getByRole("list", { name: t(`mapModes.${mode}`) });
      const items = within(legenda).getAllByRole("listitem");
      const expected = legendForMode(mode);

      expect(items).toHaveLength(expected.length);
      items.forEach((item, index) => {
        const swatch = item.querySelector("span");
        expect(swatch, "образец цвета не нарисован").not.toBeNull();
        expect(rgb((swatch as HTMLElement).style.background)).toBe(rgb(expected[index].swatch));
        // Подпись взята из словаря — и это НЕ сам ключ: i18next возвращает
        // ключ, когда строки нет, и сравнение с `t()` тогда сошлось бы само с
        // собой.
        const label = t(`legend.${expected[index].labelKey}`);
        expect(label).not.toContain("legend.");
        expect(item.textContent).toBe(label);
      });
    },
  );
});
