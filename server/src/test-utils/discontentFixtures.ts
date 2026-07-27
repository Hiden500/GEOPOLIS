import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type EthnicGroupDefinition } from "@shared/types/politics/Demographics";
import { createTestCountry, createTestRegion, createTestGameState } from "./fixtures";

/**
 * Мини-мир для тестов недовольства и примитивов: одна авторитарная держава
 * (SUN), один национальный регион с большой идеологической дистанцией, его
 * сосед с той же титульной группой (для проверки «соседи осмелели») и
 * контрольный регион со славянским большинством (малая дистанция).
 *
 * Числа подобраны так, чтобы относительное благосостояние всех регионов было
 * ровно 1.0 (ВВП на душу региона = ВВП на душу страны): экономический член
 * формулы обнуляется, и тест меряет ровно геометрию дистанции, а не смесь.
 */

export const TEST_GROUP_TITULAR = "lithuanians";
export const TEST_GROUP_LOYAL = "russians";

/** Национальный регион: 88% титульной нации, огромная дистанция до власти. */
export const TEST_REGION_NATIONAL = 187;
/** Сосед национального региона с той же титульной нацией. */
export const TEST_REGION_NEIGHBOUR = 185;
/** Контрольный регион: только лояльная группа, дистанция мала. */
export const TEST_REGION_CONTROL = 26;

const REGION_POPULATION = 1_000_000;
const REGION_GDP = 400_000_000;

export const TEST_ETHNIC_GROUPS: EthnicGroupDefinition[] = [
  {
    id: TEST_GROUP_TITULAR,
    names: { en: "Lithuanians", ru: "Литовцы" },
    desiredIdeology: { economic: -0.1, political: 0.45 },
  },
  {
    id: TEST_GROUP_LOYAL,
    names: { en: "Russians", ru: "Русские" },
    desiredIdeology: { economic: -0.7, political: -0.55 },
  },
];

export function createSovietTestCountry(overrides: Partial<Country> = {}): Country {
  const base = createTestCountry({ id: "SUN" });
  return {
    ...base,
    // Столица — среди СВОИХ регионов: инвариант состояния (`invariants.ts`)
    // требует этого от каждой страны, владеющей хотя бы одним регионом.
    capitalRegionId: TEST_REGION_CONTROL,
    population: REGION_POPULATION * 3,
    economy: { ...base.economy, gdp: REGION_GDP * 3 },
    politics: {
      ...base.politics,
      ideology: "Communism",
      ideologyCoordinates: { economic: -0.95, political: -0.9 },
    },
    ...overrides,
  };
}

function nationalRegion(id: number, neighbours: number[]): Region {
  return createTestRegion({
    id,
    geoJsonId: `TEST-${id}`,
    names: { en: `National region ${id}` },
    ownerCountryId: "SUN",
    population: REGION_POPULATION,
    gdp: REGION_GDP,
    neighboringRegionIds: neighbours,
    demographics: [
      { groupId: TEST_GROUP_TITULAR, share: 0.88 },
      { groupId: TEST_GROUP_LOYAL, share: 0.12 },
    ],
  });
}

export function createDiscontentTestGame(overrides: Partial<GameState> = {}): GameState {
  const regions: Region[] = [
    nationalRegion(TEST_REGION_NATIONAL, [TEST_REGION_NEIGHBOUR]),
    nationalRegion(TEST_REGION_NEIGHBOUR, [TEST_REGION_NATIONAL]),
    createTestRegion({
      id: TEST_REGION_CONTROL,
      geoJsonId: `TEST-${TEST_REGION_CONTROL}`,
      names: { en: "Control region" },
      ownerCountryId: "SUN",
      population: REGION_POPULATION,
      gdp: REGION_GDP,
      neighboringRegionIds: [],
      demographics: [{ groupId: TEST_GROUP_LOYAL, share: 1 }],
    }),
  ];

  return createTestGameState({
    playerCountryId: "SUN",
    countries: [createSovietTestCountry(), createTestCountry({ id: "USA" })],
    regions,
    ethnicGroups: structuredClone(TEST_ETHNIC_GROUPS),
    ...overrides,
  });
}

/**
 * Накопленный след, доводящий титульную группу национальных регионов до порога
 * ОТДЕЛЕНИЯ (`split_country`, docs/CONCEPT.md §5.5).
 *
 * Зачем отдельная подготовка. Распад стоит в КОНЦЕ драматургической дуги §6
 * («экономика → нестабильность → переворот ИЛИ распад»), и порог отделения
 * намеренно выше порога восстания. На спокойном мире `split_country`
 * отклоняется — это свойство механики, а не неудобство теста, и подделывать
 * его подкруткой порога значило бы проверять другую игру.
 *
 * Пишется ПАМЯТЬ ВОЗДЕЙСТВИЙ, а не само недовольство: недовольство не
 * хранится, движок выводит его (`CONCEPT.md` §4.1). Значение не подобрано «чтоб
 * прошло»: это тот же канал `emboldenment`, который наполняют `incite_unrest` и
 * `spawn_incident`, то есть путь, достижимый в настоящей партии.
 */
export function seedSeparatistDiscontent(game: GameState): void {
  for (const region of game.regions) {
    if (!region.demographics?.some(d => d.groupId === TEST_GROUP_TITULAR)) continue;
    game.groupImpactMemory.push({
      regionId: region.id,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: SEPARATIST_EMBOLDENMENT,
    });
  }
}

/**
 * След, при котором недовольство титульной группы фикстуры переходит самый
 * мягкий порог отделения с запасом, но не упирается в потолок поля.
 */
const SEPARATIST_EMBOLDENMENT = 0.6;
