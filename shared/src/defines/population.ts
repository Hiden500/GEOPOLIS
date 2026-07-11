/**
 * Баланс-константы PopulationTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — план не называл их явно, но файл физически в периметре критерия
 * приёмки (server/src/simulation/**).
 */

export const BASE_BIRTH_RATE_PER_MONTH = 0.01;
export const BASE_DEATH_RATE_PER_MONTH = 0.005;

/** Потолок standardOfLiving (относительно GDP_PER_CAPITA_REFERENCE, см. countryMetrics.ts) — вдвое богаче ориентира не даёт больше бонуса. */
export const STANDARD_OF_LIVING_CAP = 2;

/** Бонус медицины (домен "biology") на единицу уровня технологии — снижает смертность. */
export const MEDICINE_TECH_BONUS_RATE = 0.1;

// --- множители формулы рождаемости региона ---
export const BIRTH_RATE_LIVING_STANDARD_BASE = 0.5;
export const BIRTH_RATE_LIVING_STANDARD_COEFFICIENT = 0.3;
export const BIRTH_RATE_EDUCATION_BASE = 0.8;
export const BIRTH_RATE_EDUCATION_COEFFICIENT = 2;
export const BIRTH_RATE_WELFARE_BASE = 0.9;
export const BIRTH_RATE_WELFARE_COEFFICIENT = 2;
export const BIRTH_RATE_STABILITY_BASE = 0.8;
export const BIRTH_RATE_STABILITY_COEFFICIENT = 0.4;

// --- знаменатель формулы смертности региона ---
export const DEATH_RATE_STABILITY_BASE = 0.9;
export const DEATH_RATE_STABILITY_COEFFICIENT = 0.3;

/** Минимум населения региона — не даёт региону обнулиться. */
export const MIN_REGION_POPULATION = 1000;
