import fs from 'fs';
import path from 'path';

interface Region {
  id: string;
  name: string;
  name_en: string;
  ownerCountryId: string;
  countryIso: string;
  macroRegion: string;
  kind: 'land' | 'marine' | 'canal' | 'special';
  areaSqKm?: number;
  centroid?: [number, number];
  neighbours?: string[];
  historicalYear: number;
  specialStatus?: string;
  sourceAdm1Codes?: string[];
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: any[];
}

// Загрузка JSON
function loadJson(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// Валидация regions.json
function validateRegionsJson(regions: Region[]): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('Валидация regions.json...');

  // Проверка 1: Дубликаты ID
  const ids = new Set<string>();
  for (const region of regions) {
    if (ids.has(region.id)) {
      errors.push(`Дубликат ID: ${region.id}`);
    }
    ids.add(region.id);
  }

  // Проверка 2: Обязательные поля
  for (const region of regions) {
    if (!region.id) errors.push(`Регион без ID: ${region.name}`);
    if (!region.name) errors.push(`Регион ${region.id} без name`);
    if (!region.name_en) errors.push(`Регион ${region.id} без name_en`);
    if (!region.ownerCountryId) errors.push(`Регион ${region.id} без ownerCountryId`);
    if (!region.kind) errors.push(`Регион ${region.id} без kind`);
    if (!region.historicalYear) errors.push(`Регион ${region.id} без historicalYear`);
  }

  // Проверка 3: Корректность kind
  const validKinds = ['land', 'marine', 'canal', 'special'];
  for (const region of regions) {
    if (!validKinds.includes(region.kind)) {
      errors.push(`Регион ${region.id} имеет некорректный kind: ${region.kind}`);
    }
  }

  // Проверка 4: Корректность исторического года
  for (const region of regions) {
    if (region.historicalYear !== 1946) {
      warnings.push(`Регион ${region.id} имеет исторический год ${region.historicalYear}, ожидается 1946`);
    }
  }

  // Проверка 5: Корректность соседей
  for (const region of regions) {
    if (region.neighbours) {
      for (const neighbourId of region.neighbours) {
        if (!ids.has(neighbourId)) {
          errors.push(`Регион ${region.id} ссылается на несуществующего соседа: ${neighbourId}`);
        }
      }
    }
  }

  // Проверка 6: Сухопутные регионы должны иметь площадь
  for (const region of regions) {
    if (region.kind === 'land' && !region.areaSqKm) {
      warnings.push(`Сухопутный регион ${region.id} без площади`);
    }
  }

  // Проверка 7: Сухопутные регионы должны иметь центроид
  for (const region of regions) {
    if (region.kind === 'land' && !region.centroid) {
      warnings.push(`Сухопутный регион ${region.id} без центроида`);
    }
  }

  // Проверка 8: Морские регионы не должны иметь владельца (кроме NONE)
  for (const region of regions) {
    if (region.kind === 'marine' && region.ownerCountryId !== 'NONE') {
      warnings.push(`Морской регион ${region.id} имеет владельца: ${region.ownerCountryId}`);
    }
  }

  // Проверка 9: Специальные статусы
  const validSpecialStatuses = ['berlin_sector', 'canal', 'marine'];
  for (const region of regions) {
    if (region.specialStatus && !validSpecialStatuses.includes(region.specialStatus)) {
      warnings.push(`Регион ${region.id} имеет неизвестный specialStatus: ${region.specialStatus}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Валидация GeoJSON
function validateGeoJSON(geojson: FeatureCollection): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('Валидация GeoJSON...');

  // Проверка 1: Структура
  if (geojson.type !== 'FeatureCollection') {
    errors.push('GeoJSON не является FeatureCollection');
  }

  if (!Array.isArray(geojson.features)) {
    errors.push('GeoJSON не содержит массив features');
  }

  // Проверка 2: Фичи
  const ids = new Set<string>();
  for (const feature of geojson.features) {
    if (!feature.type || feature.type !== 'Feature') {
      errors.push('Фича не является Feature');
    }

    if (!feature.geometry) {
      errors.push('Фича без geometry');
    }

    if (!feature.properties) {
      errors.push('Фича без properties');
    }

    // Проверка ID
    const id = feature.properties?.id || feature.id;
    if (!id) {
      errors.push('Фича без ID');
    } else {
      if (ids.has(id)) {
        errors.push(`Дубликат ID в GeoJSON: ${id}`);
      }
      ids.add(id);
    }

    // Проверка обязательных свойств
    if (!feature.properties?.name) errors.push(`Фича ${id} без name`);
    if (!feature.properties?.ownerCountryId) errors.push(`Фича ${id} без ownerCountryId`);
    if (!feature.properties?.kind) errors.push(`Фича ${id} без kind`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Проверка соответствия между GeoJSON и regions.json
function validateConsistency(geojson: FeatureCollection, regions: Region[]): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log('Проверка соответствия GeoJSON и regions.json...');

  const geojsonIds = new Set(geojson.features.map(f => f.properties?.id || f.id));
  const regionIds = new Set(regions.map(r => r.id));

  // Проверка 1: Все регионы из GeoJSON есть в regions.json
  for (const id of geojsonIds) {
    if (!regionIds.has(id)) {
      errors.push(`ID в GeoJSON отсутствует в regions.json: ${id}`);
    }
  }

  // Проверка 2: Все регионы из regions.json есть в GeoJSON
  for (const id of regionIds) {
    if (!geojsonIds.has(id)) {
      errors.push(`ID в regions.json отсутствует в GeoJSON: ${id}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Главная функция
function main() {
  const geojsonPath = path.join(process.cwd(), 'client/public/world-map-1946.geojson');
  const regionsPath = path.join(process.cwd(), 'client/public/regions-1946.json');

  console.log('Загрузка данных...');
  const geojson = loadJson(geojsonPath);
  const regions = loadJson(regionsPath);

  console.log(`\nЗагружено:`);
  console.log(`- GeoJSON фич: ${geojson.features.length}`);
  console.log(`- Регионов: ${regions.length}`);

  console.log('\n' + '='.repeat(50));

  // Валидация GeoJSON
  const geojsonValidation = validateGeoJSON(geojson);
  console.log(`\nGeoJSON валидация: ${geojsonValidation.valid ? 'УСПЕХ' : 'ОШИБКА'}`);
  if (geojsonValidation.errors.length > 0) {
    console.log('Ошибки:');
    geojsonValidation.errors.forEach(e => console.log(`  - ${e}`));
  }
  if (geojsonValidation.warnings.length > 0) {
    console.log('Предупреждения:');
    geojsonValidation.warnings.forEach(w => console.log(`  - ${w}`));
  }

  console.log('\n' + '='.repeat(50));

  // Валидация regions.json
  const regionsValidation = validateRegionsJson(regions);
  console.log(`\nregions.json валидация: ${regionsValidation.valid ? 'УСПЕХ' : 'ОШИБКА'}`);
  if (regionsValidation.errors.length > 0) {
    console.log('Ошибки:');
    regionsValidation.errors.forEach(e => console.log(`  - ${e}`));
  }
  if (regionsValidation.warnings.length > 0) {
    console.log('Предупреждения:');
    regionsValidation.warnings.forEach(w => console.log(`  - ${w}`));
  }

  console.log('\n' + '='.repeat(50));

  // Проверка соответствия
  const consistencyValidation = validateConsistency(geojson, regions);
  console.log(`\nСоответствие GeoJSON и regions.json: ${consistencyValidation.valid ? 'УСПЕХ' : 'ОШИБКА'}`);
  if (consistencyValidation.errors.length > 0) {
    console.log('Ошибки:');
    consistencyValidation.errors.forEach(e => console.log(`  - ${e}`));
  }
  if (consistencyValidation.warnings.length > 0) {
    console.log('Предупреждения:');
    consistencyValidation.warnings.forEach(w => console.log(`  - ${w}`));
  }

  console.log('\n' + '='.repeat(50));

  // Итог
  const totalErrors = geojsonValidation.errors.length + regionsValidation.errors.length + consistencyValidation.errors.length;
  const totalWarnings = geojsonValidation.warnings.length + regionsValidation.warnings.length + consistencyValidation.warnings.length;

  console.log(`\nИТОГО:`);
  console.log(`Ошибок: ${totalErrors}`);
  console.log(`Предупреждений: ${totalWarnings}`);
  console.log(`Статус: ${totalErrors === 0 ? 'УСПЕХ' : 'ОШИБКА'}`);

  if (totalErrors === 0) {
    console.log('\n✓ Валидация пройдена успешно!');
  } else {
    console.log('\n✗ Валидация не пройдена. Исправьте ошибки.');
  }
}

main();
