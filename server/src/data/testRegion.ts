import { type Region } from "@shared/types/map/Region";
import { ResourceType } from "@shared/types/resources/ResourcesType";

export const testRegions: Region[] = [
  // === СССР ===
  {    id: 1,
    geoJsonId: "test-1",
    gdp: 0,
    name: "Baku",
    ownerCountryId: "USSR",
    population: 2200000,
    area: 1000,
    urbanization: 55,
    stability: 80,
    infrastructure: 60,
    development: 50,
    neighboringRegionIds: [2, 4],
    resourceProduction: {
      [ResourceType.Oil]: 250
    }
  },
  {    id: 2,
    geoJsonId: "test-2",
    gdp: 0,
    name: "Donbass",
    ownerCountryId: "USSR",
    population: 4000000,
    area: 1200,
    urbanization: 65,
    stability: 75,
    infrastructure: 70,
    development: 45,
    neighboringRegionIds: [1, 4],
    resourceProduction: {
      [ResourceType.Coal]: 300,
      [ResourceType.Iron]: 150
    }
  },
  {    id: 3,
    geoJsonId: "test-3",
    gdp: 0,
    name: "Kuzbass",
    ownerCountryId: "USSR",
    population: 2500000,
    area: 1500,
    urbanization: 45,
    stability: 75,
    infrastructure: 50,
    development: 40,
    neighboringRegionIds: [5, 6],
    resourceProduction: {
      [ResourceType.Coal]: 200,
      [ResourceType.Iron]: 100
    }
  },
  {    id: 4,
    geoJsonId: "test-4",
    gdp: 0,
    name: "Moscow Region",
    ownerCountryId: "USSR",
    population: 15000000,
    area: 800,
    urbanization: 85,
    stability: 85,
    infrastructure: 90,
    development: 80,
    neighboringRegionIds: [1, 2, 6],
    resourceProduction: {
      [ResourceType.Timber]: 100
    }
  },
  {    id: 5,
    geoJsonId: "test-5",
    gdp: 0,
    name: "Siberia",
    ownerCountryId: "USSR",
    population: 5000000,
    area: 5000,
    urbanization: 25,
    stability: 70,
    infrastructure: 30,
    development: 25,
    neighboringRegionIds: [3, 6],
    resourceProduction: {
      [ResourceType.Gas]: 200,
      [ResourceType.Timber]: 300,
      [ResourceType.Gold]: 50
    }
  },
  {    id: 6,
    geoJsonId: "test-6",
    gdp: 0,
    name: "Urals",
    ownerCountryId: "USSR",
    population: 8000000,
    area: 2000,
    urbanization: 60,
    stability: 80,
    infrastructure: 65,
    development: 55,
    neighboringRegionIds: [3, 4, 5],
    resourceProduction: {
      [ResourceType.Iron]: 250,
      [ResourceType.Copper]: 100,
      [ResourceType.Bauxite]: 80
    }
  },

  // === США ===
  {    id: 7,
    geoJsonId: "test-7",
    gdp: 0,
    name: "Midwest",
    ownerCountryId: "USA",
    population: 18000000,
    area: 3000,
    urbanization: 60,
    stability: 85,
    infrastructure: 80,
    development: 75,
    neighboringRegionIds: [8, 10],
    resourceProduction: {
      [ResourceType.Coal]: 200,
      [ResourceType.Iron]: 150,
      [ResourceType.Food]: 500
    }
  },
  {    id: 8,
    geoJsonId: "test-8",
    gdp: 0,
    name: "East Coast",
    ownerCountryId: "USA",
    population: 35000000,
    area: 1500,
    urbanization: 90,
    stability: 85,
    infrastructure: 95,
    development: 90,
    neighboringRegionIds: [7, 10],
    resourceProduction: {
      [ResourceType.Coal]: 100
    }
  },
  {    id: 9,
    geoJsonId: "test-9",
    gdp: 0,
    name: "West Coast",
    ownerCountryId: "USA",
    population: 15000000,
    area: 2000,
    urbanization: 85,
    stability: 80,
    infrastructure: 85,
    development: 85,
    neighboringRegionIds: [7],
    resourceProduction: {
      [ResourceType.Oil]: 100,
      [ResourceType.Timber]: 200,
      [ResourceType.Gold]: 30
    }
  },
  {    id: 10,
    geoJsonId: "test-10",
    gdp: 0,
    name: "Texas",
    ownerCountryId: "USA",
    population: 10000000,
    area: 2500,
    urbanization: 70,
    stability: 80,
    infrastructure: 75,
    development: 70,
    neighboringRegionIds: [7, 8],
    resourceProduction: {
      [ResourceType.Oil]: 400,
      [ResourceType.Gas]: 300,
      [ResourceType.Coal]: 100
    }
  },
  {    id: 11,
    geoJsonId: "test-11",
    gdp: 0,
    name: "Alaska",
    ownerCountryId: "USA",
    population: 500000,
    area: 4000,
    urbanization: 30,
    stability: 75,
    infrastructure: 20,
    development: 20,
    neighboringRegionIds: [],
    resourceProduction: {
      [ResourceType.Oil]: 150,
      [ResourceType.Gas]: 100,
      [ResourceType.Gold]: 20
    }
  },

  // === Великобритания ===
  {    id: 12,
    geoJsonId: "test-12",
    gdp: 0,
    name: "England",
    ownerCountryId: "UK",
    population: 30000000,
    area: 800,
    urbanization: 90,
    stability: 85,
    infrastructure: 95,
    development: 90,
    neighboringRegionIds: [13],
    resourceProduction: {
      [ResourceType.Coal]: 100,
      [ResourceType.Iron]: 50
    }
  },
  {    id: 13,
    geoJsonId: "test-13",
    gdp: 0,
    name: "Scotland",
    ownerCountryId: "UK",
    population: 5000000,
    area: 600,
    urbanization: 50,
    stability: 80,
    infrastructure: 70,
    development: 65,
    neighboringRegionIds: [12, 14],
    resourceProduction: {
      [ResourceType.Oil]: 200,
      [ResourceType.Timber]: 50
    }
  },
  {    id: 14,
    geoJsonId: "test-14",
    gdp: 0,
    name: "N. Ireland",
    ownerCountryId: "UK",
    population: 1500000,
    area: 200,
    urbanization: 45,
    stability: 60,
    infrastructure: 65,
    development: 55,
    neighboringRegionIds: [13],
    resourceProduction: {
      [ResourceType.Food]: 50
    }
  },

  // === ГЕРМАНИЯ - ЗОНЫ ОККУПАЦИИ 1946 ===
  // Советская зона (USSR)
  {    id: 15,
    geoJsonId: "test-15",
    gdp: 0,
    name: "Sachsen",
    ownerCountryId: "USSR",
    population: 5000000,
    area: 300,
    urbanization: 60,
    stability: 50,
    infrastructure: 55,
    development: 45,
    neighboringRegionIds: [16, 17, 18],
    resourceProduction: {
      [ResourceType.Coal]: 150,
      [ResourceType.Iron]: 80
    }
  },
  {    id: 16,
    geoJsonId: "test-16",
    gdp: 0,
    name: "Brandenburg",
    ownerCountryId: "USSR",
    population: 2500000,
    area: 400,
    urbanization: 50,
    stability: 45,
    infrastructure: 50,
    development: 40,
    neighboringRegionIds: [15, 17, 19],
    resourceProduction: {
      [ResourceType.Food]: 100,
      [ResourceType.Timber]: 50
    }
  },
  {    id: 17,
    geoJsonId: "test-17",
    gdp: 0,
    name: "Berlin",
    ownerCountryId: "USSR",
    population: 3500000,
    area: 50,
    urbanization: 95,
    stability: 40,
    infrastructure: 70,
    development: 50,
    neighboringRegionIds: [15, 16, 18, 19, 20, 21, 22],
    resourceProduction: {
      [ResourceType.Food]: 10
    }
  },
  {    id: 18,
    geoJsonId: "test-18",
    gdp: 0,
    name: "Thüringen",
    ownerCountryId: "USSR",
    population: 2000000,
    area: 250,
    urbanization: 55,
    stability: 50,
    infrastructure: 50,
    development: 40,
    neighboringRegionIds: [15, 16, 19],
    resourceProduction: {
      [ResourceType.Coal]: 80,
      [ResourceType.Iron]: 40
    }
  },
  {    id: 19,
    geoJsonId: "test-19",
    gdp: 0,
    name: "Mecklenburg-Vorpommern",
    ownerCountryId: "USSR",
    population: 1500000,
    area: 350,
    urbanization: 35,
    stability: 45,
    infrastructure: 40,
    development: 35,
    neighboringRegionIds: [16, 18],
    resourceProduction: {
      [ResourceType.Food]: 80,
      [ResourceType.Timber]: 60
    }
  },

  // Американская зона (USA)
  {    id: 20,
    geoJsonId: "test-20",
    gdp: 0,
    name: "Bayern",
    ownerCountryId: "USA",
    population: 7000000,
    area: 500,
    urbanization: 55,
    stability: 55,
    infrastructure: 60,
    development: 50,
    neighboringRegionIds: [17, 21, 22],
    resourceProduction: {
      [ResourceType.Food]: 200,
      [ResourceType.Timber]: 80
    }
  },
  {    id: 21,
    geoJsonId: "test-21",
    gdp: 0,
    name: "Hessen",
    ownerCountryId: "USA",
    population: 4000000,
    area: 200,
    urbanization: 70,
    stability: 60,
    infrastructure: 70,
    development: 60,
    neighboringRegionIds: [17, 20, 22, 23],
    resourceProduction: {
      [ResourceType.Coal]: 100,
      [ResourceType.Iron]: 50
    }
  },
  {    id: 22,
    geoJsonId: "test-22",
    gdp: 0,
    name: "Baden-Württemberg",
    ownerCountryId: "USA",
    population: 5000000,
    area: 350,
    urbanization: 60,
    stability: 55,
    infrastructure: 65,
    development: 55,
    neighboringRegionIds: [17, 20, 21, 24],
    resourceProduction: {
      [ResourceType.Timber]: 100,
      [ResourceType.Iron]: 60
    }
  },

  // Британская зона (UK)
  {    id: 23,
    geoJsonId: "test-23",
    gdp: 0,
    name: "Niedersachsen",
    ownerCountryId: "UK",
    population: 6000000,
    area: 450,
    urbanization: 50,
    stability: 55,
    infrastructure: 55,
    development: 45,
    neighboringRegionIds: [21, 24, 25],
    resourceProduction: {
      [ResourceType.Food]: 150,
      [ResourceType.Coal]: 120
    }
  },
  {    id: 24,
    geoJsonId: "test-24",
    gdp: 0,
    name: "Nordrhein-Westfalen",
    ownerCountryId: "UK",
    population: 8000000,
    area: 300,
    urbanization: 75,
    stability: 50,
    infrastructure: 60,
    development: 55,
    neighboringRegionIds: [22, 23, 25],
    resourceProduction: {
      [ResourceType.Coal]: 300,
      [ResourceType.Iron]: 150,
      [ResourceType.Copper]: 200
    }
  },
  {    id: 25,
    geoJsonId: "test-25",
    gdp: 0,
    name: "Schleswig-Holstein",
    ownerCountryId: "UK",
    population: 2500000,
    area: 200,
    urbanization: 55,
    stability: 55,
    infrastructure: 55,
    development: 45,
    neighboringRegionIds: [23, 24],
    resourceProduction: {
      [ResourceType.Food]: 100
    }
  },

  // Французская зона (France)
  {    id: 26,
    geoJsonId: "test-26",
    gdp: 0,
    name: "Rheinland-Pfalz",
    ownerCountryId: "FRA",
    population: 3500000,
    area: 250,
    urbanization: 55,
    stability: 50,
    infrastructure: 50,
    development: 45,
    neighboringRegionIds: [22, 27],
    resourceProduction: {
      [ResourceType.Food]: 80,
      [ResourceType.Timber]: 40
    }
  },
  {    id: 27,
    geoJsonId: "test-27",
    gdp: 0,
    name: "Saarland",
    ownerCountryId: "FRA",
    population: 1000000,
    area: 100,
    urbanization: 70,
    stability: 55,
    infrastructure: 60,
    development: 55,
    neighboringRegionIds: [26],
    resourceProduction: {
      [ResourceType.Coal]: 200
    }
  },

  // === КИТАЙ - ГРАЖДАНСКАЯ ВОЙНА 1946 ===
  // Коммунисты (КПК/China) - Маньчжурия и Северный Китай
  {    id: 28,
    geoJsonId: "test-28",
    gdp: 0,
    name: "Heilongjiang",
    ownerCountryId: "China",
    population: 3000000,
    area: 800,
    urbanization: 30,
    stability: 55,
    infrastructure: 35,
    development: 30,
    neighboringRegionIds: [29, 30],
    resourceProduction: {
      [ResourceType.Iron]: 100,
      [ResourceType.Coal]: 150,
      [ResourceType.Timber]: 200
    }
  },
  {    id: 29,
    geoJsonId: "test-29",
    gdp: 0,
    name: "Jilin",
    ownerCountryId: "China",
    population: 4000000,
    area: 600,
    urbanization: 40,
    stability: 55,
    infrastructure: 40,
    development: 35,
    neighboringRegionIds: [28, 30, 31],
    resourceProduction: {
      [ResourceType.Iron]: 120,
      [ResourceType.Coal]: 100
    }
  },
  {    id: 30,
    geoJsonId: "test-30",
    gdp: 0,
    name: "Liaoning",
    ownerCountryId: "China",
    population: 8000000,
    area: 500,
    urbanization: 55,
    stability: 50,
    infrastructure: 55,
    development: 50,
    neighboringRegionIds: [28, 29, 31, 32],
    resourceProduction: {
      [ResourceType.Iron]: 200,
      [ResourceType.Coal]: 200,
      [ResourceType.Oil]: 50
    }
  },
  {    id: 31,
    geoJsonId: "test-31",
    gdp: 0,
    name: "Hebei",
    ownerCountryId: "China",
    population: 6000000,
    area: 400,
    urbanization: 35,
    stability: 45,
    infrastructure: 40,
    development: 35,
    neighboringRegionIds: [29, 30, 32, 33],
    resourceProduction: {
      [ResourceType.Coal]: 150,
      [ResourceType.Iron]: 80
    }
  },
  {    id: 32,
    geoJsonId: "test-32",
    gdp: 0,
    name: "Shanxi",
    ownerCountryId: "China",
    population: 4000000,
    area: 450,
    urbanization: 30,
    stability: 45,
    infrastructure: 35,
    development: 30,
    neighboringRegionIds: [30, 31, 33, 34],
    resourceProduction: {
      [ResourceType.Coal]: 300,
      [ResourceType.Iron]: 100
    }
  },
  {    id: 33,
    geoJsonId: "test-33",
    gdp: 0,
    name: "Shaanxi",
    ownerCountryId: "China",
    population: 5000000,
    area: 500,
    urbanization: 25,
    stability: 60,
    infrastructure: 30,
    development: 25,
    neighboringRegionIds: [31, 32, 34],
    resourceProduction: {
      [ResourceType.Coal]: 100,
      [ResourceType.Oil]: 30
    }
  },
  {    id: 34,
    geoJsonId: "test-34",
    gdp: 0,
    name: "Inner Mongolia",
    ownerCountryId: "China",
    population: 2000000,
    area: 1000,
    urbanization: 20,
    stability: 50,
    infrastructure: 25,
    development: 20,
    neighboringRegionIds: [32, 33],
    resourceProduction: {
      [ResourceType.Coal]: 80,
      [ResourceType.Timber]: 100,
      [ResourceType.RareEarths]: 30
    }
  },

  // Националисты (Гоминьдан/Taiwan) - Центральный, Южный, Восточный Китай
  {    id: 35,
    geoJsonId: "test-35",
    gdp: 0,
    name: "Jiangsu",
    ownerCountryId: "Taiwan",
    population: 8000000,
    area: 400,
    urbanization: 45,
    stability: 40,
    infrastructure: 50,
    development: 45,
    neighboringRegionIds: [36, 37, 38],
    resourceProduction: {
      [ResourceType.Food]: 300
    }
  },
  {    id: 36,
    geoJsonId: "test-36",
    gdp: 0,
    name: "Zhejiang",
    ownerCountryId: "Taiwan",
    population: 5000000,
    area: 350,
    urbanization: 40,
    stability: 40,
    infrastructure: 45,
    development: 40,
    neighboringRegionIds: [35, 37],
    resourceProduction: {
      [ResourceType.Food]: 150,
      [ResourceType.Timber]: 80
    }
  },
  {    id: 37,
    geoJsonId: "test-37",
    gdp: 0,
    name: "Shanghai",
    ownerCountryId: "Taiwan",
    population: 6000000,
    area: 50,
    urbanization: 90,
    stability: 35,
    infrastructure: 85,
    development: 80,
    neighboringRegionIds: [35, 36, 38],
    resourceProduction: {
      [ResourceType.Food]: 20
    }
  },
  {    id: 38,
    geoJsonId: "test-38",
    gdp: 0,
    name: "Hubei",
    ownerCountryId: "Taiwan",
    population: 7000000,
    area: 450,
    urbanization: 35,
    stability: 35,
    infrastructure: 40,
    development: 35,
    neighboringRegionIds: [35, 37, 39, 40],
    resourceProduction: {
      [ResourceType.Food]: 180,
      [ResourceType.Iron]: 60
    }
  },
  {    id: 39,
    geoJsonId: "test-39",
    gdp: 0,
    name: "Hunan",
    ownerCountryId: "Taiwan",
    population: 6000000,
    area: 500,
    urbanization: 30,
    stability: 35,
    infrastructure: 35,
    development: 30,
    neighboringRegionIds: [38, 40, 41],
    resourceProduction: {
      [ResourceType.Food]: 200,
      [ResourceType.Timber]: 100
    }
  },
  {    id: 40,
    geoJsonId: "test-40",
    gdp: 0,
    name: "Guangdong",
    ownerCountryId: "Taiwan",
    population: 8000000,
    area: 450,
    urbanization: 40,
    stability: 30,
    infrastructure: 45,
    development: 40,
    neighboringRegionIds: [38, 39, 41, 42],
    resourceProduction: {
      [ResourceType.Food]: 250,
      [ResourceType.RareEarths]: 50
    }
  },
  {    id: 41,
    geoJsonId: "test-41",
    gdp: 0,
    name: "Sichuan",
    ownerCountryId: "Taiwan",
    population: 10000000,
    area: 800,
    urbanization: 25,
    stability: 35,
    infrastructure: 30,
    development: 25,
    neighboringRegionIds: [39, 40],
    resourceProduction: {
      [ResourceType.Food]: 300,
      [ResourceType.Iron]: 80,
      [ResourceType.Gas]: 50
    }
  },
  {    id: 42,
    geoJsonId: "test-42",
    gdp: 0,
    name: "Taiwan",
    ownerCountryId: "Taiwan",
    population: 6000000,
    area: 200,
    urbanization: 45,
    stability: 55,
    infrastructure: 50,
    development: 45,
    neighboringRegionIds: [40],
    resourceProduction: {
      [ResourceType.Food]: 100,
      [ResourceType.Timber]: 60,
      [ResourceType.RareEarths]: 40
    }
  }
];