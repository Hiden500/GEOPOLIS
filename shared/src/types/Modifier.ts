import { type ModifierAttribute } from "../defines/modifierAttributes";

/**
 * Временный или постоянный эффект поверх сырого значения поля
 * (docs/plans/03_MODIFIERS_COMMANDS.md, MASTER_PROMPT.md правило 3) —
 * замена «ещё одного if в тике». Тики читают не сырое поле, а
 * `effectiveValue()` (shared/src/utils/modifiers.ts).
 */
export interface Modifier {
  // Счётчик, не random (docs/plans/01_PERSISTENCE_STATE.md, правило
  // детерминизма 5) — тот же счётчик, что Map Features (game.nextFeatureId),
  // другой префикс ("mod-"), без нового поля state.
  id: string;

  // Откуда взялся эффект — свободная строка для отладки/отображения
  // ("event:...", "feature:mf-123", "war:w-5", "llm").
  source: string;

  target: { kind: "country" | "region"; id: string | number };

  // Белый список — shared/src/defines/modifierAttributes.ts.
  attribute: ModifierAttribute;

  op: "add" | "mul";

  value: number;

  // Игровая дата (game.currentDate) — НЕ wall-clock. Отсутствие поля —
  // постоянный эффект. Сравнение — только со game.currentDate (осознанно
  // не повторяет баг MapFeatureService.removeExpiredFeatures, который
  // сравнивает expiresAt с new Date().toISOString()).
  expiresAt?: string;
}
