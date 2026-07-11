import { type Region } from "../types/map/Region";

/**
 * Кто сейчас фактически контролирует регион (docs/plans/08_WAR_WAVE1.md,
 * Шаг 1) — оккупант, если регион оккупирован, иначе легальный владелец.
 * Единая точка чтения для всего, что должно реагировать на оккупацию
 * (фронт войны, редирект добычи) — в отличие от ownerCountryId, который
 * остаётся источником истины о легальном владении (дипломатия/соседство/
 * рендер карты/агрегация ВВП и населения страны не меняются оккупацией).
 */
export function effectiveController(region: Region): string {
  return region.occupiedBy ?? region.ownerCountryId;
}
