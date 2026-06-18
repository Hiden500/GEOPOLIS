import { ResourceType } from "../resources/ResourcesType";

export interface ResearchProject {

  id: string;

  technologyId: string;

  name: string;

  domain: string;

  progress: number;

  requiredProgress: number;

  progressPerMonth: number;

  cost: number;

  requiredTechnologyIds: string[];

  requiredResources:
    Partial<Record<ResourceType, number>>;

  startDate: string;

  estimatedMonths: number;

  completed: boolean;
}