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

// Создание канального региона как линии
function createCanalRegion(
  id: string,
  name: string,
  nameEn: string,
  owner: string,
  coordinates: number[][]
): Feature {
  const line = turf.lineString(coordinates);
  
  return {
    type: 'Feature',
    geometry: line.geometry,
    properties: {
      id: id,
      name: name,
      name_en: nameEn,
      ownerCountryId: owner,
      countryIso: owner,
      macroRegion: id,
      historicalYear: 1946,
      kind: 'canal',
      specialStatus: 'canal'
    }
  };
}

// Создание канальных регионов
function createCanalRegions(): Feature[] {
  const canals: Feature[] = [];

  // Суэцкий канал (Египет)
  // Координаты примерно от Порт-Саида до Суэца
  const suezCoordinates = [
    [32.526, 31.265],  // Порт-Саид (север)
    [32.312, 30.015],  // Исмаилия
    [32.549, 29.972]   // Суэц (юг)
  ];
  canals.push(createCanalRegion(
    'CANAL_SUEZ',
    'Суэцкий канал',
    'Suez Canal',
    'EGY',
    suezCoordinates
  ));

  // Панамский канал (Панама)
  // Координаты примерно от Атлантического до Тихого океана
  const panamaCoordinates = [
    [-79.938, 9.354],  // Колон (Атлантика)
    [-79.654, 9.083],  // Гатун
    [-79.543, 8.923],  // Педро-Мигель
    [-79.533, 8.730],  // Миафлорес
    [-79.543, 8.432],  // Бальбоа (Тихий океан)
    [-79.938, 8.923]   // Панама-Сити
  ];
  canals.push(createCanalRegion(
    'CANAL_PANAMA',
    'Панамский канал',
    'Panama Canal',
    'PAN',
    panamaCoordinates
  ));

  // Кильский канал (Германия)
  // Координаты примерно от Кильской бухты до Северного моря
  const kielCoordinates = [
    [9.950, 54.480],  // Киль (Балтийское море)
    [9.400, 54.150],  // Рендсбург
    [9.000, 53.900],  // Средняя часть
    [8.600, 53.800],  // Брунсбюттель (Северное море)
    [8.700, 54.000]   // Браке
  ];
  canals.push(createCanalRegion(
    'CANAL_KIEL',
    'Кильский канал',
    'Kiel Canal',
    'DEU_UK',  // Британская зона оккупации
    kielCoordinates
  ));

  return canals;
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

  console.log('Создание канальных регионов...');
  const canalRegions = createCanalRegions();

  console.log('Добавление канальных регионов...');
  worldMap1946.features.push(...canalRegions);

  console.log('Сохранение GeoJSON...');
  saveGeoJSON(outputPath, worldMap1946);

  console.log(`\nСтатистика:`);
  console.log(`Всего регионов: ${worldMap1946.features.length}`);
  console.log(`Добавлено канальных регионов: ${canalRegions.length}`);
  console.log(`\nСозданные каналы:`);
  canalRegions.forEach(c => {
    console.log(`- ${c.properties.name_en} (${c.properties.id})`);
  });
}

main();
