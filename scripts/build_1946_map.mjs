/**
 * build_1946_map.mjs
 *
 * Генерация GeoJSON и regions.json для сценария 1946.
 *
 * Вход:  client/src/assets/game_map.json  — 4596 admin-1 регионов
 * Выход: client/src/assets/world_map_1946.geojson
 *        shared/src/data/regions_1946.json
 */

import fs from 'fs';
import * as turf from '@turf/turf';

// ===========================
// 1. КОНФИГУРАЦИЯ
// ===========================

const INPUT_GEOJSON = 'client/src/assets/game_map.json';
const OUTPUT_GEOJSON = 'client/src/assets/world_map_1946.geojson';
const OUTPUT_REGIONS = 'shared/src/data/regions_1946.json';

/** Исторические владельцы регионов на 1946 год */
const OWNER_1946 = {
  SUN: 'USSR', RUS: 'USSR', UKR: 'USSR', BLR: 'USSR',
  EST: 'USSR', LVA: 'USSR', LTU: 'USSR', MDA: 'USSR',
  GEO: 'USSR', ARM: 'USSR', AZE: 'USSR',
  KAZ: 'USSR', UZB: 'USSR', TKM: 'USSR', KGZ: 'USSR', TJK: 'USSR',
  USA: 'USA', CAN: 'CAN', GBR: 'GBR', FRA: 'FRA',
  AUS: 'AUS', NZL: 'NZL', ZAF: 'ZAF',
  CHN: 'CHN', TWN: 'CHN',
  ITA: 'ITA', JPN: 'JPN',
  POL: 'POL', CZE: 'CZE', SVK: 'SVK',
  HUN: 'HUN', ROU: 'ROU', BGR: 'BGR', YUG: 'YUG', ALB: 'ALB',
  GRC: 'GRC', TUR: 'TUR',
  NOR: 'NOR', SWE: 'SWE', DNK: 'DNK', FIN: 'FIN',
  NLD: 'NLD', BEL: 'BEL', CHE: 'CHE', ESP: 'ESP', PRT: 'PRT',
  ARG: 'ARG', BRA: 'BRA', CHL: 'CHL', MEX: 'MEX',
  EGY: 'EGY', IRN: 'IRN', IRQ: 'IRQ', SAU: 'SAU',
  ETH: 'ETH', LBR: 'LBR',
  THA: 'THA', IND: 'IND', PAK: 'PAK', BGD: 'BGD',
  IDN: 'IDN', PHL: 'PHL', MMR: 'MMR',
  // Колонии
  HKG: 'GBR', SGP: 'GBR', MYS: 'GBR', BRN: 'GBR',
  MAC: 'PRT', TLS: 'PRT',
  VNM: 'FRA', KHM: 'FRA', LAO: 'FRA',
  LBY: 'FRA', DZA: 'FRA', MAR: 'FRA', TUN: 'TUN',
  SDN: 'GBR', SOM: 'ITA', ERI: 'ITA',
  NGA: 'GBR', GHA: 'GBR', KEN: 'GBR', TZA: 'GBR',
  ZAF: 'GBR', ZWE: 'GBR', ZMB: 'GBR', BWA: 'GBR',
  AGO: 'PRT', MOZ: 'PRT',
  COD: 'BEL', COG: 'FRA', GAB: 'FRA', CAF: 'FRA', TCD: 'FRA',
  MLI: 'FRA', SEN: 'FRA', CIV: 'FRA', BEN: 'FRA', NER: 'FRA', BFA: 'FRA', MRT: 'FRA',
  MDG: 'FRA',
  PRI: 'USA', GUM: 'USA', ASM: 'USA', VIR: 'USA',
  CUB: 'CUB', HTI: 'HTI', DOM: 'DOM',
  PAN: 'PAN', CRI: 'CRI', NIC: 'NIC', HND: 'HND', SLV: 'SLV', GTM: 'GTM', BLZ: 'GBR',
  COL: 'COL', VEN: 'VEN', ECU: 'ECU', PER: 'PER', BOL: 'BOL', PRY: 'PRY', URY: 'URY',
  GRL: 'DNK', ISL: 'ISL',
  LBN: 'FRA', SYR: 'FRA', JOR: 'GBR',
  YEM: 'YEM', OMN: 'OMN', ARE: 'GBR', QAT: 'QAT', BHR: 'BHR', KWT: 'KWT',
  AFG: 'AFG', MNG: 'MNG', NPL: 'NPL', BTN: 'BTN', LKA: 'GBR',
  MCO: 'MCO', AND: 'AND', LIE: 'LIE', SMR: 'SMR', VAT: 'VAT', MLT: 'MLT',
  LUX: 'LUX',
  KOR: 'KOR',
  // Территории без владельца — оставляем ISO как ownerId
};

