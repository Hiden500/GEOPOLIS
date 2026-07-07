/**
 * Исторические развилки (docs/tasks/HISTORICAL_HINGE_POINTS_1946.md,
 * реализовано 2026-07-06) — не каталог рельс: движок только проверяет
 * предусловия и решает, показывать ли LLM подсказку "вот что исторически
 * вероятно сейчас, если предпосылки не изменены игроком" — не заставляет
 * ничего разыгрывать. LLM решает, отразить подсказку, её вариацию, или
 * проигнорировать, если мир уже разошёлся с историей достаточно сильно.
 */
export interface HistoricalHingePoint {
  id: string;
  title: string;
  windowStart: string; // "YYYY-MM"
  windowEnd: string; // "YYYY-MM" — после этой даты развилка считается устаревшей, не подсказывается
  primaryCountries: string[]; // реальные country id
  historicalOutcome: string; // короткое описание для контекста LLM
  preconditions: Precondition[]; // ВСЕ должны выполняться, иначе развилка молчит
  baseWeight: number; // 0..1, ориентир "насколько это должно было случиться" — не жёсткий rng-бросок
  divergenceHint: string; // что из действий игрока могло бы это изменить
  representable: boolean; // false = нет игровой сущности для одной из сторон
  blockedReason?: string;
}

export type Precondition =
  | { type: "relationBelow"; a: string; b: string; threshold: number }
  | { type: "relationAbove"; a: string; b: string; threshold: number }
  | { type: "noGuaranteeFrom"; target: string; guarantor: string }
  | { type: "stabilityBelow"; country: string; threshold: number };
