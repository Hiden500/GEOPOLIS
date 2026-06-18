import { ResourceType } from "../resources/ResourcesType";

export interface Region {

  id: number;

  geoJsonId: string;

  name: string;

  ownerCountryId: string;

  population: number;

  area: number;

  urbanization: number;

  stability: number;

  infrastructure: number;

  development: number;

  gdp: number;

  resourceProduction: Partial<Record<ResourceType, number>>;

  neighboringRegionIds: number[];

  sourceAdm1Codes?: string[];
}