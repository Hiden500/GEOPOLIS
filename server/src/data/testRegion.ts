import { type Region } from "@shared/types/map/Region";
import { ResourceType } from "@shared/types/resources/ResourcesType";

export const testRegions: Region[] = [

  {
    id: 1,
    name: "Baku",
    ownerCountryId: "USSR",
    population: 2200000,
    area: 1000,
    urbanization: 0,
    infrastructure: 0,
    neighboringRegionIds: [2, 3],

    resourceProduction: {
      [ResourceType.Oil]: 250
    }
  },

  {
    id: 2,
    name: "Donbass",
    ownerCountryId: "USSR",
    population: 4000000,
    area: 1000,
    urbanization: 0,
    infrastructure: 0,
    neighboringRegionIds: [1],

    resourceProduction: {
      [ResourceType.Coal]: 300
    }
  },

  {
    id: 3,
    name: "Kuzbass",
    ownerCountryId: "USSR",
    population: 2500000,
    area: 1000,
    urbanization: 0,
    infrastructure: 0,
    neighboringRegionIds: [1],

    resourceProduction: {
      [ResourceType.Coal]: 200
    }
  }
];