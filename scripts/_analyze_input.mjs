import fs from 'fs';

const d = JSON.parse(fs.readFileSync('client/src/assets/game_map.json', 'utf8'));
console.log('=== АНАЛИЗ game_map.json ===');
console.log('Features:', d.features.length);
console.log('Type:', d.type);

const f = d.features[0];
console.log('First feature keys:', Object.keys(f));
console.log('First props:', JSON.stringify(f.properties, null, 2).slice(0, 800));
console.log('Geometry type:', f.geometry.type);

// DEU
const deu = d.features.filter(x => x.properties.adm0_a3 === 'DEU');
console.log('\n=== DEU (Германия) ===');
console.log('Count:', deu.length);
deu.forEach(x => console.log('  ' + x.properties.adm1_code + ': ' + x.properties.name));

// DEU Berlin
const berlin = d.features.find(x => x.properties.adm1_code === 'DEU-1599');
if (berlin) {
  console.log('\n=== Berlin feature ===');
  console.log('  adm1_code:', berlin.properties.adm1_code);
  console.log('  name:', berlin.properties.name);
  console.log('  name_en:', berlin.properties.name_en);
  console.log('  name_ru:', berlin.properties.name_ru);
}

// Статистика по странам
const countries = {};
for (const feat of d.features) {
  const a3 = feat.properties.adm0_a3 || 'NONE';
  if (!countries[a3]) countries[a3] = { count: 0, area: 0, name: feat.properties.admin || '' };
  countries[a3].count++;
}
console.log('\n=== СТРАНЫ ===');
const sorted = Object.entries(countries).sort((a, b) => b[1].count - a[1].count);
for (const [iso, info] of sorted) {
  console.log(iso + ' (' + info.name + '): ' + info.count + ' regions');
}

// Типы геометрий
const geomTypes = {};
for (const feat of d.features) {
  const t = feat.geometry.type;
  geomTypes[t] = (geomTypes[t] || 0) + 1;
}
console.log('\n=== Геометрия ===');
for (const [t, c] of Object.entries(geomTypes)) {
  console.log(t + ': ' + c);
}