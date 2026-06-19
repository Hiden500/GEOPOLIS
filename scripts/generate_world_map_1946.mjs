import fs from 'fs';
import path from 'path';

// Загрузка данных
const geoJsonPath = path.join(process.cwd(), 'client/src/assets/game_map.json');
const mappingPath = path.join(process.cwd(), 'scripts/region_mapping_1946.json');
const analysisPath = path.join(process.cwd(), 'scripts/game_map_analysis_1946.json');

const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

console.log('=== ГЕНЕРАЦИЯ КАРТЫ МИРА ДЛЯ СЦЕНАРИЯ 1946 ===\n');

// Функция для объединения геометрий
function mergeGeometries(features) {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0].geometry;
  
  // Для упрощения - собираем все координаты в MultiPolygon
  const allPolygons = [];
  
  for (const feature of features) {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      allPolygons.push(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      allPolygons.push(...geom.coordinates);
    }
  }
  
  if (allPolygons.length === 1) {
    return { type: 'Polygon', coordinates: allPolygons[0] };
  }
  
  return { type: 'MultiPolygon', coordinates: allPolygons };
}

// Функция для генерации ID региона
function generateRegionId(countryCode, index) {
  return `${countryCode}-${String(index).padStart(3, '0')}`;
}

// Создание маппинга admin-1 регионов в макро-регионы (автоматическое)
function createRegionMapping() {
  const regionMapping = {};
  const countryToRegions = {};
  
  const rules = mapping.rules;
  
  // Для каждой страны из анализа определяем целевое количество регионов
  for (const [isoA3, countryAnalysis] of Object.entries(analysis)) {
    const area = countryAnalysis.totalAreaSqKm;
    const admin1Regions = countryAnalysis.regions;
    const countryName = countryAnalysis.name;
    
    // Определяем целевое количество регионов по правилам
    let targetRegions;
    if (area >= rules.hugeCountry.minAreaSqKm) {
      targetRegions = rules.hugeCountry.targetRegions;
    } else if (area >= rules.largeCountry.minAreaSqKm) {
      targetRegions = rules.largeCountry.targetRegions;
    } else if (area >= rules.mediumCountry.minAreaSqKm) {
      targetRegions = rules.mediumCountry.targetRegions;
    } else if (area >= rules.smallCountry.minAreaSqKm) {
      targetRegions = rules.smallCountry.targetRegions;
    } else {
      targetRegions = rules.tinyCountry.targetRegions;
    }
    
    // Ограничиваем целевое количество количеством admin-1 регионов
    targetRegions = Math.min(targetRegions, admin1Regions.length);
    
    if (targetRegions === 0) continue;
    
    if (!countryToRegions[isoA3]) {
      countryToRegions[isoA3] = [];
    }
    
    // Распределяем admin-1 регионы по макро-регионам
    const regionsPerMacro = Math.ceil(admin1Regions.length / targetRegions);
    
    for (let i = 0; i < targetRegions; i++) {
      const startIdx = i * regionsPerMacro;
      const endIdx = Math.min(startIdx + regionsPerMacro, admin1Regions.length);
      const regionAdmin1s = admin1Regions.slice(startIdx, endIdx);
      
      if (regionAdmin1s.length === 0) continue;
      
      const regionId = generateRegionId(isoA3, i + 1);
      const subdivisionName = `${countryName} - Регион ${i + 1}`;
      
      regionMapping[regionId] = {
        id: regionId,
        countryId: isoA3,
        name: subdivisionName,
        admin1Ids: regionAdmin1s.map(r => r.id),
        type: 'land'
      };
      
      countryToRegions[isoA3].push(regionId);
    }
  }
  
  return { regionMapping, countryToRegions };
}

// Генерация GeoJSON для земельных регионов
function generateLandGeoJSON(regionMapping) {
  const features = [];
  
  for (const [regionId, regionData] of Object.entries(regionMapping)) {
    // Находим все admin-1 регионы по adm1_code
    const admin1Features = geoJson.features.filter(f => 
      regionData.admin1Ids.includes(f.properties?.adm1_code)
    );
    
    if (admin1Features.length === 0) {
      console.warn(`Не найдены admin-1 регионы для ${regionId}`);
      continue;
    }
    
    // Объединяем геометрии
    const mergedGeometry = mergeGeometries(admin1Features);
    
    // Создаём новый feature
    const feature = {
      type: 'Feature',
      geometry: mergedGeometry,
      properties: {
        id: regionId,
        countryId: regionData.countryId,
        name: regionData.name,
        type: 'land'
      }
    };
    
    features.push(feature);
  }
  
  return {
    type: 'FeatureCollection',
    features
  };
}

// Генерация канальных регионов
function generateCanalGeoJSON() {
  const features = [];
  
  // Каналы (упрощённая версия без реальных координат)
  const canals = [
    { id: 'CANAL-SUEZ', name: 'Суэцкий канал', type: 'canal', owner: 'EGY', attribute: 'naval_chokepoint' },
    { id: 'CANAL-PANAMA', name: 'Панамский канал', type: 'canal', owner: 'PAN', attribute: 'naval_chokepoint' },
    { id: 'CANAL-KIEL', name: 'Кильский канал', type: 'canal', owner: 'DEU', attribute: 'naval_chokepoint' }
  ];
  
  for (const canal of canals) {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [0, 0] // Заглушка - нужно добавить реальные координаты
      },
      properties: {
        id: canal.id,
        name: canal.name,
        type: 'canal',
        owner: canal.owner,
        attribute: canal.attribute
      }
    };
    
    features.push(feature);
  }
  
  return {
    type: 'FeatureCollection',
    features
  };
}

