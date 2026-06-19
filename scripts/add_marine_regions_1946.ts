import fs from 'fs';
import path from 'path';
import * as turf from '@turf/turf';

interface Feature extends GeoJSON.Feature {
  id?: string;
  properties: {
    [key: string]: any;
  };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
}

// Загрузка GeoJSON
function loadGeoJSON(filePath: string): FeatureCollection {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// Сохранение GeoJSON
function saveGeoJSON(filePath: string, geojson: FeatureCollection): void {
  fs.writeFileSync(filePath, JSON.stringify(geojson, null, 2), 'utf-8');
}

// Создание морского региона как полигона
function createMarineRegion(
  id: string,
  name: string,
  nameEn: string,
  bbox: [number, number, number, number]
): Feature {
  const polygon = turf.bboxPolygon(bbox);
  
  return {
    type: 'Feature',
    geometry: polygon.geometry,
    properties: {
      id: id,
      name: name,
      name_en: nameEn,
      ownerCountryId: 'NONE',
      countryIso: 'NONE',
      macroRegion: id,
      historicalYear: 1946,
      kind: 'marine',
      specialStatus: 'marine'
    }
  };
}

// Создание морских регионов
function createMarineRegions(): Feature[] {
  const marineRegions: Feature[] = [];

  // Атлантический океан - Северная часть
  marineRegions.push(createMarineRegion(
    'MARINE_ATLANTIC_NORTH',
    'Северная Атлантика',
    'North Atlantic',
    [-60, 40, -10, 70]
  ));

  // Атлантический океан - Центральная часть
  marineRegions.push(createMarineRegion(
    'MARINE_ATLANTIC_CENTRAL',
    'Центральная Атлантика',
    'Central Atlantic',
    [-60, 10, -10, 40]
  ));

  // Атлантический океан - Южная часть
  marineRegions.push(createMarineRegion(
    'MARINE_ATLANTIC_SOUTH',
    'Южная Атлантика',
    'South Atlantic',
    [-40, -40, 10, 10]
  ));

  // Тихий океан - Северная часть
  marineRegions.push(createMarineRegion(
    'MARINE_PACIFIC_NORTH',
    'Северная часть Тихого океана',
    'North Pacific',
    [120, 30, 180, 60]
  ));

  // Тихий океан - Центральная часть
  marineRegions.push(createMarineRegion(
    'MARINE_PACIFIC_CENTRAL',
    'Центральная часть Тихого океана',
    'Central Pacific',
    [120, -30, 180, 30]
  ));

  // Тихий океан - Южная часть
  marineRegions.push(createMarineRegion(
    'MARINE_PACIFIC_SOUTH',
    'Южная часть Тихого океана',
    'South Pacific',
    [120, -60, 180, -30]
  ));

  // Индийский океан - Северная часть
  marineRegions.push(createMarineRegion(
    'MARINE_INDIAN_NORTH',
    'Северная часть Индийского океана',
    'North Indian',
    [40, 0, 100, 30]
  ));

  // Индийский океан - Центральная часть
  marineRegions.push(createMarineRegion(
    'MARINE_INDIAN_CENTRAL',
    'Центральная часть Индийского океана',
    'Central Indian',
    [40, -30, 100, 0]
  ));

  // Индийский океан - Южная часть
  marineRegions.push(createMarineRegion(
    'MARINE_INDIAN_SOUTH',
    'Южная часть Индийского океана',
    'South Indian',
    [40, -60, 100, -30]
  ));

  // Северный Ледовитый океан
  marineRegions.push(createMarineRegion(
    'MARINE_ARCTIC',
    'Северный Ледовитый океан',
    'Arctic Ocean',
    [-180, 60, 180, 90]
  ));

  // Средиземное море
  marineRegions.push(createMarineRegion(
    'MARINE_MEDITERRANEAN',
    'Средиземное море',
    'Mediterranean Sea',
    [-6, 30, 36, 46]
  ));

  // Чёрное море
  marineRegions.push(createMarineRegion(
    'MARINE_BLACK_SEA',
    'Чёрное море',
    'Black Sea',
    [27, 40, 42, 47]
  ));

  // Балтийское море
  marineRegions.push(createMarineRegion(
    'MARINE_BALTIC',
    'Балтийское море',
    'Baltic Sea',
    [9, 53, 30, 66]
  ));

  // Северное море
  marineRegions.push(createMarineRegion(
    'MARINE_NORTH_SEA',
    'Северное море',
    'North Sea',
    [-5, 50, 10, 60]
  ));

  // Карибское море
  marineRegions.push(createMarineRegion(
    'MARINE_CARIBBEAN',
    'Карибское море',
    'Caribbean Sea',
    [-90, 10, -60, 25]
  ));

  // Красное море
  marineRegions.push(createMarineRegion(
    'MARINE_RED_SEA',
    'Красное море',
    'Red Sea',
    [32, 12, 43, 28]
  ));

  // Персидский залив
  marineRegions.push(createMarineRegion(
    'MARINE_PERSIAN_GULF',
    'Персидский залив',
    'Persian Gulf',
    [48, 24, 57, 30]
  ));

  // Японское море
  marineRegions.push(createMarineRegion(
    'MARINE_JAPAN_SEA',
    'Японское море',
    'Sea of Japan',
    [128, 33, 142, 46]
  ));

  // Южно-Китайское море
  marineRegions.push(createMarineRegion(
    'MARINE_SOUTH_CHINA_SEA',
    'Южно-Китайское море',
    'South China Sea',
    [105, 0, 125, 25]
  ));

  // Берингово море
  marineRegions.push(createMarineRegion(
    'MARINE_BERING_SEA',
    'Берингово море',
    'Bering Sea',
    [170, 50, 200, 66]
  ));

  // Охотское море
  marineRegions.push(createMarineRegion(
    'MARINE_OKHOTSK',
    'Охотское море',
    'Sea of Okhotsk',
    [140, 45, 162, 62]
  ));

  return marineRegions;
}

// Главная функция
function main() {
  const outputPath = path.join(process.cwd(), 'client/public/world-map-1946.geojson');

  console.log('Загрузка существующего world-map-1946.geojson...');
  let worldMap1946: FeatureCollection;
  try {
    worldMap1946 = loadGeoJSON(outputPath);
  } catch (error) {
    console.log('Файл не найден, создаю новый FeatureCollection');
    worldMap1946 = { type: 'FeatureCollection', features: [] };
  }

  console.log('Создание морских регионов...');
  const marineRegions = createMarineRegions();

  console.log('Добавление морских регионов...');
  worldMap1946.features.push(...marineRegions);

  console.log('Сохранение GeoJSON...');
  saveGeoJSON(outputPath, worldMap1946);

  console.log(`\nСтатистика:`);
  console.log(`Всего регионов: ${worldMap1946.features.length}`);
  console.log(`Добавлено морских регионов: ${marineRegions.length}`);
  console.log(`\nСозданные морские регионы:`);
  marineRegions.forEach(m => {
    console.log(`- ${m.properties.name_en} (${m.properties.id})`);
  });
}

main();
