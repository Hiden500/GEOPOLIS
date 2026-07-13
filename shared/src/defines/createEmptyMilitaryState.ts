import { type MilitaryState } from "../types/MilitaryState";
import { EquipmentType } from "../types/military/EquipmentType";

/**
 * Placeholder MilitaryState с нулевыми полями и полным (все EquipmentType)
 * нулевым equipment — см. server/src/data/countries/templates/CreateCountry.ts,
 * docs/plans/05_DATA_LAYOUT.md (авторские данные страны без нулевых блоков).
 */
export function createEmptyMilitaryState(): MilitaryState {
  const equipment = Object.fromEntries(
    Object.values(EquipmentType).map((type) => [type, 0])
  ) as MilitaryState["equipment"];

  return {
    manpower: 0,
    activePersonnel: 0,
    reservePersonnel: 0,
    militaryBudget: 0,
    armyStrength: 0,
    navyStrength: 0,
    airStrength: 0,
    nuclearWarheads: 0,
    units: [],
    equipment,
  };
}
