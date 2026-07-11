import { type ResourceCategory } from "../data/resources/resourceCatalog";
import { type ResourceType } from "../types/resources/ResourcesType";

/**
 * Баланс-константы TradeTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — Торговля v1 (независимый гейм-дизайн разбор, 2026-07-06). Все
 * числа — тюнингуемые плейсхолдеры.
 */

/** Резерв на душу населения — один на любой вид ресурса, сознательное упрощение v1. */
export const DOMESTIC_RESERVE_PER_CAPITA = 0.01;

/** Доля излишка сверх резерва, реально продаваемая за месяц (сглаживание, не единомоментная распродажа). */
export const EXPORT_RATE = 0.1;

/** Штраф к exportIncome за каждую страну, держащую trade_embargo против этой — капается на 100%. */
export const SANCTION_EXPORT_PENALTY_PER_EMBARGO = 0.2;

/** Мировая цена по категории (shared/src/data/resources/resourceCatalog.ts) — не по 20 ресурсам отдельно. */
export const WORLD_PRICE_BY_CATEGORY: Record<ResourceCategory, number> = {
  energy: 50,
  metal: 80,
  agricultural: 20,
  strategic: 60,
};

/** Явные переопределения для ресурсов заметно ценнее среднего по своей категории. */
export const WORLD_PRICE_OVERRIDES: Partial<Record<ResourceType, number>> = {
  gold: 2000,
  uranium: 500,
};
