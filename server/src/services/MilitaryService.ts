import { type Country } from "@shared/types/Country";
import { type EquipmentType } from "@shared/types/military/EquipmentType";
import { ValidationError } from "../errors/AppError";

/**
 * Сервис распределения фокуса производства техники (War Phase 2, независимый
 * гейм-дизайн разбор, 2026-07-06) — мирор ResearchService.ts. Количество
 * считает MilitaryTick.ts, этот сервис только меняет, куда направлена доля
 * militarySpending.
 */
export class MilitaryService {
  /**
   * Задаёт долю militarySpending для одной категории техники — остальные
   * категории без явной доли делят остаток поровну (см. MilitaryTick.ts).
   */
  setProductionAllocation(country: Country, equipmentType: EquipmentType, share: number): void {
    if (!(equipmentType in country.military.equipment)) {
      throw new ValidationError(`Unknown equipment type: ${equipmentType}`);
    }

    country.military.productionAllocation = {
      ...country.military.productionAllocation,
      [equipmentType]: share,
    };
  }
}
