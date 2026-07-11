/**
 * Белый список атрибутов, на которые можно повесить модификатор
 * (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2). Заводятся по потребности
 * планов, не впрок. Тот же паттерн `as const` + `keyof typeof`, что
 * EquipmentType.ts.
 */
export const ModifierAttribute = {
  Stability: "stability",
  // Множитель добычи региона (docs/plans/04_RESOURCES.md) — временные
  // эффекты вроде "забастовка −50% на 6 мес", ResourceTick.ts.
  ResourceOutput: "resourceOutput",
} as const;

export type ModifierAttribute = (typeof ModifierAttribute)[keyof typeof ModifierAttribute];
