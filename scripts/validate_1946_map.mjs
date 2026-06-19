/**
 * validate_1946_map.mjs
 *
 * Валидация сгенерированной карты 1946.
 *
 * Проверяет:
 * 1. Соответствие GeoJSON и regions.json
 * 2. Покрытие исходных admin-1 регионов
 * 3. Уникальность ID
 * 4. Валидность GeoJSON
 * 5. Историческую корректность владельцев
 * 6. Наличие key-регионов (Берлин, каналы, моря)
 */

import fs from 'fs';

const GEOJSON = 'client/src/assets/world_map_1946.geojson';
const REGIONS = 'shared/src/data/regions_1946.json';
const ORIGINAL = 'client/src/assets/game_map.json';

let errors = 0;
let warnings = 0;

function err(msg) { console.error(`  ОШИБКА: ${msg}`); errors++; }
function warn(msg) { console.warn(`  ПРЕДУПРЕЖДЕНИЕ: ${msg}`); warnings++; }
function ok(msg) { console.log(`  ✓ ${msg}`); }

console.log('=== ВАЛИДАЦИЯ КАРТЫ 1946 ===\n');

// 1. Загрузка
const geo = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
const regObj = JSON.parse(fs.readFileSync(REGIONS, 'utf8'));
const orig = JSON.parse(fs.readFileSync(ORIGINAL, 'utf8'));

const regs = Object.values(regObj);
console.log('1. Загрузка данных:');
ok(`GeoJSON features: ${geo.features.length}`);
ok(`Regions: ${regs.length}`);

// 2. Соответствие
console.log('\n2. Соответствие GeoJSON и regions:');
const geoIds = new Set(geo.features.map(f => f.properties.id));
const regIds = new Set(regs.map(r => r.geoJsonId));
const onlyGeo = [...geoIds].filter(id => !regIds.has(id));
const onlyReg = [...regIds].filter(id => !geoIds.has(id));

if (onlyGeo.length) err(`${onlyGeo.length} ID в GeoJSON отсутствуют в regions: ${onlyGeo.slice(0,5).join(', ')}`);
else ok('Все GeoJSON ID есть в regions');

if (onlyReg.length) err(`${onlyReg.length} ID в regions отсутствуют в GeoJSON: ${onlyReg.slice(0,5).join(', ')}`);
else ok('Все regions ID есть в GeoJSON');

// 3. Уникальность ID
console.log('\n3. Уникальность ID:');
const geoDupes = geo.features.filter((f, i) => geo.features.findIndex(g => g.properties.id === f.properties.id) !== i);
if (geoDupes.length) err(`Дубликаты в GeoJSON: ${[...new Set(geoDupes.map(f => f.properties.id))].join(', ')}`);
else ok('GeoJSON ID уникальны');

const regDupes = regs.filter((r, i) => regs.findIndex(r2 => r2.id === r.id) !== i);
if (regDupes.length) err(`Дубликаты в regions: ${regDupes.map(r => r.id).join(', ')}`);
else ok('Regions ID уникальны');

// 4. Валидность GeoJSON
console.log('\n4. Валидность GeoJSON:');
if (geo.type !== 'FeatureCollection') err('GeoJSON не FeatureCollection');
else ok('Тип: FeatureCollection');

let invalid = 0;
for (const f of geo.features) {
  if (!f.geometry || !f.properties) invalid++;
  else if (!['Polygon', 'MultiPolygon', 'Point', 'LineString'].includes(f.geometry.type)) invalid++;
}
if (invalid) err(`${invalid} features с невалидной геометрией`);
else ok('Все геометрии валидны');

// 5. Типы регионов
console.log('\n5. Типы регионов:');
const byType = {};
geo.features.forEach(f => {
  const t = f.properties.type;
  byType[t] = (byType[t] || 0) + 1;
});
for (const [t, c] of Object.entries(byType)) {
  console.log(`  ${t}: ${c}`);
}
if (byType['land'] < 1000 || byType['land'] > 3000) warn(`Земельных регионов ${byType['land']} (вне диапазона 1000-3000)`);
else ok(`Земельных регионов: ${byType['land']}`);
if (byType['ocean'] !== 6) err(`Океанов: ${byType['ocean']} (ожидается 6)`);
else ok('Океанов: 6');
if (byType['sea'] !== 14) err(`Морей: ${byType['sea']} (ожидается 14)`);
else ok('Морей: 14');
if (byType['canal'] !== 3) err(`Каналов: ${byType['canal']} (ожидается 3)`);
else ok('Каналов: 3');

// 6. Покрытие исходных регионов
console.log('\n6. Покрытие исходных admin-1:');
const srcCodes = new Set(orig.features.map(f => f.properties.adm1_code).filter(Boolean));
const usedCodes = new Set();
regs.forEach(r => { if (r.sourceAdm1Codes) r.sourceAdm1Codes.forEach(c => usedCodes.add(c)); });

const lost = [...srcCodes].filter(c => !usedCodes.has(c));
console.log(`  Исходных admin-1: ${srcCodes.size}`);
console.log(`  Использовано: ${usedCodes.size}`);
console.log(`  Потеряно: ${lost.length}`);

