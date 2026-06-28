import { ResourceType } from "../resources/ResourcesType";
import { type LocalizedText } from "../i18n/LocalizedText";

export interface Region {

  id: number;

  geoJsonId: string;

  names: LocalizedText;

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

  economy?: {
    agriculture: number;
    industry: number;
    mining: number;
    services: number;
  };
}