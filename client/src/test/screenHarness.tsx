/**
 * ФИКСТУРА И СБОРКА ИГРОВОГО ЭКРАНА для тестов.
 *
 * Модель собирается `buildScreenModel` из фикстуры `GameState` — тем же
 * впрыском, что в `GameShell`, — а не пишется прямо под тест. Это принципиально:
 * проверяется СТЫК адаптера с экраном. Модель, написанная под тест, повторила бы
 * словарь автора теста и спрятала бы расхождение (`docs/UI_DESIGN.md` §11).
 *
 * Лежит ВНЕ `client/src/game/**` нарочно: там русская строка в коде — дефект, и
 * `gameLayerLiterals.test.ts` роняет сборку за неё. Фикстуре русские имена
 * регионов нужны (это ДАННЫЕ, а не интерфейс), а ослаблять из-за неё охрану
 * игрового слоя нельзя.
 */
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { activeCampaign } from "@shared/types/Campaign";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import i18n from "../i18n";
import { type Translator } from "../i18n/Translator";
import { buildScreenModel } from "../game/adapter";
import { MAP_MODE_ORDER, type MapMode, type ScreenModel } from "../game/model";
import { Screen } from "../game/Screen";
import { render } from "@testing-library/react";
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
    /*
     * Демо-состав РАЗМЕЧЕН: без него `RegionDetail` падает на
     * `region.groups[0].name`, и ПОЛОСУ не отрисовать вовсе. Регион без записи
     * — законное состояние по `shared/src/types/map/Region.ts`, то есть падение
     * настоящее; чинить его не в области этой задачи, поэтому здесь фикстура
     * просто описывает размеченный регион, как в живом сценарии 1946.
     */
    demographics: [
      { groupId: "rus", share: 0.8 },
      { groupId: "tat", share: 0.2 },
    ],
  };
}

/**
 * Регионы фикстуры покрывают ВСЕ ведра раскраски: по одному на каждую градацию
 * каждого режима и по одному на каждое отношение к игроку. Без этого проверка
 * «легенда объясняет ровно те цвета, которые карта рисует» была бы слабее, чем
 * выглядит: непокрытое ведро легенда обещала бы, а карта не показывала.
 */
export const PLAYER_ID = "SUN";

export function gameState(): GameState {
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

export const t = i18n.getFixedT(null, "screen");

/**
 * Переводчик АДАПТЕРА — тот же впрыск, что в `GameShell`: адаптер хук вызвать не
 * может и получает переводчик полем входа. Namespace объявлен типом, поэтому
 * подставить сюда переводчик рамы (`screen`) компилятор не даст.
 */
const tAdapterFixed = i18n.getFixedT(null, "adapter");
const tAdapter: Translator<"adapter"> = (key, params) => tAdapterFixed(key, params);

export function buildModel(game: GameState): ScreenModel {
  return buildScreenModel({
    game,
    locale: "ru",
    renderLine: () => "",
    t: tAdapter,
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

/**
 * Выбранный регион задаётся вторым доводом: ПОЛОСА рисуется только при выборе,
 * и без него проверить её раскладку нечем. Идентификаторы — строки, как их
 * отдаёт карта.
 */
export function renderScreen(mapMode: MapMode, selectedRegionId: string | null = null) {
  const game = gameState();
  return render(
    <Screen
      model={buildModel(game)}
      mapMode={mapMode}
      onMapMode={() => undefined}
      selectedRegionId={selectedRegionId}
      onSelectRegion={() => undefined}
      onAdvance={() => undefined}
      mapSlot={<div data-testid="map" />}
    />,
  );
}
