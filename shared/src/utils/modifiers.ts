import { type Modifier } from "../types/Modifier";
import { type ModifierAttribute } from "../defines/modifierAttributes";

/**
 * Значение атрибута с учётом активных модификаторов
 * (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2): сумма `add` + произведение
 * `mul` среди модификаторов, у которых совпадают target+attribute —
 * `(base + Σadd) × Πmul`. Чистая функция, не проверяет expiresAt — массив
 * `modifiers` уже не содержит истёкших к моменту чтения (Cleanup-фаза
 * SimulationEngine.ts вызывает removeExpiredModifiers раньше по тику, см.
 * server/src/commands/modifiers.ts) — не дублировать логику истечения
 * здесь.
 */
export function effectiveValue(
  base: number,
  attribute: ModifierAttribute,
  target: { kind: "country" | "region"; id: string | number },
  modifiers: Modifier[]
): number {
  const relevant = modifiers.filter(
    m => m.attribute === attribute && m.target.kind === target.kind && m.target.id === target.id
  );

  const addSum = relevant.filter(m => m.op === "add").reduce((sum, m) => sum + m.value, 0);
  const mulProduct = relevant.filter(m => m.op === "mul").reduce((product, m) => product * m.value, 1);

  return (base + addSum) * mulProduct;
}
