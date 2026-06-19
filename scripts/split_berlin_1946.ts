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

// Разрезание полигона на 4 сектора по координатам
function splitBerlinIntoSectors(berlinFeature: Feature): Feature[] {
  const bbox = turf.bbox(berlinFeature);
  const [minX, minY, maxX, maxY] = bbox;

  // Центр Берлина
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  console.log('Создаём 4 сектора Берлина по bbox');
  const sectors: Feature[] = [];

  // Создаём 4 прямоугольника по bbox
  // Северо-запад (британский сектор)
  const nwBbox: [number, number, number, number] = [minX, centerY, centerX, maxY];
  const nwPolygon = turf.bboxPolygon(nwBbox);
  sectors.push(nwPolygon as Feature);

  // Северо-восток (советский сектор)
  const neBbox: [number, number, number, number] = [centerX, centerY, maxX, maxY];
  const nePolygon = turf.bboxPolygon(neBbox);
  sectors.push(nePolygon as Feature);

  // Юго-запад (американский сектор)
  const swBbox: [number, number, number, number] = [minX, minY, centerX, centerY];
  const swPolygon = turf.bboxPolygon(swBbox);
  sectors.push(swPolygon as Feature);

  // Юго-восток (французский сектор)
  const seBbox: [number, number, number, number] = [centerX, minY, maxX, centerY];
  const sePolygon = turf.bboxPolygon(seBbox);
  sectors.push(sePolygon as Feature);

  return sectors;
}

// Создание фич для секторов Берлина
function createBerlinSectors(berlinFeature: Feature): Feature[] {
  const sectors = splitBerlinIntoSectors(berlinFeature);
  
  if (sectors.length !== 4) {
    console.warn(`Ожидалось 4 сектора, получено ${sectors.length}`);
  }

  const sectorData = [
    {
      id: 'BER_USSR',
      name: 'Берлин (советский сектор)',
      name_en: 'Berlin (Soviet Sector)',
      owner: 'DEU_USSR',
      description: 'Советский сектор оккупации Берлина'
    },
    {
      id: 'BER_USA',
      name: 'Берлин (американский сектор)',
      name_en: 'Berlin (American Sector)',
      owner: 'DEU_USA',
      description: 'Американский сектор оккупации Берлина'
    },
    {
      id: 'BER_UK',
      name: 'Берлин (британский сектор)',
      name_en: 'Berlin (British Sector)',
      owner: 'DEU_UK',
      description: 'Британский сектор оккупации Берлина'
    },
    {
      id: 'BER_FRA',
      name: 'Берлин (французский сектор)',
      name_en: 'Berlin (French Sector)',
      owner: 'DEU_FRA',
      description: 'Французский сектор оккупации Берлина'
    }
  ];

  return sectors.map((sector, idx) => ({
    type: 'Feature',
    geometry: sector.geometry,
    properties: {
      id: sectorData[idx].id,
      name: sectorData[idx].name,
      name_en: sectorData[idx].name_en,
      ownerCountryId: sectorData[idx].owner,
      countryIso: 'DEU',
      macroRegion: sectorData[idx].id,
      historicalYear: 1946,
      kind: 'special',
      specialStatus: 'berlin_sector',
      description: sectorData[idx].description
    }
  }));
}

// Главная функция
function main() {
  const geojsonPath = path.join(process.cwd(), 'client/src/assets/game_map.json');
  const outputPath = path.join(process.cwd(), 'client/public/world-map-1946.geojson');

  console.log('Загрузка GeoJSON...');
  const geojson = loadGeoJSON(geojsonPath);

  console.log('Поиск Берлина...');
  const berlinFeature = geojson.features.find(f => 
    f.properties && f.properties.name && f.properties.name === 'Berlin'
  );

  if (!berlinFeature) {
    console.error('Берлин не найден в GeoJSON');
    return;
  }

  console.log('Создание секторов Берлина...');
  const berlinSectors = createBerlinSectors(berlinFeature);

  console.log('Загрузка существующего world-map-1946.geojson...');
  let worldMap1946: FeatureCollection;
  try {
    worldMap1946 = loadGeoJSON(outputPath);
  } catch (error) {
    console.log('Файл не найден, создаю новый FeatureCollection');
    worldMap1946 = { type: 'FeatureCollection', features: [] };
  }

  console.log('Добавление секторов Берлина...');
  worldMap1946.features.push(...berlinSectors);

  console.log('Сохранение GeoJSON...');
  saveGeoJSON(outputPath, worldMap1946);

  console.log(`\nСтатистика:`);
  console.log(`Всего регионов: ${worldMap1946.features.length}`);
  console.log(`Добавлено секторов Берлина: ${berlinSectors.length}`);
}

main();