/** Страны с микро-делением (scalerank 7-10) — агрессивное объединение */
const HIGH_DETAIL = new Set([
  'SVN', 'LVA', 'MKD', 'BFA', 'MLT', 'BHS', 'MDA',
  'HRV', 'MNE', 'BIH', 'KOS', 'CPV', 'SYC', 'TTO', 'MUS', 'PLW',
  'AIA', 'KNA', 'NRU', 'BRB', 'LCA', 'BMU', 'ALD', 'COK', 'WSM',
  'DMA', 'SLB', 'SMR', 'ATG', 'VCT', 'VUT', 'GRD', 'TCA',
  'MDV', 'UMI', 'MNP', 'FJI', 'TON', 'PYF',
]);

/** Tiny — 1 регион */
const TINY = new Set([
  'HKG', 'MAC', 'SGP', 'BRN', 'LUX', 'MCO', 'AND', 'SMR', 'LIE', 'VAT',
  'MLT', 'GIB', 'BHR', 'QAT', 'KWT',
  'COM', 'STP', 'MDV', 'MHL', 'KIR', 'TUV', 'NRU', 'PLW', 'FSM',
  'DMA', 'GRD', 'KNA', 'LCA', 'VCT', 'ATG', 'BRB', 'TTO',
  'MUS', 'SYC', 'CPV', 'BLZ',
]);

/** Спорные/спецтерритории — пропускаем */
const SKIP = new Set([
  'ATA', 'SOL', 'KAS', 'PGA', 'CSI', 'CLP', 'ATC', 'IOT', 'HMD', 'SGS',
  'CYN', 'USG', 'KAB', 'ESB', 'WSB', 'PFA',
]);