if (lost.length > 16) warn(`Потеряно ${lost.length} регионов (допустимо ~16 спорных)`);
const exempted = ['ATA', 'SOL', 'USG', 'CYN', 'KAS', 'KAB', 'ESB', 'WSB', 'HMD', 'IOT', 'SGS', 'PFA', 'CSI', 'PGA', 'CLP', 'ATC'];
const realLost = lost.filter(c => !exempted.some(e => c.startsWith(e)));
if (realLost.length) {
  console.log(`  Непредвиденные потери (${realLost.length}):`);
  realLost.slice(0, 10).forEach(c => {
    const origF = orig.features.find(f => f.properties.adm1_code === c);
    console.log(`    ${c}: ${origF?.properties?.name || '???'} (${origF?.properties?.adm0_a3 || '???'})`);
  });
}
if (!realLost.length) ok('Все регионы покрыты (кроме exempted)');

// 7. Исторические владельцы
console.log('\n7. Проверка исторических владельцев:');
// Простая проверка: USA- → USA, CAN- → CAN, GBR- → GBR, FRA- → FRA
const simpleChecks = [
  { prefix: 'USA-', expected: 'USA' },
  { prefix: 'CAN-', expected: 'CAN' },
  { prefix: 'GBR-', expected: 'GBR' },
  { prefix: 'FRA-', expected: 'FRA' },
];
for (const { prefix, expected } of simpleChecks) {
  const regions = Object.values(regObj).filter(r => r.geoJsonId.startsWith(prefix));
  const wrong = regions.filter(r => r.ownerCountryId !== expected);
  if (wrong.length) err(`Регионы ${prefix}: ${wrong.length} с неверным владельцем (${wrong[0].ownerCountryId} вместо ${expected})`);
  else ok(`${prefix}: владелец ${expected}`);
}
// DEU: проверяем что каждый регион с префиксом DEU- имеет соответствующий owner
const deuRegs = Object.values(regObj).filter(r => r.geoJsonId.startsWith('DEU-'));
for (const r of deuRegs) {
  // DEU-BERLIN-USSR → DEU-USSR, DEU-USSR → DEU-USSR
  const expectedOwner = r.geoJsonId.replace('DEU-BERLIN-', 'DEU-').replace('DEU-', 'DEU-');
  // Определяем владельца: если есть Berlin, берем зону из ID
  if (r.geoJsonId.startsWith('DEU-BERLIN-')) {
    const zonePart = r.geoJsonId.replace('DEU-BERLIN-', '');
    const correctOwner = 'DEU-' + zonePart;
    if (r.ownerCountryId !== correctOwner) err(`${r.geoJsonId}: владелец ${r.ownerCountryId} вместо ${correctOwner}`);
  } else if (r.geoJsonId.startsWith('DEU-') && !r.geoJsonId.startsWith('DEU-BERLIN')) {
    // Прямые зоны: DEU-USSR, DEU-USA, DEU-UK, DEU-FRA
    if (r.geoJsonId !== r.ownerCountryId) err(`${r.geoJsonId}: владелец ${r.ownerCountryId} вместо ${r.geoJsonId}`);
  }
}
ok(`DEU: проверено ${deuRegs.length} регионов`);

// 8. Ключевые регионы
console.log('\n8. Наличие ключевых регионов:');
const required = [
  'DEU-BERLIN-USSR', 'DEU-BERLIN-USA', 'DEU-BERLIN-UK', 'DEU-BERLIN-FRA',
  'CANAL-SUEZ', 'CANAL-PANAMA', 'CANAL-KIEL',
  'SEA-MEDITERRANEAN', 'SEA-BALTIC', 'SEA-BLACK',
  'SEA-NORTH-ATLANTIC', 'SEA-INDIAN',
];
for (const id of required) {
  if (geoIds.has(id)) ok(`${id} присутствует`);
  else err(`${id} отсутствует`);
}

// 9. Обязательные поля
console.log('\n9. Обязательные поля regions:');
const requiredFields = ['id', 'geoJsonId', 'name', 'ownerCountryId', 'type', 'sourceAdm1Codes'];
let missingCount = 0;
for (const r of regs) {
  for (const f of requiredFields) {
    if (!(f in r)) { missingCount++; break; }
  }
}
if (missingCount) err(`${missingCount} regions с пропущенными полями`);
else ok('Все regions имеют обязательные поля');

// 10. Размер файлов
console.log('\n10. Размер файлов:');
const geoSize = fs.statSync(GEOJSON).size;
const regSize = fs.statSync(REGIONS).size;
console.log(`  GeoJSON: ${(geoSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Regions: ${(regSize / 1024).toFixed(0)} KB`);
if (geoSize > 100 * 1024 * 1024) warn('GeoJSON > 100 MB, рекомендуется сжатие');

// Итог
console.log(`\n=== ИТОГ ===`);
console.log(`Ошибок: ${errors}`);
console.log(`Предупреждений: ${warnings}`);
if (errors === 0) console.log('\n✓ Валидация пройдена');
else console.log(`\n✗ Валидация не пройдена (${errors} ошибок)`);
process.exit(errors > 0 ? 1 : 0);