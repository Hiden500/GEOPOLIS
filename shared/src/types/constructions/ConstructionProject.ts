import { ConstructionType }
from "./ConstructionType";

export interface ConstructionProject {

  id: string;

  regionId: number;

  type: ConstructionType;

  progress: number;

  requiredProgress: number;

  cost: number;
}