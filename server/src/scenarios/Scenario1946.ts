import { type Scenario } from "./types/Scenario";
import { USSR } from "../data/countries/USSR";
import { USA } from "../data/countries/USA";
import { UK } from "../data/countries/UnitedKingdom";
import { FRA as France } from "../data/countries/France";
import { Germany } from "../data/countries/Germany";
import { GermanyUSSR } from "../data/countries/GermanyUSSR";
import { GermanyUSA } from "../data/countries/GermanyUSA";
import { GermanyUK } from "../data/countries/GermanyUK";
import { GermanyFRA } from "../data/countries/GermanyFRA";
import { Italy } from "../data/countries/Italy";
import { China } from "../data/countries/China";
import { Taiwan } from "../data/countries/Taiwan";
import { ERAS } from "@shared/data/eras";
import fs from 'fs';
import path from 'path';

// Загружаем регионы из файла
const regionsPath = path.join(process.cwd(), 'data/scenarios/1946/regions.json');
let regions = [];

try {
  if (fs.existsSync(regionsPath)) {
    const regionsData = fs.readFileSync(regionsPath, 'utf-8');
    regions = JSON.parse(regionsData);
    console.log(`Загружено ${regions.length} регионов из ${regionsPath}`);
  } else {
    console.warn(`Файл ${regionsPath} не найден, регионы не загружены`);
  }
} catch (error) {
  console.error(`Ошибка загрузки регионов из ${regionsPath}:`, error);
}

export const Scenario1946: Scenario = {
  id: "1946",
  name: "Холодная война",
  startDate: "1946-01-01",
  endDate: "2000-12-31",
  technologyEra: ERAS.find(era => era.id === "1946")!,
  countries: [USSR, USA, UK, France, Germany, GermanyUSSR, GermanyUSA, GermanyUK, GermanyFRA, Italy, China, Taiwan],
  regions,
  description: "Биполярный мир, ядерное противостояние и космическая гонка. Германия разделена на зоны оккупации, гражданская война в Китае."
};
