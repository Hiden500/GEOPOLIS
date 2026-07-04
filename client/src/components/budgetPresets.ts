/**
 * Курируемые наборы долей income для быстрого старта в BudgetPanel — не
 * заменяют ручную настройку, просто заполняют слайдеры. Все значения внутри
 * BUDGET_SPENDING_SHARE_CAPS — не абсолютный баланс, тюнингуемые примеры.
 */
export interface BudgetPreset {
  name: string;
  shares: {
    military: number;
    research: number;
    education: number;
    infrastructure: number;
    welfare: number;
  };
}

export const BUDGET_PRESETS: BudgetPreset[] = [
  {
    name: "Военная экономика",
    shares: { military: 0.45, research: 0.1, education: 0.05, infrastructure: 0.05, welfare: 0.05 },
  },
  {
    name: "Социальное государство",
    shares: { military: 0.05, research: 0.1, education: 0.2, infrastructure: 0.1, welfare: 0.3 },
  },
  {
    name: "Индустриализация",
    shares: { military: 0.1, research: 0.15, education: 0.05, infrastructure: 0.3, welfare: 0.05 },
  },
  {
    name: "Аустерити",
    shares: { military: 0.03, research: 0.03, education: 0.03, infrastructure: 0.03, welfare: 0.03 },
  },
];
