import { type Scenario } from "./types/Scenario";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";
import { ERAS } from "@shared/data/eras";
import fs from 'fs';
import path from 'path';
import { type ZodType } from "zod";
import { createCountry, type CountryInput } from "../data/countries/templates/CreateCountry";
import {
  regionCoreFileSchema,
  regionStateFileSchema,
  namesFileSchema,
  authoredCountryFileSchema,
  groupsFileSchema,
  demographicsFileSchema,
  ideologyFileSchema,
  governmentFileSchema,
  influenceFileSchema,
  diplomacyFileSchema,
  ideologyZonesFileSchema,
  type RegionCoreEntry,
  type RegionStateEntry,
} from "./scenario1946Schemas";
import { type EthnicGroupDefinition } from "@shared/types/politics/Demographics";

/**
 * Регионы и страны сценария 1946 генерируются из датасета d:/MAP пайплайном
 * scripts/map/import_to_game.py + generate_country_registry.py + fill_region_economy_1946.py —
 * не править вручную, перегенерировать пайплайном. См. scripts/map/README.md.
 *
 * Данные расслоены (docs/plans/05_DATA_LAYOUT.md, Срез 1): regions.core.json
 * (география) + names.en.json/names.ru.json (локализация) + regions.state.json
 * (владение/экономика) собираются в Region[] здесь, на загрузке — не на диске.
 * countries.json (Срез 2) — только авторские поля, нулевые рантайм-блоки
 * дефолтит createCountry (тот же путь, что для 12 рукописных TS-стран 1836/2000).
 */
export class ScenarioDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioDataError";
  }
}