// Генерация морских регионов
function generateSeaGeoJSON() {
  const features = [];
  
  // Морские регионы (упрощённая версия без реальных координат)
  const seas = [
    { id: 'SEA-NORTH_ATLANTIC', name: 'Северная Атлантика', type: 'ocean' },
    { id: 'SEA-SOUTH_ATLANTIC', name: 'Южная Атлантика', type: 'ocean' },
    { id: 'SEA-NORTH_PACIFIC', name: 'Северный Тихий океан', type: 'ocean' },
    { id: 'SEA-SOUTH_PACIFIC', name: 'Южный Тихий океан', type: 'ocean' },
    { id: 'SEA-ARCTIC', name: 'Северный Ледовитый океан', type: 'ocean' },
    { id: 'SEA-INDIAN', name: 'Индийский океан', type: 'ocean' },
    { id: 'SEA-MEDITERRANEAN', name: 'Средиземное море', type: 'sea' },
    { id: 'SEA-BALTIC', name: 'Балтийское море', type: 'sea' },
    { id: 'SEA-BLACK', name: 'Чёрное море', type: 'sea' },
    { id: 'SEA-NORTH', name: 'Северное море', type: 'sea' },
    { id: 'SEA-NORWEGIAN', name: 'Норвежское море', type: 'sea' },
    { id: 'SEA-CARIBBEAN', name: 'Карибское море', type: 'sea' },
    { id: 'SEA-SOUTH_CHINA', name: 'Южно-Китайское море', type: 'sea' },
    { id: 'SEA-EAST_CHINA', name: 'Восточно-Китайское море', type: 'sea' },
    { id: 'SEA-PHILIPPINE', name: 'Филиппинское море', type: 'sea' },
    { id: 'SEA-CORAL', name: 'Коралловое море', type: 'sea' },
    { id: 'SEA-ARABIAN', name: 'Аравийское море', type: 'sea' },
    { id: 'SEA-RED', name: 'Красное море', type: 'sea' },
    { id: 'SEA-JAPAN', name: 'Японское море', type: 'sea' },
    { id: 'SEA-BERING', name: 'Берингово море', type: 'sea' }
  ];
  
  for (const sea of seas) {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] // Заглушка
      },
      properties: {
        id: sea.id,
        name: sea.name,
        type: sea.type
      }
    };
    
    features.push(feature);
  }
  
  return {
    type: 'FeatureCollection',
    features
  };
}

// Объединение всех GeoJSON
function mergeGeoJSONCollections(collections) {
  const allFeatures = [];
  
  for (const collection of collections) {
    allFeatures.push(...collection.features);
  }
  
  return {
    type: 'FeatureCollection',
    features: allFeatures
  };
}

// Основной процесс
console.log('1. Создание маппинга регионов...');
const { regionMapping, countryToRegions } = createRegionMapping();

console.log(`   Создано ${Object.keys(regionMapping).length} макро-регионов`);

console.log('\n2. Генерация GeoJSON для земельных регионов...');
const landGeoJSON = generateLandGeoJSON(regionMapping);
console.log(`   Создано ${landGeoJSON.features.length} земельных регионов`);

console.log('\n3. Генерация GeoJSON для канальных регионов...');
const canalGeoJSON = generateCanalGeoJSON();
console.log(`   Создано ${canalGeoJSON.features.length} канальных регионов`);

console.log('\n4. Генерация GeoJSON для морских регионов...');
const seaGeoJSON = generateSeaGeoJSON();
console.log(`   Создано ${seaGeoJSON.features.length} морских регионов`);

console.log('\n5. Объединение всех GeoJSON...');
const mergedGeoJSON = mergeGeoJSONCollections([landGeoJSON, canalGeoJSON, seaGeoJSON]);
console.log(`   Всего регионов: ${mergedGeoJSON.features.length}`);

// Сохранение результатов
const outputPath = path.join(process.cwd(), 'client/src/assets/world_map_1946.geojson');
fs.writeFileSync(outputPath, JSON.stringify(mergedGeoJSON, null, 2));
console.log(`\nGeoJSON сохранён в: ${outputPath}`);

// Сохранение маппинга регионов
const mappingOutputPath = path.join(process.cwd(), 'client/src/assets/regions_mapping_1946.json');
fs.writeFileSync(mappingOutputPath, JSON.stringify(regionMapping, null, 2));
console.log(`Маппинг регионов сохранён в: ${mappingOutputPath}`);

// Статистика
console.log('\n=== СТАТИСТИКА ===');
console.log(`Целевое количество земельных регионов: ${mapping.targetLandRegions}`);
console.log(`Фактическое количество земельных регионов: ${landGeoJSON.features.length}`);
console.log(`Целевое количество морских регионов: ${mapping.targetSeaRegions}`);
console.log(`Фактическое количество морских регионов: ${seaGeoJSON.features.length}`);
console.log(`Канальные регионы: ${canalGeoJSON.features.length}`);
console.log(`Всего регионов: ${mergedGeoJSON.features.length}`);

console.log('\n=== ГОТОВО ===');
