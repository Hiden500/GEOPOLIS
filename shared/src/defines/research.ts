/**
 * Баланс-константы ResearchTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3).
 */

/**
 * Сколько единиц researchSpending дают 1 единицу прогресса домена при полной
 * (share=1) отдаче на тире 0 — тюнингуемая константа, как THREAT_LEVEL и
 * т.п. Подобрана так, чтобы полностью сфокусированная крупная держава
 * проходила тир примерно за 8-10 месяцев на старте партии.
 */
export const RESEARCH_SPENDING_SCALE = 2_000_000_000;

/** Замедление на каждый следующий тир — поздние прорывы непропорционально труднее ранних (docs/DECISIONS.md, 2026-07-06). */
export const TIER_SLOWDOWN_PER_TIER = 0.3;

/** Регионы с development выше этого порога считаются исследовательскими центрами. */
export const RESEARCH_CENTER_DEVELOPMENT_THRESHOLD = 0.7;
/** Бонус к прогрессу на каждый исследовательский центр страны. */
export const RESEARCH_CENTER_BONUS_RATE = 0.1;
/** Множитель бонуса от доли educationSpending/gdp. */
export const RESEARCH_EDUCATION_BONUS_MULTIPLIER = 2;
