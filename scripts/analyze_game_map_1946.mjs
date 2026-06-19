import fs from 'fs';
import path from 'path';

// Загрузка GeoJSON
const geoJsonPath = path.join(process.cwd(), 'client/src/assets/game_map.json');
const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

console.log('=== АНАЛИЗ GAME_MAP.JSON ДЛЯ СЦЕНАРИЯ 1946 ===\n');

// Структура для статистики по странам
const countryStats = {};

// Функция для вычисления площади полигона (упрощённая)
function calculateArea(geometry) {
  if (!geometry) return 0;
  
  let totalArea = 0;
  
  const processCoordinates = (coords) => {
    if (geometry.type === 'Polygon') {
      const ring = coords[0];
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        area += ring[i][0] * ring[j][1];
        area -= ring[j][0] * ring[i][1];
      }
      totalArea += Math.abs(area / 2);
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of coords) {
        const ring = polygon[0];
        let area = 0;
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length;
          area += ring[i][0] * ring[j][1];
          area -= ring[j][0] * ring[i][1];
        }
        totalArea += Math.abs(area / 2);
      }
    }
  };
  
  if (geometry.type === 'Polygon') {
    processCoordinates(geometry.coordinates);
  } else if (geometry.type === 'MultiPolygon') {
    processCoordinates(geometry.coordinates);
  }
  
  // Конвертация из квадратных градусов в примерные км² (очень грубая оценка)
  return totalArea * 12300; // Примерный коэффициент
}

// Анализ каждого региона
for (const feature of geoJson.features) {
  const props = feature.properties || {};
  const isoA3 = props.adm0_a3 || 'UNKNOWN';
  const name = props.name || 'Unknown';
  const id = props.adm1_code || `${isoA3}-${Math.random().toString(36).substr(2, 9)}`;
  const areaSqKm = props.area_sqkm || 0;
  const scalerank = props.scalerank || 5;
  
  if (!countryStats[isoA3]) {
    countryStats[isoA3] = {
      isoA3,
      name: props.adm0name || name,
      regionCount: 0,
      totalAreaSqKm: 0,
      regions: []
    };
  }
  
  // Используем area_sqkm из свойств, если есть, иначе вычисляем
  const regionArea = areaSqKm > 0 ? areaSqKm : calculateArea(feature.geometry);
  
  countryStats[isoA3].regionCount++;
  countryStats[isoA3].totalAreaSqKm += regionArea;
  countryStats[isoA3].regions.push({
    id,
    name,
    areaSqKm: regionArea,
    scalerank
  });
}

// Сортировка стран по количеству регионов
const sortedCountries = Object.values(countryStats).sort((a, b) => b.regionCount - a.regionCount);

console.log(`Всего стран: ${sortedCountries.length}`);
console.log(`Всего регионов: ${geoJson.features.length}\n`);

console.log('=== СТАТИСТИКА ПО СТРАНАМ ===\n');
console.log('ISO | Регионы | Площадь (км²) | Название');
console.log('----|---------|---------------|-----------');

for (const country of sortedCountries) {
  const iso = country.isoA3.padEnd(4);
  const count = String(country.regionCount).padStart(7);
  const area = String(Math.round(country.totalAreaSqKm)).padStart(13);
  const name = country.name;
  console.log(`${iso} | ${count} | ${area} | ${name}`);
}

console.log('\n=== АНОМАЛИИ (более 100 регионов при площади < 100,000 км²) ===\n');
for (const country of sortedCountries) {
  if (country.regionCount > 100 && country.totalAreaSqKm < 100000) {
    console.log(`${country.isoA3}: ${country.regionCount} регионов, ${Math.round(country.totalAreaSqKm)} км² - ${country.name}`);
  }
}

console.log('\n=== КРУПНЫЕ СТРАНЫ (более 1,000,000 км²) ===\n');
for (const country of sortedCountries) {
  if (country.totalAreaSqKm > 1000000) {
    console.log(`${country.isoA3}: ${country.regionCount} регионов, ${Math.round(country.totalAreaSqKm)} км² - ${country.name}`);
  }
}

console.log('\n=== СРЕДНИЕ СТРАНЫ (250,000–1,000,000 км²) ===\n');
for (const country of sortedCountries) {
  if (country.totalAreaSqKm >= 250000 && country.totalAreaSqKm <= 1000000) {
    console.log(`${country.isoA3}: ${country.regionCount} регионов, ${Math.round(country.totalAreaSqKm)} км² - ${country.name}`);
  }
}

console.log('\n=== МАЛЫЕ СТРАНЫ (< 100,000 км²) ===\n');
for (const country of sortedCountries) {
  if (country.totalAreaSqKm < 100000) {
    console.log(`${country.isoA3}: ${country.regionCount} регионов, ${Math.round(country.totalAreaSqKm)} км² - ${country.name}`);
  }
}

// Сохранение детальной статистики в JSON
const outputPath = path.join(process.cwd(), 'scripts', 'game_map_analysis_1946.json');
fs.writeFileSync(outputPath, JSON.stringify(countryStats, null, 2));
console.log(`\nДетальная статистика сохранена в: ${outputPath}`);