/** Русские названия */
const RU_NAMES = {
  'USA-NORTHEAST': 'Северо-Восток США',
  'USA-MIDWEST': 'Средний Запад',
  'USA-SOUTH': 'Юг США',
  'USA-WEST': 'Запад США',
  'USA-ALASKA': 'Аляска',
  'USA-HAWAII': 'Гавайи',
  'CAN-ATLANTIC': 'Атлантическая Канада',
  'CAN-QUEBEC': 'Квебек',
  'CAN-ONTARIO': 'Онтарио',
  'CAN-PRAIRIES': 'Прерии',
  'CAN-BC': 'Британская Колумбия',
  'CAN-NORTH': 'Северные территории',
  'CHN-NORTHEAST': 'Маньчжурия',
  'CHN-NORTH': 'Северный Китай',
  'CHN-EAST': 'Восточный Китай',
  'CHN-CENTRAL': 'Центральный Китай',
  'CHN-SOUTH': 'Южный Китай',
  'CHN-SOUTHWEST': 'Юго-Западный Китай',
  'CHN-NORTHWEST': 'Северо-Западный Китай',
  'CHN-TIBET': 'Тибет',
  'DEU-USSR': 'Советская зона оккупации',
  'DEU-USA': 'Американская зона оккупации',
  'DEU-UK': 'Британская зона оккупации',
  'DEU-FRA': 'Французская зона оккупации',
  'DEU-BERLIN-USSR': 'Берлин (Советский сектор)',
  'DEU-BERLIN-USA': 'Берлин (Американский сектор)',
  'DEU-BERLIN-UK': 'Берлин (Британский сектор)',
  'DEU-BERLIN-FRA': 'Берлин (Французский сектор)',
  'USSR-RSFSR-NW': 'Северо-Запад РСФСР',
  'USSR-RSFSR-CENTER': 'Центр РСФСР',
  'USSR-RSFSR-VOLGA': 'Поволжье',
  'USSR-RSFSR-URALS': 'Урал',
  'USSR-RSFSR-SIBERIA': 'Сибирь',
  'USSR-RSFSR-EAST': 'Дальний Восток',
  'USSR-RSFSR-SOUTH': 'Юг РСФСР',
  'SEA-NORTH-ATLANTIC': 'Северная Атлантика',
  'SEA-SOUTH-ATLANTIC': 'Южная Атлантика',
  'SEA-NORTH-PACIFIC': 'Северный Тихий океан',
  'SEA-SOUTH-PACIFIC': 'Южный Тихий океан',
  'SEA-ARCTIC': 'Северный Ледовитый океан',
  'SEA-INDIAN': 'Индийский океан',
  'SEA-MEDITERRANEAN': 'Средиземное море',
  'SEA-BALTIC': 'Балтийское море',
  'SEA-BLACK': 'Чёрное море',
  'SEA-NORTH': 'Северное море',
  'SEA-NORWEGIAN': 'Норвежское море',
  'SEA-CARIBBEAN': 'Карибское море',
  'SEA-SOUTH-CHINA': 'Южно-Китайское море',
  'SEA-EAST-CHINA': 'Восточно-Китайское море',
  'SEA-PHILIPPINE': 'Филиппинское море',
  'SEA-CORAL': 'Коралловое море',
  'SEA-ARABIAN': 'Аравийское море',
  'SEA-RED': 'Красное море',
  'SEA-JAPAN': 'Японское море',
  'SEA-BERING': 'Берингово море',
  'CANAL-SUEZ': 'Суэцкий канал',
  'CANAL-PANAMA': 'Панамский канал',
  'CANAL-KIEL': 'Кильский канал',
};

function getRu(id, fallback) {
  return RU_NAMES[id] || fallback || id;
}

// ===========================
// 2. УТИЛИТЫ
// ===========================

function getIso(p) { return (p.adm0_a3 || '').trim(); }
function getCode(p) { return (p.adm1_code || '').trim(); }
function getName(p) { return p.name_ru || p.name_en || p.name || p.admin || p.adm1_code || ''; }

function getArea(feature) {
  try { return turf.area(feature) / 1_000_000; } catch { return 0; }
}

function dissolveGeometries(features) {
  const coords = [];
  for (const f of features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') coords.push(f.geometry.coordinates);
    else if (f.geometry.type === 'MultiPolygon') coords.push(...f.geometry.coordinates);
  }
  if (coords.length === 0) return null;
  if (coords.length === 1) return { type: 'Polygon', coordinates: coords[0] };
  return { type: 'MultiPolygon', coordinates: coords };
}

function makeMergedFeature(features, props) {
  const geom = dissolveGeometries(features);
  if (!geom) return null;
  return { type: 'Feature', geometry: geom, properties: { ...features[0].properties, ...props } };
}

function centroid(feature) {
  try {
    const c = turf.centroid(feature).geometry.coordinates;
    return { lon: c[0], lat: c[1] };
  } catch { return { lon: 0, lat: 0 }; }
}

function clusterByProximity(features, k) {
  if (features.length <= 1 || k <= 1) return [features];
  const sorted = [...features].sort((a, b) => {
    const ca = centroid(a);
    const cb = centroid(b);
    return ca.lon - cb.lon || ca.lat - cb.lat;
  });
  const chunks = Array.from({ length: k }, () => []);
  for (let i = 0; i < sorted.length; i++) chunks[i % k].push(sorted[i]);
  return chunks.filter(c => c.length > 0);
}

