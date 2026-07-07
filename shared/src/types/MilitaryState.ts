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

  // Распределение фокуса производства техники по категориям (War Phase 2,
  // независимый гейм-дизайн разбор, 2026-07-06) — мирор
  // TechnologyState.researchAllocation. Категории без явной доли делят
  // остаток поровну (см. MilitaryTick.ts).
  productionAllocation?: Partial<Record<EquipmentType, number>>;
}