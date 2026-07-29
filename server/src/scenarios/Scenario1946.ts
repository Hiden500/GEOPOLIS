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

  return groups;
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