function matchName(feature, names) {
  const p = feature.properties || {};
  const candidates = [
    (p.name_en || '').toLowerCase(),
    (p.name || '').toLowerCase(),
    (p.admin || '').toLowerCase(),
    (p.name_ru || '').toLowerCase(),
    (p.adm1_code || '').toLowerCase(),
  ];
  return names.some(n => candidates.some(c => c.includes(n.toLowerCase())));
}

// ===========================
// 3. ЗАГРУЗКА
// ===========================

console.log('=== ЗАГРУЗКА game_map.json ===');
const source = JSON.parse(fs.readFileSync(INPUT_GEOJSON, 'utf8'));
const allFeatures = source.features;
console.log(`Загружено features: ${allFeatures.length}`);

const byCountry = {};
for (const f of allFeatures) {
  const iso = getIso(f.properties);
  if (!byCountry[iso]) byCountry[iso] = [];
  byCountry[iso].push(f);
}
console.log(`Стран: ${Object.keys(byCountry).length}`);

// ===========================
// 4. ПРАВИЛА ОБЪЕДИНЕНИЯ
// ===========================

function targetRegionCount(iso, features, area) {
  if (TINY.has(iso)) return 1;
  // Для US/CA/CN/DEU/USSR — своя логика
  if (['USA', 'CAN', 'CHN', 'DEU'].includes(iso)) return 0; // special handling
  const sovietIsos = ['RUS', 'UKR', 'BLR', 'EST', 'LVA', 'LTU', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'SUN'];
  if (sovietIsos.includes(iso)) return 0; // USSR handled separately

  // High-detail micro-countries
  if (HIGH_DETAIL.has(iso)) {
    if (area < 5000) return 1;
    if (area < 50000) return Math.min(3, Math.ceil(features.length / 30));
    return Math.min(5, Math.ceil(features.length / 40));
  }

  // Площадь земли в km²
  if (area >= 7000000) return 60; // Россия, Канада, США, Китай, Бразилия, Австралия
  if (area >= 3000000) return 40; // Индия, Аргентина
  if (area >= 1000000) return 20; // Мексика, Индонезия
  if (area >= 500000) return 12;  // Гренландия, Саудовская Аравия
  if (area >= 250000) return 8;   // Франция, Испания, Турция
  if (area >= 100000) return 4;   // Италия, Польша
  if (area >= 50000) return 3;    // Греция, Португалия
  if (area >= 25000) return 2;    // Бельгия, Нидерланды
  return 1;
}

// ===========================
// 5. МАКРО-РЕГИОНЫ ПО СТРАНАМ
// ===========================

const USA_MACROS = {
  'USA-NORTHEAST': ['maine','new hampshire','vermont','massachusetts','rhode island','connecticut','new york','new jersey','pennsylvania'],
  'USA-MIDWEST': ['ohio','michigan','indiana','illinois','wisconsin','minnesota','iowa','missouri','north dakota','south dakota','nebraska','kansas'],
  'USA-SOUTH': ['delaware','maryland','virginia','west virginia','kentucky','tennessee','north carolina','south carolina','georgia','florida','alabama','mississippi','arkansas','louisiana','oklahoma','texas','district of columbia'],
  'USA-WEST': ['montana','idaho','wyoming','colorado','new mexico','arizona','utah','nevada','washington','oregon','california'],
  'USA-ALASKA': ['alaska'],
  'USA-HAWAII': ['hawaii'],
};

const CANADA_MACROS = {
  'CAN-ATLANTIC': ['newfoundland and labrador','prince edward island','nova scotia','new brunswick'],
  'CAN-QUEBEC': ['quebec'],
  'CAN-ONTARIO': ['ontario'],
  'CAN-PRAIRIES': ['manitoba','saskatchewan','alberta'],
  'CAN-BC': ['british columbia'],
  'CAN-NORTH': ['northwest territories','nunavut','yukon'],
};

