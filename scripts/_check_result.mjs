import fs from 'fs';

const geo = JSON.parse(fs.readFileSync('client/src/assets/world_map_1946.geojson', 'utf8'));
const reg = JSON.parse(fs.readFileSync('shared/src/data/regions_1946.json', 'utf8'));

console.log('=== АНАЛИЗ РЕЗУЛЬТАТА ===');
console.log('GeoJSON features:', geo.features.length);
console.log('Regions count:', Object.keys(reg).length);

// Типы
const sizes = {};
geo.features.forEach(f => {
  const t = f.properties.type;
  sizes[t] = (sizes[t] || 0) + 1;
});
console.log('\nТипы:', JSON.stringify(sizes));

// Владельцы
const owners = {};
geo.features.forEach(f => {
  const o = f.properties.ownerId;
  if (o) owners[o] = (owners[o] || 0) + 1;
});
console.log('\nВладельцы:');
Object.entries(owners).sort((a,b) => b[1]-a[1]).forEach(([o,c]) => console.log(`  ${o}: ${c}`));

// Проверка покрытия исходных регионов
console.log('\n=== Потери исходных регионов ===');
const src = JSON.parse(fs.readFileSync('client/src/assets/game_map.json', 'utf8'));
const srcCodes = new Set(src.features.map(f => f.properties.adm1_code).filter(Boolean));
const usedCodes = new Set();
Object.values(reg).forEach(r => {
  if (r.sourceAdm1Codes) r.sourceAdm1Codes.forEach(c => usedCodes.add(c));
});
const lost = [...srcCodes].filter(c => !usedCodes.has(c));
console.log(`Исходных admin-1 кодов: ${srcCodes.size}`);
console.log(`Использовано: ${usedCodes.size}`);
console.log(`Потеряно: ${lost.length}`);
if (lost.length > 0) {
  console.log('Первые 20 потерянных:');
  lost.slice(0, 20).forEach(c => {
    const srcFeat = src.features.find(f => f.properties.adm1_code === c);
    console.log(`  ${c}: ${srcFeat?.properties?.name || '???'} (${srcFeat?.properties?.adm0_a3 || '???'})`);
  });
}

// Проверка наличия водных регионов
console.log('\n=== Водные регионы ===');
const seas = Object.values(reg).filter(r => r.type === 'sea' || r.type === 'ocean');
const canals = Object.values(reg).filter(r => r.type === 'canal');
console.log(`Моря/океаны: ${seas.length}`);
seas.forEach(s => console.log(`  ${s.geoJsonId}: ${s.name}`));
console.log(`Каналы: ${canals.length}`);
canals.forEach(c => console.log(`  ${c.geoJsonId}: ${c.name}`));

// Проверка Германии
console.log('\n=== Германия ===');
const deuRegs = Object.values(reg).filter(r => r.ownerCountryId && r.ownerCountryId.startsWith('DEU'));
deuRegs.forEach(r => console.log(`  ${r.geoJsonId}: ${r.name} (${r.ownerCountryId})`));