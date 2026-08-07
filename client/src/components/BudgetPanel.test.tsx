import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { type Country } from "@shared/types/Country";
import { BudgetPanel } from "./BudgetPanel";

/**
 * Панель бюджета обязана считать теми же деньгами, что и движок.
 *
 * `EconomyTick.updateBudget` вычитает импорт ДО росписи (обязательный платёж) и
 * включает его в расходы. Пока панель делила доли на полный доход и импорт в
 * расходах не показывала, игрок видел баланс, которого в движке нет, — и тем
 * оптимистичнее, чем больше страна закупает. Тест держит именно это: числа
 * панели выведены из формулы, а не из вёрстки.
 */
const INCOME_PARTS = {
  taxRevenue: 100_000_000_000,
  exportIncome: 50_000_000_000,
  stateEnterpriseIncome: 20_000_000_000,
  otherIncome: 10_000_000_000,
};
const INCOME = 180_000_000_000;
const IMPORTS = 30_000_000_000;

/** Доли суммой 0,5 — ровная арифметика, проверяется формула, а не округление. */
const SHARES = { military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.05, welfare: 0.05 };

function countryWith(importSpending: number): Country {
  return {
    id: "USA",
    name: { ru: "США", en: "USA" },
    economy: {
      ...INCOME_PARTS,
      gdp: 500_000_000_000,
      treasury: 0,
      importSpending,
      // Прочие расходы и проценты по долгу обнулены намеренно: проверяется
      // база долей и попадание импорта в расходы, остальное размыло бы числа.
      otherExpenses: 0,
      debt: 0,
      debtInterest: 0,
      militarySpending: 0,
      researchSpending: 0,
      educationSpending: 0,
      infrastructureSpending: 0,
      welfareSpending: 0,
      spendingShares: { ...SHARES },
    },
  } as unknown as Country;
}

/** Число из строки сводки: локаль вставляет неразрывные пробелы. */
function summaryValue(label: string): number {
  const node = screen.getByText(label).parentElement;
  const raw = node?.querySelector(".value")?.textContent ?? "";
  return Number(raw.replace(/[^\d-]/g, ""));
}

describe("BudgetPanel", () => {
  it("вычитает импорт из базы долей и включает его в расходы", () => {
    render(<BudgetPanel country={countryWith(IMPORTS)} onUpdateBudget={vi.fn()} />);

    const disposable = INCOME - IMPORTS;
    const discretionary = disposable * 0.5;

    expect(summaryValue("Расходы:")).toBe(discretionary + IMPORTS);
    expect(summaryValue("Баланс:")).toBe(INCOME - (discretionary + IMPORTS));
  });

  it("без импорта расписывает весь доход — прежнее поведение сохранено", () => {
    render(<BudgetPanel country={countryWith(0)} onUpdateBudget={vi.fn()} />);

    expect(summaryValue("Расходы:")).toBe(INCOME * 0.5);
    expect(summaryValue("Баланс:")).toBe(INCOME * 0.5);
  });
});