const CHINA_MACROS = {
  'CHN-NORTHEAST': ['heilongjiang','jilin','liaoning'],
  'CHN-NORTH': ['beijing','tianjin','hebei','shanxi','inner mongolia'],
  'CHN-EAST': ['shanghai','jiangsu','zhejiang','anhui','fujian','jiangxi','shandong'],
  'CHN-CENTRAL': ['henan','hubei','hunan'],
  'CHN-SOUTH': ['guangdong','guangxi','hainan'],
  'CHN-SOUTHWEST': ['chongqing','sichuan','guizhou','yunnan'],
  'CHN-NORTHWEST': ['shaanxi','gansu','qinghai','ningxia','xinjiang'],
  'CHN-TIBET': ['tibet'],
};

const DEU_OCCUPATION = {
  'DEU-USSR': ['brandenburg','mecklenburg-vorpommern','saxony','saxony-anhalt','thuringia'],
  'DEU-USA': ['bavaria','hesse','baden-württemberg','bremen'],
  'DEU-UK': ['lower saxony','north rhine-westphalia','schleswig-holstein','hamburg'],
  'DEU-FRA': ['rhineland-palatinate','saarland'],
};

// ===========================
// 6. ОБРАБОТКА
// ===========================

let regionCounter = 0;
const geoJsonFeatures = [];
const outputRegions = {};

function nextId() { return ++regionCounter; }

function addRegion(geoJsonId, name, type, ownerId, sourceCodes, geom, extraProps = {}) {
  const id = nextId();
  const ruName = getRu(geoJsonId, name);

  if (geom) {
    geoJsonFeatures.push({
      type: 'Feature',
      geometry: geom,
      properties: { id: geoJsonId, name: ruName, name_en: name, type, ownerId, ...extraProps },
    });
  }

  outputRegions[id] = {
    id, geoJsonId, name: ruName, ownerCountryId: ownerId,
    iso_a3: geoJsonId.split('-')[0] || ownerId || '',
    type, population: 0, area: 0,
    urbanization: type === 'land' ? 0.3 : 0,
    stability: type === 'land' ? 0.5 : 1.0,
    infrastructure: type === 'land' ? 0.3 : 0,
    development: type === 'land' ? 0.3 : 0,
    gdp: 0, resourceProduction: {}, neighboringRegionIds: [],
    sourceAdm1Codes: sourceCodes || [],
  };
}

// ===========================
// ОБРАБОТКА СПЕЦИАЛЬНЫХ СТРАН
// ===========================

function processUSA() {
  const features = byCountry['USA'] || [];
  if (!features.length) return;
  console.log(`\nСША: ${features.length} admin-1`);

  const used = new Set();
  for (const [macroId, stateNames] of Object.entries(USA_MACROS)) {
    const group = features.filter(f => matchName(f, stateNames));
    group.forEach(f => used.add(getCode(f.properties)));
    if (!group.length) continue;
    const merged = makeMergedFeature(group, {});
    const codes = group.map(f => getCode(f.properties));
    addRegion(macroId, macroId, 'land', 'USA', codes, merged?.geometry);
    console.log(`  ${macroId}: ${group.length} штатов`);
  }
  const leftover = features.filter(f => !used.has(getCode(f.properties)));
  if (leftover.length) console.warn(`  Осталось: ${leftover.length}`);
}

function processCanada() {
  const features = byCountry['CAN'] || [];
  if (!features.length) return;
  console.log(`\nКанада: ${features.length} admin-1`);

  const used = new Set();
  for (const [macroId, provNames] of Object.entries(CANADA_MACROS)) {
    const group = features.filter(f => matchName(f, provNames));
    group.forEach(f => used.add(getCode(f.properties)));
    if (!group.length) continue;
    const merged = makeMergedFeature(group, {});
    const codes = group.map(f => getCode(f.properties));
    addRegion(macroId, macroId, 'land', 'CAN', codes, merged?.geometry);
    console.log(`  ${macroId}: ${group.length} провинций`);
  }
  const leftover = features.filter(f => !used.has(getCode(f.properties)));
  if (leftover.length) console.warn(`  Осталось: ${leftover.length}`);
}

