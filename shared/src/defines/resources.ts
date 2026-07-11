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

/**
 * Верхний уровень добывающих мощностей региона на ресурс
 * (docs/plans/04_RESOURCES.md) — extractionFactor(level) = level /
 * MAX_EXTRACTION_LEVEL. Дублируется в scripts/map/fill_region_economy_1946.py
 * (единого источника констант TS↔Python в проекте пока нет, план 05) —
 * держать в синхроне вручную.
 */
export const MAX_EXTRACTION_LEVEL = 10;

/** Казна за +1 уровень добывающих мощностей (server/src/commands/resources.ts::buildExtraction). */
export const EXTRACTION_BUILD_COST = 2_000_000_000;
