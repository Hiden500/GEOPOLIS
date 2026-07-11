/**
 * Потолки бюджетных статей как доля income (не gdp — как EconomyProfile.spending,
 * см. docs/ECONOMY.md "Модель единиц"). Тюнингуемый баланс, не историческая
 * истина — прецедент такого же рода констант: THREAT-пороги в AiBehaviorTick.ts.
 *
 * Нет ограничения на сумму — дефицит (Σ > 1) намеренно разрешён, см.
 * docs/TODO.md. Каждая статья ограничена независимо, чтобы игрок не мог
 * поставить 100% income в одну категорию (нонсенс-бюджет), не запрещая
 * структурный дефицит как осознанный выбор игрока.
 *
 * Перенесено из shared/src/constants/ (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — конституция называет defines/ единственным местом баланс-констант.
 */
export const BUDGET_SPENDING_SHARE_CAPS = {
  military: 0.5,
  research: 0.3,
  education: 0.3,
  infrastructure: 0.35,
  welfare: 0.35,
} as const;