function processChina() {
  const features = byCountry['CHN'] || [];
  if (!features.length) return;
  console.log(`\nКитай: ${features.length} admin-1`);

  const used = new Set();
  for (const [macroId, provNames] of Object.entries(CHINA_MACROS)) {
    const group = features.filter(f => matchName(f, provNames));
    group.forEach(f => used.add(getCode(f.properties)));
    if (!group.length) continue;
    const merged = makeMergedFeature(group, {});
    const codes = group.map(f => getCode(f.properties));
    addRegion(macroId, macroId, 'land', 'CHN', codes, merged?.geometry);
    console.log(`  ${macroId}: ${group.length} провинций`);
  }
  const leftover = features.filter(f => !used.has(getCode(f.properties)));
  if (leftover.length) {
    console.warn(`  Осталось: ${leftover.length} (например ${leftover[0]?.properties?.name})`);
    // Добавляем оставшиеся как отдельные регионы
    leftover.forEach(f => {
      const code = getCode(f.properties);
      addRegion(`CHN-${code}`, code, 'land', 'CHN', [code], f.geometry);
    });
  }
}

function processGermany() {
  const features = byCountry['DEU'] || [];
  if (!features.length) return;
  console.log(`\nГермания: ${features.length} земель`);

  const berlinCode = 'DEU-1599';
  const berlin = features.find(f => getCode(f.properties) === berlinCode);
  const landFeatures = features.filter(f => getCode(f.properties) !== berlinCode);

  const used = new Set();
  for (const [zoneId, landNames] of Object.entries(DEU_OCCUPATION)) {
    const group = landFeatures.filter(f => matchName(f, landNames));
    group.forEach(f => used.add(getCode(f.properties)));
    if (!group.length) continue;
    const merged = makeMergedFeature(group, {});
    const codes = group.map(f => getCode(f.properties));
    addRegion(zoneId, zoneId, 'land', zoneId, codes, merged?.geometry);
    console.log(`  ${zoneId}: ${group.length} земель`);
  }

  // Berlin split
  if (berlin) {
    console.log(`  Разделение Берлина...`);
    const bbox = turf.bbox(berlin);
    const [minX, minY, maxX, maxY] = bbox;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const sectors = [
      { id: 'DEU-BERLIN-USSR', owner: 'DEU-USSR', box: [minX, midY, midX, maxY] },
      { id: 'DEU-BERLIN-USA', owner: 'DEU-USA', box: [midX, midY, maxX, maxY] },
      { id: 'DEU-BERLIN-UK', owner: 'DEU-UK', box: [minX, minY, midX, midY] },
      { id: 'DEU-BERLIN-FRA', owner: 'DEU-FRA', box: [midX, minY, maxX, midY] },
    ];

    for (const sector of sectors) {
      let sectorGeom = null;
      try {
        const clipped = turf.bboxClip(berlin, sector.box);
        if (clipped && clipped.geometry) sectorGeom = clipped.geometry;
      } catch (e) { console.warn(`    Ошибка ${sector.id}: ${e.message}`); }
      addRegion(sector.id, sector.id, 'land', sector.owner, [berlinCode], sectorGeom);
    }
    used.add(berlinCode);
    console.log(`  4 сектора Берлина созданы`);
  }

  const leftover = landFeatures.filter(f => !used.has(getCode(f.properties)));
  if (leftover.length) {
    console.warn(`  Осталось: ${leftover.length} (${leftover.map(f => getName(f.properties)).join(', ')})`);
    // Добавляем по одному
    leftover.forEach(f => {
      const code = getCode(f.properties);
      const zoneCode = 'DEU-UNASSIGNED';
      addRegion(`DEU-${code}`, getName(f.properties), 'land', zoneCode, [code], f.geometry);
    });
  }
}

