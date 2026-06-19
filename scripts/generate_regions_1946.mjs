import fs from 'fs';
import path from 'path';

// Загрузка данных
const mappingPath = path.join(process.cwd(), 'client/src/assets/regions_mapping_1946.json');
const geoJsonPath = path.join(process.cwd(), 'client/src/assets/world_map_1946.geojson');

const regionMapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
const geoJson = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

console.log('=== ГЕНЕРАЦИЯ REGIONS.JSON ДЛЯ СЦЕНАРИЯ 1946 ===\n');

// Исторические владельцы для 1946 года
// Ключ - ISO код страны, значение - реальный владелец в 1946
const historicalOwners1946 = {
  // Британские колонии
  'IND': 'GBR', // Британская Индия
  'PAK': 'GBR', // Часть Британской Индии
  'BGD': 'GBR', // Восточная Бенгалия
  'MMR': 'GBR', // Бирма
  'MYS': 'GBR', // Малайя
  'LKA': 'GBR', // Цейлон
  'GUY': 'GBR', // Британская Гвиана
  'PNG': 'GBR', // Папуа-Новая Гвинея
  'EGY': 'GBR', // Египет (британский протекторат до 1952)
  'IRQ': 'GBR', // Ирак (британский мандат до 1932, но влияние сохранялось)
  'JOR': 'GBR', // Трансиордания (британский мандат)
  'ISR': 'GBR', // Палестина (британский мандат)
  'KEN': 'GBR', // Кения
  'UGA': 'GBR', // Уганда
  'TZA': 'GBR', // Танганьика
  'ZWE': 'GBR', // Южная Родезия
  'ZMB': 'GBR', // Северная Родезия
  'MLI': 'GBR', // Французский Судан, но под влиянием
  'GMB': 'GBR', // Гамбия
  'SLE': 'GBR', // Сьерра-Леоне
  'GHA': 'GBR', // Золотой Берег
  'NGA': 'GBR', // Нигерия
  'BEN': 'GBR', // Дагомея
  'TGO': 'GBR', // Тоголенд (британская зона)
  'CMR': 'GBR', // Камерун (британская зона)
  'ZAF': 'GBR', // Южно-Африканский Союз (доминион)
  'BWA': 'GBR', // Бечуаналенд
  'LSO': 'GBR', // Басутоленд
  'SWZ': 'GBR', // Свазиленд
  
  // Французские колонии
  'DZA': 'FRA', // Алжир
  'TUN': 'FRA', // Тунис
  'MAR': 'FRA', // Марокко
  'MRT': 'FRA', // Мавритания
  'SEN': 'FRA', // Сенегал
  'GIN': 'FRA', // Гвинея
  'CIV': 'FRA', // Кот-д'Ивуар
  'BFA': 'FRA', // Верхняя Вольта
  'MLI': 'FRA', // Французский Судан
  'NER': 'FRA', // Нигер
  'TCD': 'FRA', // Чад
  'CAF': 'FRA', // Убанги-Шари
  'COG': 'FRA', // Конго
  'GAB': 'FRA', // Габон
  'MDG': 'FRA', // Мадагаскар
  'DJI': 'FRA', // Французский Сомалиленд
  'COM': 'FRA', // Коморы
  'SYC': 'FRA', // Сейшелы
  'VNM': 'FRA', // Французский Индокитай
  'LAO': 'FRA', // Лаос
  'KHM': 'FRA', // Камбоджа
  'LBN': 'FRA', // Ливан (французский мандат)
  'SYR': 'FRA', // Сирия (французский мандат)
  
  // Голландские колонии
  'IDN': 'NLD', // Нидерландская Ост-Индия
  'SUR': 'NLD', // Суринам
  'ABW': 'NLD', // Аруба
  'CUW': 'NLD', // Кюрасао
  
  // Португальские колонии
  'AGO': 'PRT', // Ангола
  'MOZ': 'MOZ', // Мозамбик
  'GNB': 'PRT', // Гвинея-Бисау
  'CPV': 'PRT', // Кабо-Верде
  'STP': 'PRT', // Сан-Томе и Принсипи
  'TLS': 'PRT', // Тимор
  'MAC': 'PRT', // Макао
  
  // Испанские колонии
  'ESH': 'ESP', // Западная Сахара
  'GNQ': 'ESP', // Экваториальная Гвинея
  
  // Бельгийские колонии
  'COD': 'BEL', // Бельгийское Конго
  'RWA': 'BEL', // Руанда-Урунди
  'BDI': 'BEL', // Руанда-Урунди
  
  // Итальянские колонии (освобождены в 1943-1947)
  'LBY': 'GBR', // Ливия под британско-французской администрацией
  'ERI': 'GBR', // Эритрея под британской администрацией
  'SOM': 'GBR', // Сомали под британской администрацией
  
  // Американские колонии
  'PHL': 'USA', // Филиппины (в процессе независимости, но под контролем США)
  'PRI': 'USA', // Пуэрто-Рико
  'VIR': 'USA', // Виргинские острова
  'GUM': 'USA', // Гуам
  
  // Датские колонии
  'GRL': 'DNK', // Гренландия
  
  // Австралийские территории
  'NCL': 'AUS', // Новая Каледония (французская, но под влиянием союзников)
  'FJI': 'GBR', // Фиди (британская колония)
  'PNG': 'AUS', // Папуа-Новая Гвинея (под австралийской администрацией)
  
  // Новозеландские территории
  'NZL': 'GBR', // Новая Зеландия (доминион)
  'COK': 'NZL', // Острова Кука
  'NIU': 'NZL', // Ниуэ
  'TON': 'NZL', // Тонга
  'WSM': 'NZL', // Самоа (под новозеландской администрацией)
  
  // Советские республики (в составе СССР)
  'UKR': 'USSR',
  'BLR': 'USSR',
  'EST': 'USSR',
  'LVA': 'USSR',
  'LTU': 'USSR',
  'MDA': 'USSR',
  'GEO': 'USSR',
  'ARM': 'USSR',
  'AZE': 'USSR',
  'KAZ': 'USSR',
  'UZB': 'USSR',
  'KGZ': 'USSR',
  'TJK': 'USSR',
  'TKM': 'USSR',
  
  // Оккупированные Германии (разделена на 4 зоны)
  'DEU': 'OCCUPIED', // Германия под оккупацией
  
  // Оккупированная Япония
  'JPN': 'USA', // Япония под американской оккупацией
  'KOR': 'USA', // Южная Корея под американской оккупацией
  'PRK': 'USSR', // Северная Корея под советской оккупацией
  'TWN': 'CHN', // Тайвань возвращён Китаю в 1945
  
  // Другие территории
  'HKG': 'GBR', // Гонконг
  'MAC': 'PRT', // Макао
  'GIB': 'GBR', // Гибралтар
  'AND': 'FRA', // Андорра (под совместным протекторатом)
  'MCO': 'FRA', // Монако
  'SMR': 'ITA', // Сан-Марино
  'VAT': 'ITA', // Ватикан
  'LIE': 'CHE', // Лихтенштейн
};

