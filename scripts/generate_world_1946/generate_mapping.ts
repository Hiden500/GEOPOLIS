/**
 * generate_mapping.ts — Автоматическая генерация маппинга регионов
 * 
 * Запуск: npx tsx scripts/generate_world_1946/generate_mapping.ts
 * 
 * Читает game_map.json и historical_data.ts, генерирует корректный regionMapping.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAME_MAP_PATH = path.join(__dirname, '../../client/src/assets/game_map.json');

interface FeatureProperties {
  adm0_a3?: string;
  adm1_code?: string;
  iso_3166_2?: string;
  name_en?: string;
  name?: string;
  area_sqkm?: number;
  latitude?: number;
  longitude?: number;
}

interface Feature {
  type: string;
  properties: FeatureProperties;
  geometry?: any;
}

interface FeatureCollection {
  type: string;
  features: Feature[];
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function main() {
  console.log('=== Generate Mapping ===\n');
  
  const source = loadJson<FeatureCollection>(GAME_MAP_PATH);
  console.log(`Loaded ${source.features.length} features`);
  
  // Группируем по ISO
  const byIso = new Map<string, Feature[]>();
  for (const f of source.features) {
    const iso = String(f.properties?.adm0_a3 || '').trim();
    if (!iso) continue;
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso)!.push(f);
  }
  
  // Целевое количество регионов для стран
  const targetCounts: Record<string, number> = {
    BEL: 5, NLD: 7, LUX: 1,
    DNK: 4, NOR: 4, SWE: 5, FIN: 6, ISL: 1,
    PRT: 6, ESP: 12,
    CHE: 3, AUT: 9,
    HUN: 6, POL: 17, CZE: 22,
    ROU: 6, BGR: 5, GRC: 14, ALB: 1,
    SVN: 1, HRV: 2, BIH: 4, SRB: 7, MNE: 1, MKD: 1,
    GBR: 21, IRL: 3,
    ITA: 11, EST: 3, LVA: 3, LTU: 3,
  };
  
  type RegionGroup = {
    name: string;
    nameEn: string;
    sources: string[];
    ownerCountryId: string;
  };
  
  const isoToOwner: Record<string, string> = {
    BEL: 'BEL', NLD: 'NED', LUX: 'LUX',
    DNK: 'DEN', NOR: 'NOR', SWE: 'SWE', FIN: 'FIN', ISL: 'ISL',
    PRT: 'PRT', ESP: 'ESP',
    CHE: 'SWI', AUT: 'AUT',
    HUN: 'HUN', POL: 'POL', CZE: 'CZE',
    ROU: 'ROU', BGR: 'BGR', GRC: 'GRE', ALB: 'ALB',
    SVN: 'YUG', HRV: 'YUG', BIH: 'YUG', SRB: 'YUG', MNE: 'YUG', MKD: 'YUG',
    GBR: 'UK', IRL: 'IRE',
    ITA: 'ITA', EST: 'USSR', LVA: 'USSR', LTU: 'USSR',
  };
  
  const isoToCountryName: Record<string, string> = {
    BEL: 'BEL', NLD: 'NLD', LUX: 'LUX',
    DNK: 'DNK', NOR: 'NOR', SWE: 'SWE', FIN: 'FIN', ISL: 'ISL',
    PRT: 'PRT', ESP: 'ESP',
    CHE: 'CHE', AUT: 'AUT',
    HUN: 'HUN', POL: 'POL',
    ROU: 'ROU', BGR: 'BGR', GRC: 'GRC', ALB: 'ALB',
    SVN: 'SVN', HRV: 'HRV', BIH: 'BIH', SRB: 'SRB', MNE: 'MNE', MKD: 'MKD',
    GBR: 'GBR', IRL: 'IRL',
    ITA: 'ITA', EST: 'EST', LVA: 'LVA', LTU: 'LTU',
  };
  
  // Региональные названия для групп (на русском)
  const groupNames: Record<string, Record<string, [string, string]>> = {
    BEL: {
      'BEL-FLANDERS': ['Фландрия', 'Flanders'],
      'BEL-WALLONIA': ['Валлония', 'Wallonia'],
      'BEL-BRUSSELS': ['Брюссель', 'Brussels'],
      'BEL-LIEGE': ['Льеж', 'Liège'],
      'BEL-LUXEMBOURG': ['Люксембург (Бельгийский)', 'Luxembourg (Belgian)'],
    },
    NLD: {
      'NLD-NORTH': ['Северные Нидерланды', 'Northern Netherlands'],
      'NLD-EAST': ['Восточные Нидерланды', 'Eastern Netherlands'],
      'NLD-WEST': ['Западные Нидерланды', 'Western Netherlands'],
      'NLD-SOUTH': ['Южные Нидерланды', 'Southern Netherlands'],
      'NLD-CENTRAL': ['Центральные Нидерланды', 'Central Netherlands'],
      'NLD-FRIESLAND': ['Фрисландия', 'Friesland'],
      'NLD-ISLANDS': ['Карибские Нидерланды', 'Caribbean Netherlands'],
    },
  };
  
  console.log('\nGenerating mapping for countries with regions > target...\n');
  
  const allMappings: Record<string, any> = {};
  let totalInputRegions = 0;
  let totalOutputRegions = 0;
  
  for (const [iso, features] of byIso) {
    const target = targetCounts[iso];
    if (!target) continue;
    
    totalInputRegions += features.length;
    const owner = isoToOwner[iso] || iso;
    const countryName = isoToCountryName[iso] || iso;
    
    // Сортируем по longitude для географической группировки
    const sorted = [...features].sort((a, b) => {
      const la = Number(a.properties?.longitude || a.properties?.latitude || 0);
      const lb = Number(b.properties?.longitude || b.properties?.latitude || 0);
      return la - lb;
    });
    
    if (features.length <= target) {
      // Каждый регион одиночный
      const mapping: Record<string, { name: string; nameEn: string; ownerCountryId: string; sources: string[] }> = {};
      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const code = f.properties.adm1_code || f.properties.iso_3166_2 || `${iso}-${i}`;
        const en = f.properties.name_en || f.properties.name || code;
        mapping[code] = {
          name: en,
          nameEn: en,
          ownerCountryId: owner,
          sources: [code],
        };
      }
      if (Object.keys(mapping).length > 0) {
        allMappings[iso] = mapping;
        totalOutputRegions += Object.keys(mapping).length;
      }
      continue;
    }
    
    // Нужно объединять
    const groups: RegionGroup[] = [];
    const k = Math.min(target, features.length);
    const itemsPerGroup = Math.ceil(features.length / k);
    
    for (let gi = 0; gi < k; gi++) {
      const start = gi * itemsPerGroup;
      const end = Math.min(start + itemsPerGroup, features.length);
      const group = sorted.slice(start, end);
      if (group.length === 0) continue;
      
      const firstCode = group[0].properties.adm1_code || group[0].properties.iso_3166_2 || '';
      const groupEn = group.map(f => f.properties.name_en || f.properties.name || '').filter(Boolean).join(' / ');
      const targetId = `${iso}-GROUP-${gi + 1}`;
      
      // Ищем в предопределенных названиях
      const pred = groupNames[iso]?.[targetId];
      const nameRu = pred ? pred[0] : `${countryName} - Регион ${gi + 1}`;
      const nameEn = pred ? pred[1] : groupEn;
      
      groups.push({
        name: nameRu,
        nameEn: nameEn.length > 60 ? nameEn.substring(0, 60) + '...' : nameEn,
        sources: group.map(f => f.properties.adm1_code || f.properties.iso_3166_2 || '').filter(Boolean),
        ownerCountryId: owner,
      });
    }
    
    if (groups.length > 0) {
      allMappings[iso] = {};
      for (const g of groups) {
        const key = g.sources.join('+').substring(0, 30) || `${iso}-auto-${groups.indexOf(g)}`;
        allMappings[iso][`${iso}-G${groups.indexOf(g) + 1}`] = g;
      }
      totalOutputRegions += groups.length;
      console.log(`${iso}: ${features.length} -> ${groups.length} regions`);
    }
  }
  
  console.log(`\nTotal regions: ${totalInputRegions} -> ${totalOutputRegions}`);
  
  // Генерируем TypeScript код
  let output = `/**
 * regionMapping.ts — АВТОМАТИЧЕСКИ СГЕНЕРИРОВАННЫЙ МАППИНГ
 * Сгенерирован на основе game_map.json
 * 
 * Каждая запись: { [targetId]: { name, nameEn, ownerCountryId, sources } }
 */

