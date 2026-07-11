/**
 * Баланс-константы DiplomacyTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — план не называл их явно (не было именованных констант в файле
 * до этого шага), но файл физически в периметре критерия приёмки
 * (server/src/simulation/**). Не путать с капами LLM-действий
 * (llmActionCaps.ts) — те про магнитуду одного действия LLM за раз, эти —
 * про естественный дрейф/авто-переходы каждый тик.
 */

/** Естественное затухание положительных/отрицательных отношений — доля/тик. */
export const RELATION_DECAY_RATE = 0.01;
/** Потолок величины затухания отношений за один тик. */
export const RELATION_DECAY_CAP = 0.1;

/** Естественное затухание влияния — доля/тик. */
export const INFLUENCE_DECAY_RATE = 0.02;
/** Потолок величины затухания влияния за один тик. */
export const INFLUENCE_DECAY_CAP = 0.5;

/** Отношения ниже — страна автоматически становится соперником. */
export const RIVAL_RELATION_THRESHOLD = -70;
/** Отношения выше (взаимно) — страны автоматически становятся союзниками (при идеологической совместимости). */
export const ALLY_RELATION_THRESHOLD = 70;
/** Отношения выше — страна автоматически покидает список соперников. */
export const RIVAL_RECONCILE_THRESHOLD = -30;
/** Отношения ниже — страна автоматически покидает список союзников. */
export const ALLY_BREAK_THRESHOLD = 30;

/** Влияние выше — цель входит в сферу влияния. */
export const SPHERE_INFLUENCE_ENTER_THRESHOLD = 50;
/** Влияние ниже — цель покидает сферу влияния. */
export const SPHERE_INFLUENCE_EXIT_THRESHOLD = 20;

// --- calculateBaseInfluence ---
/** Вес отношения manpower источника к цели в итоговом влиянии. */
export const MILITARY_RATIO_INFLUENCE_WEIGHT = 10;
/** Вес отношения ВВП источника к цели в итоговом влиянии. */
export const GDP_RATIO_INFLUENCE_WEIGHT = 10;
/** Плоский бонус влияния от географической близости (упрощённо — соседство регионов не проверяется). */
export const GEOGRAPHIC_PROXIMITY_INFLUENCE_BONUS = 5;
