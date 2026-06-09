import { ResourceType } from "./ResourcesType";

export interface ResourceDeposit {

  type: ResourceType;

  size: number;

  extractionLevel: number;
}