export type RegionMappingEntry = {
  name: string;
  nameEn: string;
  ownerCountryId: string;
  sources: string[];
};

export type CountryMapping = Record<string, RegionMappingEntry>;

`;
  
  for (const [iso, mapping] of Object.entries(allMappings)) {
    const varName = `${iso}_MAPPING`;
    output += `export const ${varName}: CountryMapping = {\n`;
    for (const [key, entry] of Object.entries(mapping as any)) {
      const src = (entry.sources as string[]).map(s => `'${s}'`).join(', ');
      output += `  '${key}': {\n`;
      output += `    name: '${entry.name.replace(/'/g, "\\'")}',\n`;
      output += `    nameEn: '${(entry.nameEn as string).replace(/'/g, "\\'")}',\n`;
      output += `    ownerCountryId: '${entry.ownerCountryId}',\n`;
      output += `    sources: [${src}],\n`;
      output += `  },\n`;
    }
    output += `};\n\n`;
  }
  
  // Index
  output += `export const ALL_MAPPINGS: Record<string, CountryMapping> = {\n`;
  for (const iso of Object.keys(allMappings)) {
    output += `  ${iso}: ${iso}_MAPPING,\n`;
  }
  output += `};\n`;
  
  const outPath = path.join(__dirname, 'regionMapping_auto.ts');
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`\nSaved to ${outPath}`);
}

main();