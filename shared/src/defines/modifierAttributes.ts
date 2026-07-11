/**
 * Белый список атрибутов, на которые можно повесить модификатор
 * (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2). Старт с одного атрибута —
 * сквозной демонстрации системы достаточно, чтобы закрыть критерий приёмки
 * («модификатор с expiresAt влияет на расчёт и исчезает после срока»);
 * остальные добавляются по потребности следующих планов (04/06/08), не
 * заводятся впрок. Тот же паттерн `as const` + `keyof typeof`, что
 * EquipmentType.ts.
 */
export const ModifierAttribute = {
  Stability: "stability",
} as const;

export type ModifierAttribute = (typeof ModifierAttribute)[keyof typeof ModifierAttribute];
