import { type Scenario } from "./types/Scenario";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
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
  type RegionCoreEntry,
  type RegionStateEntry,
} from "./scenario1946Schemas";

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

export function buildScenario1946(baseDir: string): Scenario {
  const regions = buildRegions(baseDir);
  const countries = buildCountries(baseDir);

  return {
    id: "1946",
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