function readJsonFile<T>(fullPath: string, schema: ZodType<T>, label: string): T {
  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    throw new ScenarioDataError(`Не удалось прочитать ${label} (${fullPath}): ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScenarioDataError(`${label} (${fullPath}) содержит невалидный JSON: ${(error as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ScenarioDataError(`${label} (${fullPath}) не прошёл валидацию схемы: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Как readJsonFile, но отсутствие файла — не ошибка, а «слоя нет». Применимо
 * только к слоям фундамента (groups/demographics/ideology): их покрытие
 * частичное по замыслу, а сценарии-заглушки и тестовые фикстуры их вовсе не
 * содержат. Битый JSON или несовпадение схемы по-прежнему падают — «файла нет»
 * и «файл испорчен» это разные вещи.
 *
 * Реальный датасет 1946 при этом не может тихо потерять разметку: её наличие
 * проверяет campaignSmoke.test.ts (MARKED_REGION_COUNT) и тест ниже.
 */
function readOptionalJsonFile<T>(fullPath: string, schema: ZodType<T>, label: string): T | undefined {
  if (!fs.existsSync(fullPath)) return undefined;
  return readJsonFile(fullPath, schema, label);
}

function buildCountries(baseDir: string): Country[] {
  const authored = readJsonFile(
    path.join(baseDir, 'countries.json'), authoredCountryFileSchema, 'countries.json'
  );
  return authored.map((entry) => createCountry(entry as CountryInput));
}

function buildRegions(baseDir: string): Region[] {
  const core = readJsonFile<RegionCoreEntry[]>(
    path.join(baseDir, 'regions.core.json'), regionCoreFileSchema, 'regions.core.json'
  );
  const state = readJsonFile<RegionStateEntry[]>(
    path.join(baseDir, 'regions.state.json'), regionStateFileSchema, 'regions.state.json'
  );
  const namesEn = readJsonFile(path.join(baseDir, 'names.en.json'), namesFileSchema, 'names.en.json');
  const namesRu = readJsonFile(path.join(baseDir, 'names.ru.json'), namesFileSchema, 'names.ru.json');

  const stateById = new Map<number, RegionStateEntry>(state.map(s => [s.id, s]));

  return core.map((c): Region => {
    const s = stateById.get(c.id);
    if (!s) {
      throw new ScenarioDataError(
        `regions.state.json: нет записи для региона id=${c.id} (geoJsonId=${c.geoJsonId})`
      );
    }

    const nameEn = namesEn[c.geoJsonId];
    const nameRu = namesRu[c.geoJsonId];
    if (nameEn === undefined && nameRu === undefined) {
      throw new ScenarioDataError(
        `names.en.json/names.ru.json: нет имени для региона geoJsonId=${c.geoJsonId} (id=${c.id})`
      );
    }
    const names: Region["names"] = {};
    if (nameEn !== undefined) names.en = nameEn;
    if (nameRu !== undefined) names.ru = nameRu;

    const region: Region = {
      id: c.id,
      geoJsonId: c.geoJsonId,
      names,
      ownerCountryId: s.ownerCountryId,
      population: s.population,
      area: c.area,
      urbanization: s.urbanization,
      stability: s.stability,
      infrastructure: s.infrastructure,
      development: s.development,
      gdp: s.gdp,
      deposits: s.deposits,
      extraction: s.extraction,
      neighboringRegionIds: c.neighboringRegionIds,
    };
    if (s.occupiedBy !== undefined) region.occupiedBy = s.occupiedBy;
    if (c.sourceAdm1Codes !== undefined) region.sourceAdm1Codes = c.sourceAdm1Codes;
    return region;
  });
}

/**
 * Досыпает три слоя «фундамента» (docs/CONCEPT.md §4.1/§4.2) в уже собранные
 * регионы и страны: каталог демо-групп, доли групп по регионам, координаты
 * идеологии. Zod проверяет форму каждого файла по отдельности; ссылочную
 * целостность МЕЖДУ файлами (группа существует, регион существует, страна
 * существует) схема выразить не может — она проверяется здесь и падает
 * ScenarioDataError, а не превращается в тихо неработающую разметку.
 *
 * Покрытие частичное по замыслу: регион без записи остаётся без demographics
 * (движок не выводит для него недовольство), страна без координат читает
 * фолбэк по ярлыку politics.ideology. Отсутствие записи — не ошибка; ошибка —
 * запись, ссылающаяся в пустоту.
 */
function applyDemographicLayers(
  baseDir: string,
  regions: Region[],
  countries: Country[]
): EthnicGroupDefinition[] {
  const groupsFile = readOptionalJsonFile(
    path.join(baseDir, 'groups.json'), groupsFileSchema, 'groups.json'
  );
  const demographicsFile = readOptionalJsonFile(
    path.join(baseDir, 'demographics.json'), demographicsFileSchema, 'demographics.json'
  );
  const ideologyFile = readOptionalJsonFile(
    path.join(baseDir, 'ideology.json'), ideologyFileSchema, 'ideology.json'
  );

  if (!groupsFile) {
    // Без каталога групп разметка регионов не с чем сверяться. Если файла нет,
    // а demographics/ideology есть — это рассыпавшийся набор, а не «слоя нет».
    if (demographicsFile || ideologyFile) {
      throw new ScenarioDataError(
        'groups.json отсутствует, но demographics.json/ideology.json присутствуют — неполный набор слоёв'
      );
    }
    return [];
  }

  const groups: EthnicGroupDefinition[] = groupsFile.groups.map(g => {
    // Ключи LocalizedText опциональны, а под exactOptionalPropertyTypes явный
    // undefined — не то же, что отсутствие ключа (тот же приём, что в
    // buildRegions выше).
    const names: EthnicGroupDefinition["names"] = { en: g.names.en };
    if (g.names.ru !== undefined) names.ru = g.names.ru;
    return { id: g.id, names, desiredIdeology: g.desiredIdeology };
  });

  const groupIds = new Set(groups.map(g => g.id));
  if (groupIds.size !== groups.length) {
    throw new ScenarioDataError('groups.json: дублирующиеся id демо-групп');
  }

  const regionById = new Map<number, Region>(regions.map(r => [r.id, r]));
  for (const entry of demographicsFile?.regions ?? []) {
    const region = regionById.get(entry.regionId);
    if (!region) {
      throw new ScenarioDataError(`demographics.json: нет региона id=${entry.regionId} в сценарии`);
    }
    for (const share of entry.groups) {
      if (!groupIds.has(share.groupId)) {
        throw new ScenarioDataError(
          `demographics.json: регион ${entry.regionId} ссылается на неизвестную группу "${share.groupId}"`
        );
      }
    }
    region.demographics = entry.groups.map(g => ({ groupId: g.groupId, share: g.share }));
  }

  const countryById = new Map<string, Country>(countries.map(c => [c.id, c]));
  for (const entry of ideologyFile?.countries ?? []) {
    const country = countryById.get(entry.countryId);
    if (!country) {
      throw new ScenarioDataError(`ideology.json: нет страны id="${entry.countryId}" в сценарии`);
    }
    country.politics.ideologyCoordinates = {
      economic: entry.economic,
      political: entry.political,
    };
  }

  applyGovernmentLayer(baseDir, countries, countryById);
  applyInfluenceLayer(baseDir, countries, countryById);

  return groups;
}

/**
 * Формы правления и юридический статус (`government.json`,
 * `shared/src/types/politics/Government.ts`). Слой независимый и опциональный:
 * сценарий без файла работает, страна без записи остаётся без ярлыка — тот же
 * принцип частичного покрытия, что у остальных слоёв фундамента.
 *
 * Zod проверил форму записи (перечни, число сюзеренов по статусу); здесь —
 * ссылочная целостность МЕЖДУ файлами, которую схема выразить не может: и
 * страна, и каждый её сюзерен обязаны существовать в ростере.
 *
 * СВЕРКА С `diplomacy.puppets` здесь НЕ делается, и это осознанно. Она стоит в
 * `scripts/map/validate_demographics_1946.py` (до запуска игры) и в
 * `server/src/scenarios/__tests__/government1946.test.ts` (по загруженному
 * сценарию). Ронять загрузку партии из-за того, что рантайм-отношение разошлось
 * с юридическим статусом, значило бы сделать невозможным сохранение мира, в
 * котором игрок кого-то освободил, — а механики, синхронизирующей эти два поля,
 * ещё нет (`docs/TODO.md`).
 */
function applyGovernmentLayer(
  baseDir: string,
  countries: Country[],
  countryById: Map<string, Country>
): void {
  const governmentFile = readOptionalJsonFile(
    path.join(baseDir, 'government.json'), governmentFileSchema, 'government.json'
  );
  if (!governmentFile) return;

  const roster = new Set(countries.map(c => c.id));
  for (const entry of governmentFile.countries) {
    const country = countryById.get(entry.countryId);
    if (!country) {
      throw new ScenarioDataError(`government.json: нет страны id="${entry.countryId}" в сценарии`);
    }
    for (const overlordId of entry.overlordIds) {
      if (!roster.has(overlordId)) {
        throw new ScenarioDataError(
          `government.json: страна "${entry.countryId}" ссылается на несуществующего сюзерена "${overlordId}"`
        );
      }
    }
    country.politics.powerStructure = entry.powerStructure;
    country.politics.sovereigntyStatus = entry.sovereigntyStatus;
    country.politics.overlordIds = [...entry.overlordIds];
  }
}

/**
 * Стартовое влияние держав (`influence.json`). Слой независимый и
 * опциональный, как остальные слои фундамента.
 *
 * ЗАЧЕМ ЭТОТ СЛОЙ СУЩЕСТВУЕТ. `DiplomacyTick` работает только по УЖЕ
 * существующим записям `relations`/`influence`, а в сценарии они пусты у всех
 * 157 стран: дрейфовать нечему, тяготение пары считать не от чего. Полную
 * матрицу заводить нельзя — 157 стран дают 24 649 пар против правила о размере
 * сохранений. Этот файл и есть разреженный каркас, из которого дипломатия
 * начинает работать: 300 связей вместо 24 649.
 *
 * Zod проверил форму (диапазон 10..100, отсутствие самовлияния); здесь —
 * ссылочная целостность между файлами: и источник, и каждая цель обязаны
 * существовать в ростере.
 */
function applyInfluenceLayer(
  baseDir: string,
  countries: Country[],
  countryById: Map<string, Country>
): void {
  const influenceFile = readOptionalJsonFile(
    path.join(baseDir, 'influence.json'), influenceFileSchema, 'influence.json'
  );
  if (!influenceFile) return;

  const roster = new Set(countries.map(c => c.id));
  for (const entry of influenceFile.influence) {
    const source = countryById.get(entry.sourceCountryId);
    if (!source) {
      throw new ScenarioDataError(
        `influence.json: нет страны id="${entry.sourceCountryId}" в сценарии`
      );
    }
    for (const [targetId, value] of Object.entries(entry.targets)) {
      if (!roster.has(targetId)) {
        throw new ScenarioDataError(
          `influence.json: "${entry.sourceCountryId}" влияет на несуществующую страну "${targetId}"`
        );
      }
      source.diplomacy.influence[targetId] = value;
    }
  }
}

/**
 * Стартовый дипломатический слой (`diplomacy.json`, docs/DIPLOMACY.md).
 * Опциональный, как остальные слои: файла нет — «слоя нет», не ошибка. Самого
 * файла в сценарии 1946 на момент написания ещё нет (его наполняет отдельная
 * работа), поэтому «файла нет» — не теоретическая ветка, а текущий рабочий
 * путь сценария.
 *
 * ЗАЧЕМ. `influence.json` дал дипломатии каркас влияния, но `relations`,
 * `allies` и `rivals` остались пусты у всех стран: `DiplomacyTick` работает по
 * УЖЕ существующим записям, а ни одного союза и ни одной вражды на старте не
 * было.
 *
 * ПАРА КЛАДЁТСЯ ОБЕИМ СТОРОНАМ. В файле связь записана один раз, в состоянии
 * она хранится у каждой стороны отдельно — иначе половина движка (дрейф,
 * тяготение, коалиции) не увидела бы её со второй стороны. Гарантия,
 * наоборот, направленная: она пишется ТОЛЬКО гаранту.
 *
 * Zod проверил форму (шкала, самопара, дубль пары в любом порядке); здесь —
 * ссылочная целостность между файлами, которую схема выразить не может:
 * каждая названная страна обязана существовать в ростере.
 *
 * Вызывается из `buildScenario1946` напрямую, а НЕ из `applyDemographicLayers`:
 * тот возвращается рано, когда нет `groups.json`, и слой, повешенный на него,
 * молча не грузился бы в сценарии без демо-каталога.
 */
function applyDiplomacyLayer(baseDir: string, countries: Country[]): void {
  const file = readOptionalJsonFile(
    path.join(baseDir, 'diplomacy.json'), diplomacyFileSchema, 'diplomacy.json'
  );
  if (!file) return;

  const countryById = new Map<string, Country>(countries.map(c => [c.id, c]));
  const resolve = (id: string, label: string): Country => {
    const country = countryById.get(id);
    if (!country) {
      throw new ScenarioDataError(
        `diplomacy.json: ${label} ссылается на несуществующую страну "${id}"`
      );
    }
    return country;
  };
  // Слой ложится ПОВЕРХ авторских countries.json, где список уже мог быть
  // непустым, поэтому связь добавляется без повторов.
  const addUnique = (list: string[], id: string): void => {
    if (!list.includes(id)) list.push(id);
  };

  for (const entry of file.relations ?? []) {
    const [a, b] = entry.pair;
    const first = resolve(a, 'relations');
    const second = resolve(b, 'relations');
    first.diplomacy.relations[b] = entry.value;
    second.diplomacy.relations[a] = entry.value;
  }

  for (const entry of file.alliances ?? []) {
    const [a, b] = entry.pair;
    addUnique(resolve(a, 'alliances').diplomacy.allies, b);
    addUnique(resolve(b, 'alliances').diplomacy.allies, a);
  }

  for (const entry of file.rivalries ?? []) {
    const [a, b] = entry.pair;
    addUnique(resolve(a, 'rivalries').diplomacy.rivals, b);
    addUnique(resolve(b, 'rivalries').diplomacy.rivals, a);
  }

  for (const entry of file.guarantees ?? []) {
    resolve(entry.protected, 'guarantees');
    addUnique(resolve(entry.guarantor, 'guarantees').diplomacy.guarantees, entry.protected);
  }
}

/**
 * Именованные точки спектра эпохи. Слой независимый: без файла игрок видит
 * склейку ступеней шкалы, и это рабочее состояние, а не ошибка данных —
 * шкала покрывает спектр целиком сама по себе.
 *
 * Дубликат id — ошибка: ярлык выбирается ближайшим якорем, и два якоря с
 * одним id сделали бы результат зависящим от порядка в файле.
 */
function loadIdeologyAnchors(baseDir: string): IdeologyAnchor[] {
  const file = readOptionalJsonFile(
    path.join(baseDir, 'ideology_zones.json'), ideologyZonesFileSchema, 'ideology_zones.json'
  );
  if (!file) return [];

  const anchors: IdeologyAnchor[] = file.anchors.map(a => {
    // Под exactOptionalPropertyTypes явный undefined не равен отсутствию
    // ключа — тот же приём, что в buildRegions и в каталоге групп.
    const name: IdeologyAnchor["name"] = { en: a.name.en };
    if (a.name.ru !== undefined) name.ru = a.name.ru;
    return { id: a.id, center: a.center, radius: a.radius, name };
  });

  if (new Set(anchors.map(a => a.id)).size !== anchors.length) {
    throw new ScenarioDataError('ideology_zones.json: дублирующиеся id якорей');
  }
  return anchors;
}

export function buildScenario1946(baseDir: string): Scenario {
  const regions = buildRegions(baseDir);
  const countries = buildCountries(baseDir);
  const ethnicGroups = applyDemographicLayers(baseDir, regions, countries);
  applyDiplomacyLayer(baseDir, countries);
  const ideologyAnchors = loadIdeologyAnchors(baseDir);

  return {
    id: "1946",
    ethnicGroups,
    ideologyAnchors,
    name: "Холодная война",
    startDate: "1946-01-01",
    endDate: "2000-12-31",
    technologyEra: ERAS.find(era => era.id === "1946")!,
    countries,
    regions,
    description: "Биполярный мир, ядерное противостояние и космическая гонка. Германия разделена на зоны оккупации, гражданская война в Китае."
  };
}

export const Scenario1946: Scenario = buildScenario1946(
  path.join(process.cwd(), 'data/scenarios/1946')
);
