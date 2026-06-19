/**
 * generateV2.ts — Генерация мира 1946, версия 2
 * 
 * Запуск: npx tsx scripts/generate_world_1946/generateV2.ts
 * 
 * Использует:
 * - EUROPE_TARGETS и REGION_NAMES из regionMappingV2.ts
 * - Обработка Германии, Китая, каналов, водных регионов
 * - Автоматическая группировка остальных стран через mergeTarget
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';
import { EUROPE_TARGETS, REGION_NAMES, ISO_TO_OWNER } from './regionMappingV2';
import {
  GERMANY_OCCUPATION_ZONES,
  getChinaOwner,
  HISTORICAL_NAMES_RU,
  POPULATION_1946,
  COUNTRY_PROFILES,
  getResourceProfile,
  getMergeTarget,
  ISO_TO_COUNTRY_ID,
} from './historical_data';
import type { GeoJsonFeature, FeatureCollection, RegionRecord, AnyObj } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAME_MAP_PATH = path.join(__dirname, '../../client/src/assets/game_map.json');
const OUTPUT_GEOJSON_PATH = path.join(__dirname, '../../client/public/world-map-1946-v2.geojson');
const OUTPUT_REGIONS_PATH = path.join(__dirname, '../../data/scenarios/1946/regions-v2.json');
const OUTPUT_SERVER_REGIONS_PATH = path.join(__dirname, '../../server/data/scenarios/1946/regions-v2.json');

// ===================================================
// Helper functions (из index.ts)
// ===================================================

function pickAdm1(props: AnyObj): string {
  return String(props.adm1_code || props.iso_3166_2 || props.code_hasc || props.name_en || props.name || '').trim();
}

function pickCountryIso(props: AnyObj): string {
  return String(props.adm0_a3 || props.sov_a3 || props.iso_a3 || '').trim();
}

function pickNameEn(props: AnyObj): string {
  return String(props.name_en || props.name || props.admin || pickAdm1(props)).trim();
}

function getAreaSqKm(feature: GeoJsonFeature): number {
  const area = Number(feature.properties?.area_sqkm || 0);
  if (Number.isFinite(area) && area > 0) return area;
  try {
    return Math.max(0, turf.area(feature as any) / 1_000_000);
  } catch { return 0; }
}

function loadJson<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function saveJson(filePath: string, value: any) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
  console.log(`Saved: ${filePath}`);
}

function normalizeText(s: any): string {
  return String(s ?? '').trim();
}

function mergeFeatures(features: GeoJsonFeature[]): any {
  if (features.length === 0) return null;
  const polygons: number[][][][] = [];
  for (const f of features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') polygons.push([f.geometry.coordinates]);
    else if (f.geometry.type === 'MultiPolygon') polygons.push(...f.geometry.coordinates);
  }
  if (polygons.length === 0) return null;
  try {
    if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
    return { type: 'MultiPolygon', coordinates: polygons };
  } catch { return null; }
}

function getRussianName(adm1Code: string, nameEn: string, nameRu?: string): string {
  if (nameRu && nameRu.trim()) return nameRu.trim();
  if (HISTORICAL_NAMES_RU[adm1Code]) return HISTORICAL_NAMES_RU[adm1Code];
  return nameEn || adm1Code;
}

function estimatePopulation(feature: GeoJsonFeature, ownerId: string | null): number {
  const adm1 = pickAdm1(feature.properties || {});
  if (POPULATION_1946[adm1]) return POPULATION_1946[adm1] * 1000;
  const area = Math.max(1, getAreaSqKm(feature));
  const iso = pickCountryIso(feature.properties || {});
  const densities: Record<string, number> = {
    USA: 150, CAN: 80, CHN: 1200, RUS: 35, SUN: 35,
    DEU: 3000, GBR: 2500, NLD: 2500, BEL: 2000,
    IND: 8000, JPN: 3000, KOR: 4000, PRK: 4000,
    IDN: 500, PHL: 600, VNM: 800, THA: 500,
    BRA: 100, MEX: 200, ARG: 100, COL: 200,
    NGA: 600, EGY: 500, ETH: 200,
    FRA: 800, ITA: 800, ESP: 500,
  };
  const density = densities[iso] || 100;
  return Math.max(50000, Math.round(area * density));
}

function estimatePopulationForMerged(features: GeoJsonFeature[], ownerId: string | null): number {
  return features.reduce((sum, f) => sum + estimatePopulation(f, ownerId), 0);
}

// ===================================================
// Group features by geographic proximity
// ===================================================

function groupFeaturesByLongitude(features: GeoJsonFeature[], k: number): GeoJsonFeature[][] {
  if (k <= 0 || features.length === 0) return [];
  if (k >= features.length) return features.map(f => [f]);
  
  const sorted = [...features].sort((a, b) => {
    const la = Number(a.properties?.longitude || a.properties?.latitude || 0);
    const lb = Number(b.properties?.longitude || b.properties?.latitude || 0);
    return la - lb;
  });
  
  const groups: GeoJsonFeature[][] = Array.from({ length: k }, () => []);
  sorted.forEach((f, i) => groups[i % k].push(f));
  return groups.filter(g => g.length > 0);
}

// ===================================================
// Main pipeline
// ===================================================

function main() {
  console.log('=== World Generator 1946 v2 ===\n');
  
  // 1. Load source
  const source = loadJson<FeatureCollection>(GAME_MAP_PATH);
  console.log(`Loaded ${source.features.length} features from game_map.json`);
  
  // 2. Group features by country (ISO code)
  const byIso = new Map<string, GeoJsonFeature[]>();
  for (const f of source.features) {
    const iso = pickCountryIso(f.properties || {});
    if (!iso) continue;
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso)!.push(f);
  }
  console.log(`Grouped into ${byIso.size} countries/territories`);
  
  const processedFeatures: GeoJsonFeature[] = [];
  let mergedCount = 0;
  let europeCount = 0;
  let otherCount = 0;
  
  // 3. Process each country
  for (const [iso, features] of byIso) {
    // --- SPECIAL CASES (same as original) ---
    
    // Germany occupation zones
    if (iso === 'DEU') {
      for (const f of features) {
        const adm1 = pickAdm1(f.properties || {});
        const zoneInfo = GERMANY_OCCUPATION_ZONES[adm1];
        f.properties.ownerCountryId = zoneInfo ? zoneInfo.ownerId : 'Germany';
        processedFeatures.push(f);
      }
      continue;
    }
    
    // China - split by CCP/KMT
    if (iso === 'CHN') {
      for (const f of features) {
        const adm1 = pickAdm1(f.properties || {});
        f.properties.ownerCountryId = getChinaOwner(adm1);
        processedFeatures.push(f);
      }
      continue;
    }
    
    // Taiwan / Hong Kong / Macau
    if (iso === 'TWN' || iso === 'HKG' || iso === 'MAC') {
      for (const f of features) {
        f.properties.ownerCountryId = 'Taiwan';
        processedFeatures.push(f);
      }
      continue;
    }
    
    // --- EUROPE TARGETS (v2) ---
    const europeTarget = EUROPE_TARGETS[iso];
    if (europeTarget !== undefined) {
      europeCount++;
      
      if (europeTarget <= 1 || features.length <= 1) {
        // Merge all into one region
        const geometry = mergeFeatures(features);
        if (geometry) {
          const firstProps = features[0].properties || {};
          const totalPop = estimatePopulationForMerged(features, ISO_TO_OWNER[iso] || iso);
          const totalArea = features.reduce((s, f) => s + getAreaSqKm(f), 0);
          const owner = ISO_TO_OWNER[iso] || iso;
          
          const regionName = REGION_NAMES[iso]?.[0]?.[0] || `${iso}`;
          const regionNameEn = REGION_NAMES[iso]?.[0]?.[1] || pickNameEn(firstProps);
          
          processedFeatures.push({
            type: 'Feature',
            geometry,
            properties: {
              ...firstProps,
              adm1_code: `${iso}-MERGED`,
              ownerCountryId: owner,
              name: regionName,
              name_en: regionNameEn,
              population: totalPop,
              area_sqkm: Math.round(totalArea),
              merged: true,
              originalCount: features.length,
              sourceAdm1Codes: features.map(f => pickAdm1(f.properties || {})),
            },
          });
          mergedCount++;
        } else {
          processedFeatures.push(...features);
        }
      } else {
        // Merge into N groups
        const groups = groupFeaturesByLongitude(features, europeTarget);
        
        for (let gi = 0; gi < groups.length; gi++) {
          const group = groups[gi];
          if (group.length === 0) continue;
          
          if (group.length === 1) {
            const f = group[0];
            f.properties.ownerCountryId = ISO_TO_OWNER[iso] || iso;
            
            // Apply regional name if available
            const regionName = REGION_NAMES[iso]?.[gi];
            if (regionName) {
              f.properties.name = regionName[0];
              f.properties.name_en = regionName[1];
            }
            
            processedFeatures.push(f);
            continue;
          }
          
          const geometry = mergeFeatures(group);
          if (geometry) {
            const firstProps = group[0].properties || {};
            const totalPop = estimatePopulationForMerged(group, ISO_TO_OWNER[iso] || iso);
            const totalArea = group.reduce((s, f) => s + getAreaSqKm(f), 0);
            const owner = ISO_TO_OWNER[iso] || iso;
            
            const regionName = REGION_NAMES[iso]?.[gi];
            const nameRu = regionName ? regionName[0] : `${owner} Region ${gi + 1}`;
            const nameEn = regionName ? regionName[1] : `Region ${gi + 1}`;
            
            processedFeatures.push({
              type: 'Feature',
              geometry,
              properties: {
                ...firstProps,
                adm1_code: `${iso}-GROUP-${gi + 1}`,
                ownerCountryId: owner,
                name: nameRu,
                name_en: nameEn,
                population: totalPop,
                area_sqkm: Math.round(totalArea),
                merged: true,
                originalCount: group.length,
                sourceAdm1Codes: group.map(f => pickAdm1(f.properties || {})),
              },
            });
            mergedCount++;
          } else {
            for (const f of group) {
              f.properties.ownerCountryId = ISO_TO_OWNER[iso] || iso;
              processedFeatures.push(f);
            }
          }
        }
      }
      continue;
    }
    
    // --- OTHER COUNTRIES (old logic) ---
    const ownerId = ISO_TO_COUNTRY_ID[iso];
    const mergeTarget = getMergeTarget(iso);
    
    if (mergeTarget !== null && features.length > 1) {
      otherCount++;
      
      if (mergeTarget <= 1 || features.length <= mergeTarget) {
        // Merge all into one
        const geometry = mergeFeatures(features);
        if (geometry) {
          const firstProps = features[0].properties || {};
          processedFeatures.push({
            type: 'Feature',
            geometry,
            properties: {
              ...firstProps,
              adm1_code: `${iso}-MERGED`,
              ownerCountryId: ownerId || iso,
              merged: true,
              originalCount: features.length,
              sourceAdm1Codes: features.map(f => pickAdm1(f.properties || {})),
            },
          });
          mergedCount++;
        } else {
          processedFeatures.push(...features);
        }
      } else {
        // Merge into K groups
        const groups = groupFeaturesByLongitude(features, mergeTarget);
        
        for (let gi = 0; gi < groups.length; gi++) {
          const group = groups[gi];
          if (group.length === 0) continue;
          if (group.length === 1) {
            processedFeatures.push(group[0]);
            continue;
          }
          const geometry = mergeFeatures(group);
          if (geometry) {
            const firstProps = group[0].properties || {};
            const groupNames = group.map(f => pickNameEn(f.properties || {}));
            processedFeatures.push({
              type: 'Feature',
              geometry,
              properties: {
                ...firstProps,
                adm1_code: `${iso}-MERGE-${gi + 1}`,
                ownerCountryId: ownerId || iso,
                merged: true,
                originalCount: group.length,
                mergedGroupName: groupNames.join(' / '),
                sourceAdm1Codes: group.map(f => pickAdm1(f.properties || {})),
              },
            });
            mergedCount++;
          } else {
            processedFeatures.push(...group);
          }
        }
      }
      continue;
    }
    
    // Default: keep as original
    for (const f of features) {
      if (!f.properties.ownerCountryId) {
        f.properties.ownerCountryId = ownerId || null;
      }
      processedFeatures.push(f);
    }
  }
  
  console.log(`\nProcessed: ${processedFeatures.length} features (${mergedCount} merged)`);
  console.log(`Europe countries (v2): ${europeCount}`);
  console.log(`Other countries (v1): ${otherCount}`);
  
  // 4. Prepare water region records
  const { createWaterRegionRecords } = require('./water_regions');
  console.log('\nPreparing water region records...');
  const waterRecords = createWaterRegionRecords();
  console.log(`Water region records: ${waterRecords.length}`);
  
  // 5. Enrich features with game data
  const enrichedFeatures: GeoJsonFeature[] = [];
  
  for (const f of processedFeatures) {
    const props = f.properties || {};
    const adm1 = pickAdm1(props);
    const en = pickNameEn(props);
    const ownerId = normalizeText(props.ownerCountryId || null) || null;
    const isWater = props.regionType === 'water' || props.water;
    
    // Use merged/regional name if available
    const ru = props.name || getRussianName(adm1, en, props.name_ru);
    const profile = ownerId ? (COUNTRY_PROFILES[ownerId] || COUNTRY_PROFILES[props.ownerCountryId] || { urbanization: 0.3, stability: 0.5, infrastructure: 0.4, development: 0.5 }) 
                            : { urbanization: 0.3, stability: 0.5, infrastructure: 0.4, development: 0.5 };
    const population = isWater ? 0 : (Number(props.population) || estimatePopulation(f, ownerId));
    const resources = isWater ? {} : getResourceProfile(ownerId);
    const area = Number(props.area_sqkm) || getAreaSqKm(f);
    
    const colors: Record<string, string> = {
      'USSR': '#CC0000', 'USA': '#0066CC', 'UK': '#003366', 'FRA': '#0055AA',
      'Germany': '#DDDD00', 'DEU-USSR': '#CC0000', 'DEU-USA': '#0066CC',
      'DEU-UK': '#003366', 'DEU-FRA': '#0055AA', 'CAN': '#3399FF',
      'China': '#FF0000', 'Taiwan': '#0000FF', 'JPN': '#FFFF00',
      'ITA': '#00AA00', 'KOR': '#00FF00', 'IND': '#FF8800',
      'BRA': '#00BB00', 'AUS': '#996600', 'MEX': '#88AA00',
      'ARG': '#88CC00', 'EGY': '#CC8800', 'TUR': '#AA8800',
      'SAF': '#666600', 'POL': '#660066', 'YUG': '#880088',
    };
    
    const ownerColor = ownerId ? (colors[ownerId] || '#808080') : '#808080';
    const ownerNames: Record<string, string> = {
      'USSR': 'СССР', 'USA': 'США', 'UK': 'Великобритания', 'FRA': 'Франция',
      'Germany': 'Германия', 'DEU-USSR': 'Германия (СССР)', 'DEU-USA': 'Германия (США)',
      'DEU-UK': 'Германия (Великобритания)', 'DEU-FRA': 'Германия (Франция)',
      'CAN': 'Канада', 'China': 'Китай', 'Taiwan': 'Китай (Гоминьдан)', 'JPN': 'Япония',
      'ITA': 'Италия', 'KOR': 'Корея', 'IND': 'Индия', 'BRA': 'Бразилия',
      'AUS': 'Австралия', 'MEX': 'Мексика', 'ARG': 'Аргентина', 'EGY': 'Египет',
      'TUR': 'Турция', 'SAF': 'ЮАС', 'POL': 'Польша', 'YUG': 'Югославия',
    };
    
    const kind = isWater ? 'water' : 'land';
    
    enrichedFeatures.push({
      ...f,
      properties: {
        ...props,
        id: adm1,
        adm1_code: adm1,
        name: ru,
        name_en: props.name_en || en,
        name_ru: ru,
        ownerCountryId: ownerId,
        ownerColor,
        ownerName: ownerId ? (ownerNames[ownerId] || props.ownerCountryId || ownerId) : 'Neutral',
        population,
        area_sqkm: Math.round(area),
        urbanization: profile.urbanization,
        stability: profile.stability,
        infrastructure: profile.infrastructure,
        development: profile.development,
        resourceProduction: resources,
        kind,
        historicalYear: 1946,
        type: 'region',
        color: isWater ? '#0d2a4d' : '#1a3a5c',
      },
    });
  }
  
  // 6. Save GeoJSON
  const outputGeoJson: FeatureCollection = {
    type: 'FeatureCollection',
    features: enrichedFeatures,
  };
  saveJson(OUTPUT_GEOJSON_PATH, outputGeoJson);
  
  // 7. Generate regions.json
  const regions: RegionRecord[] = [];
  let nextId = 1;
  
  for (const f of enrichedFeatures) {
    const props = f.properties || {};
    const owner = normalizeText(props.ownerCountryId || null) || null;
    
    regions.push({
      id: nextId++,
      geoJsonId: pickAdm1(props),
      name: normalizeText(props.name_ru || props.name || props.name_en || ''),
      nameEn: normalizeText(props.name_en || props.name || ''),
      ownerCountryId: owner,
      kind: 'land',
      historicalYear: 1946,
      population: Number(props.population || 0),
      area: Number(props.area_sqkm || 0),
      urbanization: Number(props.urbanization || 0),
      stability: Number(props.stability || 0),
      infrastructure: Number(props.infrastructure || 0),
      development: Number(props.development || 0),
      resourceProduction: props.resourceProduction || {},
      neighboringRegionIds: [],
      sourceAdm1Codes: Array.isArray(props.sourceAdm1Codes) ? props.sourceAdm1Codes : [pickAdm1(props)],
    });
  }
  
  // Add water regions
  const waterTypes: Record<string, RegionRecord['kind']> = {
    ocean: 'ocean', sea: 'sea', lake: 'lake', canal: 'canal',
  };
  
  for (const wr of waterRecords) {
    regions.push({
      id: nextId++,
      geoJsonId: wr.geoJsonId,
      name: wr.name,
      nameEn: wr.nameEn,
      ownerCountryId: null,
      kind: waterTypes[wr.kind] || 'water',
      historicalYear: 1946,
      population: 0,
      area: wr.area,
      urbanization: 0,
      stability: 1,
      infrastructure: 0,
      development: 0,
      resourceProduction: wr.resourceProduction,
      neighboringRegionIds: [],
      sourceAdm1Codes: [wr.geoJsonId],
    });
  }
  
  saveJson(OUTPUT_REGIONS_PATH, regions);
  saveJson(OUTPUT_SERVER_REGIONS_PATH, regions);
  
  // 8. Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total regions: ${regions.length}`);
  console.log(`Land regions: ${regions.filter(r => r.kind === 'land').length}`);
  console.log(`Water regions: ${regions.filter(r => r.kind !== 'land').length}`);
  
  const ownerCounts = new Map<string, number>();
  for (const r of regions) {
    const o = r.ownerCountryId || 'Neutral';
    ownerCounts.set(o, (ownerCounts.get(o) || 0) + 1);
  }
  
  const sorted = [...ownerCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\nTop owners:');
  for (const [owner, count] of sorted.slice(0, 30)) {
    console.log(`  ${String(count).padStart(4)}  ${owner}`);
  }
  if (sorted.length > 30) console.log(`  ... and ${sorted.length - 30} more`);
  
  console.log('\nDone!');
}

main();