// Генерация regions.json
const regions = [];

for (const [regionId, regionData] of Object.entries(regionMapping)) {
  const countryId = regionData.countryId;
  
  // Определяем исторического владельца
  let ownerId = countryId;
  
  if (historicalOwners1946[countryId]) {
    ownerId = historicalOwners1946[countryId];
  }
  
  // Создаём объект региона
  const region = {
    id: regionId,
    name: regionData.name,
    ownerId: ownerId,
    type: regionData.type,
    neighbours: [], // Будет заполнено позже на основе геометрии
    infrastructure: 50, // Базовое значение
    stability: 50, // Базовое значение
    developmentLevel: 50, // Базовое значение
    population: 0, // Будет заполнено позже
    resources: {} // Будет заполнено позже
  };
  
  regions.push(region);
}

// Добавляем канальные регионы
const canalRegions = [
  {
    id: 'CANAL-SUEZ',
    name: 'Суэцкий канал',
    ownerId: 'EGY',
    type: 'canal',
    neighbours: [],
    infrastructure: 100,
    stability: 50,
    developmentLevel: 80,
    population: 0,
    resources: {},
    attributes: ['naval_chokepoint']
  },
  {
    id: 'CANAL-PANAMA',
    name: 'Панамский канал',
    ownerId: 'PAN',
    type: 'canal',
    neighbours: [],
    infrastructure: 100,
    stability: 50,
    developmentLevel: 80,
    population: 0,
    resources: {},
    attributes: ['naval_chokepoint']
  },
  {
    id: 'CANAL-KIEL',
    name: 'Кильский канал',
    ownerId: 'DEU_UK', // Британская зона оккупации
    type: 'canal',
    neighbours: [],
    infrastructure: 100,
    stability: 50,
    developmentLevel: 80,
    population: 0,
    resources: {},
    attributes: ['naval_chokepoint']
  }
];

