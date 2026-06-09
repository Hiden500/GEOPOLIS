import { UnitType } from "./UnitType";

export interface Unit {

  id: string;

  name: string;

  type: UnitType;

  strength: number;

  experience: number;

  regionId: number;
}