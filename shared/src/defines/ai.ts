/**
 * Баланс-константы AiBehaviorTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — детерминированное поведение ИИ-стран (docs/DECISIONS.md,
 * 2026-06-23). Тюнингуемые, не историческая истина.
 */

/** −5% дискреционных расходов за тик при дефиците (Правило A). */
export const AUSTERITY_CUT = 0.95;

/** Порог доминирования игрока (calculateBaseInfluence), ~×2.5 (Правило B). */
export const THREAT_LEVEL = 50;

/** +5% military за тик у угрожаемых соперников (Правило B). */
export const MILITARY_RAMP = 1.05;

/** Потолок military как доля дохода (Правило B). */
export const MILITARY_CAP_SHARE = 0.4;

/** +отношение/тик между со-угрожаемыми соперниками (Правило B). */
export const COALITION_STEP = 5;

/** Скорость роста влияния игрока — бандвагонинг (Правило B). */
export const INFLUENCE_GRAVITY = 0.1;

/** Порог "низкой" stability для Правила C. */
export const STABILITY_LOW = 40;

/** Доля дохода, переводимая military→welfare за тик (Правило C). */
export const WELFARE_SHIFT_RATE = 0.02;

/** Потолок welfare как доля дохода (Правило C). */
export const WELFARE_CAP_SHARE = 0.3;

/** Порог отношений для Правила D — почти дно шкалы, войны редки. */
export const WAR_RELATION_THRESHOLD = -80;
