import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type EthnicGroupDefinition } from "@shared/types/politics/Demographics";
import { CAPITAL_FLIGHT_MAX_STABILITY } from "@shared/defines/economy";
import { WarService } from "../services/WarService";
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

// --------------------------------------------------------------------------
// Предпосылки мягких воздействий (Милстоун 1)
// --------------------------------------------------------------------------
//
// Три подготовки живут ЗДЕСЬ, а не в отдельных тестовых файлах, ровно по той же
// причине, что `seedSeparatistDiscontent`: каждая доводит мир до предпосылки
// глагола настоящим путём, а не подкруткой порога. Общие они потому, что их
// используют и проверка палитры, и проверки самих глаголов, и разъехавшиеся
// копии означали бы, что два теста проверяют разные миры под одним именем.

/**
 * Опускает стабильность региона ниже порога, при котором капитал перестаёт
 * держаться в нём (`CAPITAL_FLIGHT_MAX_STABILITY`).
 *
 * Значение берётся ОТ КОНСТАНТЫ, а не назначается числом: тест обязан следовать
 * за калибровкой порога, а не фиксировать снимок сегодняшнего значения.
 */
export function destabilizeRegion(game: GameState, regionId: number): void {
  const region = game.regions.find(r => r.id === regionId);
  if (!region) throw new Error(`No such region in fixture: ${regionId}`);
  region.stability = CAPITAL_FLIGHT_MAX_STABILITY / 2;
}

/**
 * Даёт одной стране влияние на другую — то есть и ТРИБУНУ для `condemn`, и
 * канал ПАТРОНАЖА для `support_proxy`.
 *
 * Одной функцией на обе предпосылки намеренно: в состоянии это буквально одно и
 * то же поле, и разводить его двумя подготовками значило бы делать вид, что
 * тесты опираются на разные свойства мира.
 */
export function giveAudience(game: GameState, sourceId: string, targetId: string): void {
  const source = game.countries.find(c => c.id === sourceId);
  if (!source) throw new Error(`No such country in fixture: ${sourceId}`);
  source.diplomacy.influence[targetId] = FIXTURE_INFLUENCE;
}

/**
 * Втягивает страну в войну с ТРЕТЬИМ государством, которого в фикстуре ещё нет.
 *
 * Третье обязательно: `support_proxy` требует, чтобы патрон в этой войне НЕ
 * участвовал, а в мире из двух стран единственным противником клиента был бы
 * сам патрон — то есть предпосылка «патрон не воюет сам» стала бы непроверяемой
 * не по решению, а по составу фикстуры.
 *
 * Возвращает id созданного противника.
 */
export function addProxyClientWar(game: GameState, clientId: string): string {
  const enemyId = "ENE";
  if (!game.countries.some(c => c.id === enemyId)) {
    game.countries.push(createTestCountry({ id: enemyId }));
  }
  new WarService(game).declareWar(enemyId, clientId);
  return enemyId;
}

/** Влияние фикстуры: заметно больше нуля и заметно меньше потолка шкалы. */
const FIXTURE_INFLUENCE = 40;