function processUSSR() {
  const sovietIsos = ['RUS', 'UKR', 'BLR', 'EST', 'LVA', 'LTU', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'SUN'];
  let total = 0;

  for (const iso of sovietIsos) {
    const features = byCountry[iso] || [];
    if (!features.length) continue;
    total += features.length;

    const area = features.reduce((s, f) => s + getArea(f), 0);
    const target = targetRegionCount(iso, features, area);

    // Для РСФСР — именованные макро-регионы, для остальных — кластеризация
    const macroNames = ['USSR-RSFSR-NW', 'USSR-RSFSR-CENTER', 'USSR-RSFSR-VOLGA',
      'USSR-RSFSR-URALS', 'USSR-RSFSR-SIBERIA', 'USSR-RSFSR-EAST', 'USSR-RSFSR-SOUTH'];

    const effectiveTarget = Math.max(target, Math.ceil(features.length / 3));
    const clusters = iso === 'RUS'
      ? clusterByProximity(features, Math.min(effectiveTarget, 7))
      : clusterByProximity(features, Math.min(effectiveTarget, features.length));

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      if (!cluster.length) continue;
      const geoJsonId = (iso === 'RUS' && i < macroNames.length)
        ? macroNames[i]
        : `USSR-${iso}-${String(i + 1).padStart(2, '0')}`;
      const merged = makeMergedFeature(cluster, {});
      const codes = cluster.map(f => getCode(f.properties));
      addRegion(geoJsonId, geoJsonId, 'land', 'USSR', codes, merged?.geometry);
    }
  }
  console.log(`\nСССР: ${total} admin-1 объединены`);
}

/** Обработка обычной страны */
function processCountry(iso) {
  const features = byCountry[iso] || [];
  if (!features.length) return false;

  const area = features.reduce((s, f) => s + getArea(f), 0);
  const target = targetRegionCount(iso, features, area);
  const owner = OWNER_1946[iso] || iso;

  console.log(`\n${iso} (${features[0].properties?.admin || ''}): ${features.length} admin-1, ${Math.round(area)} km² -> ${target} регионов`);

  // Для стран с target <= 1 или 1 регионом — просто объединяем
  if (target <= 1 || features.length <= 1) {
    const merged = makeMergedFeature(features, {});
    const codes = features.map(f => getCode(f.properties));
    addRegion(`${iso}-001`, iso, 'land', owner, codes, merged?.geometry);
    return true;
  }

  // Кластеризация: минимум target, максимум features.length
  const effectiveTarget = Math.min(target, features.length);
  const clusters = clusterByProximity(features, effectiveTarget);

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    if (!cluster.length) continue;
    const geoJsonId = `${iso}-${String(i + 1).padStart(3, '0')}`;
    const codes = cluster.map(f => getCode(f.properties));
    const merged = makeMergedFeature(cluster, {});
    addRegion(geoJsonId, geoJsonId, 'land', owner, codes, merged?.geometry);
  }

  return true;
}

// ===========================
// 7. МОРЯ И КАНАЛЫ
// ===========================

const SEA_BOUNDING_BOXES = {
  'SEA-NORTH-ATLANTIC': [-80, 0, -20, 70],
  'SEA-SOUTH-ATLANTIC': [-60, -60, 20, 0],
  'SEA-NORTH-PACIFIC': [120, 0, -80, 65],
  'SEA-SOUTH-PACIFIC': [120, -60, -70, 0],
  'SEA-ARCTIC': [-180, 65, 180, 90],
  'SEA-INDIAN': [20, -60, 120, 30],
  'SEA-MEDITERRANEAN': [-5, 30, 36, 46],
  'SEA-BALTIC': [10, 54, 29, 66],
  'SEA-BLACK': [27, 41, 42, 47],
  'SEA-NORTH': [-5, 51, 10, 62],
  'SEA-NORWEGIAN': [-10, 62, 20, 72],
  'SEA-CARIBBEAN': [-90, 8, -60, 22],
  'SEA-SOUTH-CHINA': [100, 0, 120, 25],
  'SEA-EAST-CHINA': [120, 22, 130, 35],
  'SEA-PHILIPPINE': [124, 0, 135, 25],
  'SEA-CORAL': [145, -30, 170, -10],
  'SEA-ARABIAN': [40, 0, 80, 25],
  'SEA-RED': [33, 12, 44, 30],
  'SEA-JAPAN': [128, 33, 142, 46],
  'SEA-BERING': [-180, 52, -160, 66],
};

