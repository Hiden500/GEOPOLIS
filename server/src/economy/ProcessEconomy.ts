import { type Country } from "@shared/types/Country";

export function processEconomy(
  country: Country
): void {

  const income =

    country.economy.taxRevenue +

    country.economy.exportIncome +

    country.economy.stateEnterpriseIncome +

    country.economy.otherIncome;

  const expenses =

    country.economy.militarySpending +

    country.economy.researchSpending +

    country.economy.educationSpending +

    country.economy.infrastructureSpending +

    country.economy.welfareSpending +

    country.economy.debtInterest +

    country.economy.otherExpenses;

  const result =
    income - expenses;

  country.economy.treasury += result;

  country.economy.budgetBalance =
    result;
}