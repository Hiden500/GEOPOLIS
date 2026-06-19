/**
 * generate_neighbor_graph.js - Генерация графа соседей из GeoJSON
 * 
 * Использует turf.js для определения смежности полигонов
 * Создаёт граф соседей для каждой страны
 * 
 * Запуск: node scripts/generate_neighbor_graph.js
 */

const fs = require('fs');
const path = require('path');

// Проверяем наличие turf.js, если нет - устанавливаем
let turf;
try {
  turf = require('@turf/turf');
} catch (e) {
  console.log('turf.js не установлен. Устанавливаем...');
  const { execSync } = require('child_process');
  execSync('npm install @turf/turf', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  turf = require('@turf/turf');
}

const GAME_MAP_PATH = path.join(__dirname, '../client/src/assets/game_map.json');
const OUTPUT_PATH = path.join(__dirname, 'neighbor_graph_1946.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function generateNeighborGraph(features) {
  console.log('Генерация графа соседей...');
  
  // Группируем по странам
  const byCountry = new Map();
  for (const f of features) {
    const country = f.properties?.adm0_a3;
    if (!country) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(f);
  }
  
  const neighborGraph = {};
  
  // Для каждой страны строим граф соседей
  for (const [country, countryFeatures] of byCountry) {
    console.log(`Обработка ${country}: ${countryFeatures.length} регионов`);
    
    const graph = {};
    
    // Для каждого региона находим соседей
    for (let i = 0; i < countryFeatures.length; i++) {
      const f1 = countryFeatures[i];
      const id1 = f1.properties?.adm1_code || f1.properties?.iso_3166_2 || `${country}-${i}`;
      
      if (!f1.geometry) continue;
      
      const neighbors = [];
      
      // Создаём buffer для поиска соседей (малый радиус для определения смежности)
      const buffered = turf.buffer(f1, 0.1, { units: 'degrees' });
      
      // Проверяем все другие регионы этой страны
      for (let j = 0; j < countryFeatures.length; j++) {
        if (i === j) continue;
        
        const f2 = countryFeatures[j];
        const id2 = f2.properties?.adm1_code || f2.properties?.iso_3166_2 || `${country}-${j}`;
        
        if (!f2.geometry) continue;
        
        try {
          // Проверяем пересечение с buffer через booleanIntersects
          const intersects = turf.booleanIntersects(buffered, f2);
          
          if (intersects) {
            // Если есть пересечение с buffer - они смежные
            neighbors.push(id2);
          }
        } catch (e) {
          // Игнорируем ошибки пересечения
        }
      }
      
      if (neighbors.length > 0) {
        graph[id1] = neighbors;
      }
    }
    
    neighborGraph[country] = graph;
    console.log(`${country}: ${Object.keys(graph).length} регионов с соседями`);
  }
  
  return neighborGraph;
}

function main() {
  console.log('=== Генерация графа соседей ===\n');
  
  const geojson = loadJson(GAME_MAP_PATH);
  console.log(`Загружено ${geojson.features.length} фич\n`);
  
  const neighborGraph = generateNeighborGraph(geojson.features);
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(neighborGraph, null, 2));
  console.log(`\nГраф соседей сохранён в ${OUTPUT_PATH}`);
  
  // Статистика
  let totalRegions = 0;
  let totalEdges = 0;
  for (const [country, graph] of Object.entries(neighborGraph)) {
    totalRegions += Object.keys(graph).length;
    totalEdges += Object.values(graph).reduce((sum, neighbors) => sum + neighbors.length, 0);
  }
  
  console.log(`\nСтатистика:`);
  console.log(`- Стран: ${Object.keys(neighborGraph).length}`);
  console.log(`- Регионов с соседями: ${totalRegions}`);
  console.log(`- Рёбер в графе: ${totalEdges}`);
}

main();
