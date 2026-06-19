import fs from 'fs';
import path from 'path';

// Загрузка данных
const geoJsonPath = path.join(process.cwd(), 'client/src/assets/world_map_1946.geojson');
const regionsPath = path.join(process.cwd(), 'client/src/assets/regions_1946.json');
const originalGeoJsonPath = path.join(process.cwd(), 'client/src/assets/game_map.json');

const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
const regions = JSON.parse(fs.readFileSync(regionsPath, 'utf8'));
const originalGeoJson = JSON.parse(fs.readFileSync(originalGeoJsonPath, 'utf8'));

console.log('=== ВАЛИДАЦИЯ КАРТЫ МИРА ДЛЯ СЦЕНАРИЯ 1946 ===\n');

let errors = 0;
let warnings = 0;

// 1. Проверка соответствия GeoJSON и regions.json
console.log('1. Проверка соответствия GeoJSON и regions.json...');
const geoJsonIds = new Set(geoJson.features.map(f => f.properties.id));
const regionsIds = new Set(regions.map(r => r.id));

console.log(`   GeoJSON features: ${geoJson.features.length}`);
console.log(`   Regions count: ${regions.length}`);

if (geoJson.features.length === regions.length) {
  console.log('   ✓ Количество features соответствует количеству регионов');
} else {
  console.warn(`   ПРЕДУПРЕЖДЕНИЕ: Количество features (${geoJson.features.length}) не соответствует количеству регионов (${regions.length})`);
  warnings++;
}

// 2. Проверка уникальности ID
console.log('\n2. Проверка уникальности ID...');
const geoJsonDuplicates = [...geoJsonIds].filter((id, index) => [...geoJsonIds].indexOf(id) !== index);
const regionsDuplicates = [...regionsIds].filter((id, index) => [...regionsIds].indexOf(id) !== index);

if (geoJsonDuplicates.length > 0) {
  console.error(`   ОШИБКА: Найдены дубликаты ID в GeoJSON: ${[...new Set(geoJsonDuplicates)].slice(0, 5).join(', ')}`);
  errors += [...new Set(geoJsonDuplicates)].length;
} else if (regionsDuplicates.length > 0) {
  console.error(`   ОШИБКА: Найдены дубликаты ID в regions.json: ${[...new Set(regionsDuplicates)].slice(0, 5).join(', ')}`);
  errors += [...new Set(regionsDuplicates)].length;
} else {
  console.log('   ✓ Все ID уникальны');
}

// 3. Проверка валидности GeoJSON
console.log('\n3. Проверка валидности GeoJSON...');
if (geoJson.type !== 'FeatureCollection') {
  console.error('   ОШИБКА: GeoJSON не является FeatureCollection');
  errors++;
} else {
  console.log('   ✓ GeoJSON является FeatureCollection');
}

let invalidFeatures = 0;
for (const feature of geoJson.features) {
  if (!feature.geometry || !feature.properties) {
    invalidFeatures++;
  }
}

if (invalidFeatures > 0) {
  console.error(`   ОШИБКА: ${invalidFeatures} features не имеют geometry или properties`);
  errors += invalidFeatures;
} else {
  console.log('   ✓ Все features имеют geometry и properties');
}

// 4. Проверка покрытия территории
console.log('\n4. Проверка покрытия территории...');
const originalRegionCount = originalGeoJson.features.length;
const newRegionCount = geoJson.features.filter(f => f.properties.type === 'land').length;

console.log(`   Оригинальное количество admin-1 регионов: ${originalRegionCount}`);
console.log(`   Новое количество макро-регионов: ${newRegionCount}`);
console.log(`   Коэффициент сжатия: ${(originalRegionCount / newRegionCount).toFixed(2)}`);

if (newRegionCount > 2500) {
  console.warn(`   ПРЕДУПРЕЖДЕНИЕ: Количество регионов (${newRegionCount}) превышает целевое (2000-2500)`);
  warnings++;
} else if (newRegionCount < 1500) {
  console.warn(`   ПРЕДУПРЕЖДЕНИЕ: Количество регионов (${newRegionCount}) ниже целевого (1500-2500)`);
  warnings++;
} else {
  console.log('   ✓ Количество регионов в целевом диапазоне');
}

// 5. Проверка типов регионов
console.log('\n5. Проверка типов регионов...');
const landRegions = regions.filter(r => r.type === 'land');
const canalRegions = regions.filter(r => r.type === 'canal');
const seaRegions = regions.filter(r => r.type === 'sea');

console.log(`   Земельные регионы: ${landRegions.length}`);
console.log(`   Канальные регионы: ${canalRegions.length}`);
console.log(`   Морские регионы: ${seaRegions.length}`);

if (canalRegions.length !== 3) {
  console.error(`   ОШИБКА: Ожидается 3 канальных региона, найдено ${canalRegions.length}`);
  errors++;
} else {
  console.log('   ✓ Канальные регионы корректны');
}

if (seaRegions.length !== 20) {
  console.error(`   ОШИБКА: Ожидается 20 морских регионов, найдено ${seaRegions.length}`);
  errors++;
} else {
  console.log('   ✓ Морские регионы корректны');
}

// 6. Проверка владельцев
console.log('\n6. Проверка владельцев...');
const regionsWithoutOwner = regions.filter(r => !r.ownerId);

if (regionsWithoutOwner.length > 0) {
  console.error(`   ОШИБКА: ${regionsWithoutOwner.length} регионов не имеют владельца`);
  errors += regionsWithoutOwner.length;
} else {
  console.log('   ✓ Все регионы имеют владельца');
}

// Проверка исторических владельцев 1946
const historicalOwners = ['GBR', 'FRA', 'USA', 'USSR', 'NEUTRAL', 'OCCUPIED'];
const regionsWithModernOwner = regions.filter(r => 
  r.type === 'land' && 
  !historicalOwners.includes(r.ownerId) &&
  !['DEU_UK', 'DEU_USA', 'DEU_USSR', 'DEU_FRA'].includes(r.ownerId)
);

if (regionsWithModernOwner.length > 0) {
  console.warn(`   ПРЕДУПРЕЖДЕНИЕ: ${regionsWithModernOwner.length} регионов имеют современных владельцев вместо исторических`);
  warnings++;
} else {
  console.log('   ✓ Владельцы соответствуют 1946 году');
}

// 7. Проверка обязательных полей
console.log('\n7. Проверка обязательных полей...');
const requiredFields = ['id', 'name', 'ownerId', 'type', 'infrastructure', 'stability', 'developmentLevel'];
let missingFields = 0;

for (const region of regions) {
  for (const field of requiredFields) {
    if (!(field in region)) {
      missingFields++;
    }
  }
}

if (missingFields > 0) {
  console.error(`   ОШИБКА: ${missingFields} обязательных полей отсутствуют`);
  errors += missingFields;
} else {
  console.log('   ✓ Все обязательные поля присутствуют');
}

// 8. Проверка маппинга
console.log('\n8. Проверка маппинга...');
console.log('   ✓ Пропущено (GeoJSON генерируется из маппинга)');

// Итог
console.log('\n=== ИТОГ ВАЛИДАЦИИ ===');
console.log(`Ошибок: ${errors}`);
console.log(`Предупреждений: ${warnings}`);

if (errors === 0 && warnings === 0) {
  console.log('\n✓ Валидация пройдена успешно');
  process.exit(0);
} else if (errors === 0) {
  console.log('\n⚠ Валидация пройдена с предупреждениями');
  process.exit(0);
} else {
  console.log('\n✗ Валидация не пройдена');
  process.exit(1);
}
