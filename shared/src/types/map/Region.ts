import { ResourceType } from "../resources/ResourcesType";

export interface Region {

  id: number;

  name: string;

  ownerCountryId: string;

  population: number;

  area: number;

  urbanization: number;

  stability: number;

  infrastructure: number;

  development: number;

  resourceProduction: Partial<Record<ResourceType, number>>;

  neighboringRegionIds: number[];
}