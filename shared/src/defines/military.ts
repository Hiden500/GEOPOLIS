/**
 * Баланс-константы MilitaryTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3).
 */

/**
 * Сколько единиц эквивалентной стоимости даёт 1 единица militarySpending при
 * полной (share=1) отдаче на тир 0 — тюнингуемая константа, как
 * RESEARCH_SPENDING_SCALE (research.ts). Подобрана так, чтобы полностью
 * сфокусированная держава (share=0.7) набирала тысячи единиц техники за
 * несколько лет, не за один месяц и не за десятилетия (War Phase 2,
 * независимый гейм-дизайн разбор, 2026-07-06).
 */
export const EQUIPMENT_SPENDING_SCALE = 200_000_000;

/** Базовый набор manpower — доля населения в месяц. */
export const BASE_MANPOWER_GAIN_RATE = 0.001;
/** Множитель бонуса набора manpower от доли militarySpending/gdp. */
export const MANPOWER_SPENDING_BONUS_MULTIPLIER = 2;
/** Ниже — штраф к набору manpower (нестабильность мешает мобилизации). */
export const MANPOWER_LOW_STABILITY_THRESHOLD = 50;
export const MANPOWER_LOW_STABILITY_PENALTY = 0.5;

/** Верхний предел strength подразделения (шкала восстановления, не проценты населения). */
export const UNIT_MAX_STRENGTH = 100;
export const UNIT_BASE_RECOVERY_RATE = 1;
export const UNIT_RECOVERY_SPENDING_BONUS_MULTIPLIER = 2;
export const UNIT_RECOVERY_DEFICIT_PENALTY = 0.5;

/** Доля manpower, становящаяся activePersonnel/reservePersonnel (упрощённая модель). */
export const ACTIVE_PERSONNEL_SHARE = 0.1;
export const RESERVE_PERSONNEL_SHARE = 0.9;

/**
 * Скорость мобилизации: какую долю РАЗРЫВА между целевой армией
 * (`manpower × ACTIVE_PERSONNEL_SHARE`) и фактической `activePersonnel`
 * страна закрывает за месяц.
 *
 * ЗАЧЕМ КОНСТАНТА ВООБЩЕ ПОЯВИЛАСЬ (2026-07-31, замер
 * `server/scripts/probeWarFeedback.ts`). До неё `MilitaryTick` присваивал
 * `activePersonnel = manpower × доля` каждый месяц, то есть поле было чисто
 * производным. Потери, которые `WarTick` списывал с него в том же месяце,
 * следующий тик стирал начисто: из убитого солдата в поле боя возвращалось
 * 90% — только 10% доезжало через уменьшение самого `manpower`. Война не имела
 * военной обратной связи вообще.
 *
 * Списывать потери «сразу с manpower» проблему не решает — код это и делает
 * (`WarTick.distributeSideCasualties` уменьшает `manpower` на ВЕСЬ урон), и
 * именно поэтому уцелевает лишь доля `ACTIVE_PERSONNEL_SHARE`. Лечится только
 * тем, что `activePersonnel` перестаёт быть производным: это ЗАПАС —
 * мобилизованная армия, которую нужно набрать заново.
 *
 * 0.1 = разрыв закрывается примерно за год; армия, выбитая под ноль, не
 * возвращается в строй одним месяцем. Побочно: в мирное время армия держится
 * чуть ниже потолка пула (растущая цель всегда чуть впереди набора) —
 * одинаково у всех стран, соотношение сил не смещает.
 */
export const ACTIVE_PERSONNEL_MOBILIZATION_RATE = 0.1;