function addSeas() {
  console.log('\n=== МОРЯ ===');
  for (const [seaId, [minX, minY, maxX, maxY]] of Object.entries(SEA_BOUNDING_BOXES)) {
    const coords = [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]];
    const geom = { type: 'Polygon', coordinates: coords };
    const isOcean = seaId.includes('ATLANTIC') || seaId.includes('PACIFIC') || seaId.includes('ARCTIC') || seaId.includes('INDIAN');
    addRegion(seaId, seaId, isOcean ? 'ocean' : 'sea', null, [], geom);
    console.log(`  ${seaId}`);
  }
}

function addCanals() {
  console.log('\n=== КАНАЛЫ ===');
  const canals = [
    { id: 'CANAL-SUEZ', owner: 'GBR', coords: [[32.5, 31.5], [32.6, 31.0], [32.7, 30.5], [32.8, 30.0], [32.6, 29.5], [32.5, 29.0], [32.5, 28.5]] },
    { id: 'CANAL-PANAMA', owner: 'USA', coords: [[-79.5, 9.0], [-79.6, 9.2], [-79.7, 9.4], [-79.8, 9.6], [-79.6, 9.8], [-79.5, 10.0]] },
    { id: 'CANAL-KIEL', owner: 'DEU-UK', coords: [[10.0, 54.3], [10.2, 54.3], [10.4, 54.35], [10.6, 54.35], [10.8, 54.4]] },
  ];

  for (const canal of canals) {
    let geom = null;
    try {
      const line = turf.lineString(canal.coords);
      const buffered = turf.buffer(line, 0.08, { units: 'degrees' });
      if (buffered && buffered.geometry) geom = buffered.geometry;
    } catch (e) { console.warn(`  Ошибка ${canal.id}: ${e.message}`); }
    addRegion(canal.id, canal.id, 'canal', canal.owner, [], geom);
    console.log(`  ${canal.id} -> ${canal.owner}`);
  }
}

// ===========================
// 8. MAIN
// ===========================

console.log('\n=== ОБРАБОТКА СТРАН ===');

processUSA();
processCanada();
processChina();
processGermany();
processUSSR();

const sovietSet = new Set(['RUS', 'UKR', 'BLR', 'EST', 'LVA', 'LTU', 'MDA', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'SUN']);
const specialSet = new Set(['USA', 'CAN', 'CHN', 'DEU']);

let processed = 0;
for (const [iso, features] of Object.entries(byCountry)) {
  if (specialSet.has(iso) || sovietSet.has(iso) || SKIP.has(iso)) continue;
  if (features.length === 0) continue;
  processCountry(iso);
  processed++;
}
console.log(`\nОбработано обычных стран: ${processed}`);

addSeas();
addCanals();

// ===========================
// 9. СОХРАНЕНИЕ
// ===========================

console.log('\n=== СОХРАНЕНИЕ ===');

const outputGeoJson = { type: 'FeatureCollection', features: geoJsonFeatures };
fs.writeFileSync(OUTPUT_GEOJSON, JSON.stringify(outputGeoJson, null, 2));
console.log(`GeoJSON: ${OUTPUT_GEOJSON} (${geoJsonFeatures.length} features)`);

fs.writeFileSync(OUTPUT_REGIONS, JSON.stringify(outputRegions, null, 2));
console.log(`Regions: ${OUTPUT_REGIONS} (${Object.keys(outputRegions).length} regions)`);

const landCount = geoJsonFeatures.filter(f => f.properties.type === 'land').length;
const seaCount = geoJsonFeatures.filter(f => f.properties.type === 'sea' || f.properties.type === 'ocean').length;
const canalCount = geoJsonFeatures.filter(f => f.properties.type === 'canal').length;
console.log(`\n=== СТАТИСТИКА ===`);
console.log(`Земельные: ${landCount}`);
console.log(`Моря/океаны: ${seaCount}`);
console.log(`Каналы: ${canalCount}`);
console.log(`Всего: ${geoJsonFeatures.length}`);

console.log('\n=== ГОТОВО ===');