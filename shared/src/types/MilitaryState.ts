import { type Unit } from "./military/Unit";
import { EquipmentType } from "./military/EquipmentType";

export interface MilitaryState {

  manpower: number;

  activePersonnel: number;

  reservePersonnel: number;

  militaryBudget : number;

  armyStrength: number;

  navyStrength: number;

  airStrength: number;

  nuclearWarheads: number;

  units: Unit[];

  equipment: 
    Record<EquipmentType, number>;
}