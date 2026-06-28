import { type Scenario } from "./types/Scenario";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { ERAS } from "@shared/data/eras";
import fs from 'fs';
import path from 'path';

/**
 * Регионы и страны сценария 1946 генерируются из датасета d:/MAP пайплайном
 * scripts/map/import_to_game.py + generate_country_registry.py — не править
 * вручную, перегенерировать пайплайном. См. scripts/map/README.md.
 */
function loadJsonData<T>(relativePath: string, label: string): T[] {
  const fullPath = path.join(process.cwd(), relativePath);
  try {
    if (fs.existsSync(fullPath)) {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      console.log(`Загружено ${data.length} ${label} из ${fullPath}`);
      return data;
    }
    console.warn(`Файл ${fullPath} не найден, ${label} не загружены`);
  } catch (error) {
    console.error(`Ошибка загрузки ${label} из ${fullPath}:`, error);
  }
  return [];
}

const regions = loadJsonData<Region>('data/scenarios/1946/regions.json', 'регионов');
const countries = loadJsonData<Country>('data/scenarios/1946/countries.json', 'стран');

export const Scenario1946: Scenario = {
  id: "1946",
  name: "Холодная война",
  startDate: "1946-01-01",
  endDate: "2000-12-31",
  technologyEra: ERAS.find(era => era.id === "1946")!,
  countries,
  regions,
  description: "Биполярный мир, ядерное противостояние и космическая гонка. Германия разделена на зоны оккупации, гражданская война в Китае."
};