regions.push(...canalRegions);

// Добавляем морские регионы
const seaRegions = [
  { id: 'SEA-NORTH_ATLANTIC', name: 'Северная Атлантика', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-SOUTH_ATLANTIC', name: 'Южная Атлантика', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-NORTH_PACIFIC', name: 'Северный Тихий океан', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-SOUTH_PACIFIC', name: 'Южный Тихий океан', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-ARCTIC', name: 'Северный Ледовитый океан', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-INDIAN', name: 'Индийский океан', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-MEDITERRANEAN', name: 'Средиземное море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-BALTIC', name: 'Балтийское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-BLACK', name: 'Чёрное море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-NORTH', name: 'Северное море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-NORWEGIAN', name: 'Норвежское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-CARIBBEAN', name: 'Карибское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-SOUTH_CHINA', name: 'Южно-Китайское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-EAST_CHINA', name: 'Восточно-Китайское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-PHILIPPINE', name: 'Филиппинское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-CORAL', name: 'Коралловое море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-ARABIAN', name: 'Аравийское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-RED', name: 'Красное море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-JAPAN', name: 'Японское море', ownerId: 'NEUTRAL', type: 'sea' },
  { id: 'SEA-BERING', name: 'Берингово море', ownerId: 'NEUTRAL', type: 'sea' }
];

for (const sea of seaRegions) {
  regions.push({
    ...sea,
    neighbours: [],
    infrastructure: 0,
    stability: 100,
    developmentLevel: 0,
    population: 0,
    resources: {}
  });
}

// Сохранение regions.json
const outputPath = path.join(process.cwd(), 'client/src/assets/regions_1946.json');
fs.writeFileSync(outputPath, JSON.stringify(regions, null, 2));

console.log(`Создано ${regions.length} регионов`);
console.log(`Земельных регионов: ${regions.filter(r => r.type === 'land').length}`);
console.log(`Канальных регионов: ${regions.filter(r => r.type === 'canal').length}`);
console.log(`Морских регионов: ${regions.filter(r => r.type === 'sea').length}`);
console.log(`\nregions.json сохранён в: ${outputPath}`);

// Статистика по владельцам
const ownerStats = {};
for (const region of regions) {
  if (!ownerStats[region.ownerId]) {
    ownerStats[region.ownerId] = 0;
  }
  ownerStats[region.ownerId]++;
}

console.log('\n=== СТАТИСТИКА ПО ВЛАДЕЛЬЦАМ ===');
for (const [ownerId, count] of Object.entries(ownerStats).sort((a, b) => b[1] - a[1])) {
  console.log(`${ownerId}: ${count} регионов`);
}

console.log('\n=== ГОТОВО ===');
