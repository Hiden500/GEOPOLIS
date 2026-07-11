/**
 * Баланс-константы ResourceTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — план не называл их явно (не было именованных констант в файле
 * до этого шага), но файл физически в периметре критерия приёмки
 * (server/src/simulation/**).
 */

/** Бонус от технологии добычи (домен "industry") на единицу уровня. */
export const MINING_TECH_BONUS_RATE = 0.05;

/** Бонус от инфраструктуры региона на единицу infrastructure (0-1). */
export const INFRASTRUCTURE_PRODUCTION_BONUS_RATE = 0.5;

/** Бонус от сектора mining региональной экономики на единицу сектора. */
export const MINING_SECTOR_BONUS_RATE = 0.3;

/** Истощение месторождения — доля запаса в месяц (очень медленное). */
export const RESOURCE_DEPLETION_RATE_PER_MONTH = 0.0001;

/** Не истощать месторождение полностью — минимум доли от исходного объёма. */
export const RESOURCE_DEPLETION_FLOOR_SHARE = 0.1;
