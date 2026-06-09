import { type Country } from "@shared/types/Country";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import { RESOURCE_WEIGHTS as resourceWeights } from "@shared/constants/resourceWeights";

export function economyTick(
  country: Country
): void {

  const economy = country.economy;

  const income =
    economy.taxRevenue +
    economy.exportIncome +
    economy.stateEnterpriseIncome +
    economy.otherIncome;

  const expenses =
    economy.militarySpending +
    economy.researchSpending +
    economy.educationSpending +
    economy.infrastructureSpending +
    economy.welfareSpending +
    economy.debtInterest +
    economy.otherExpenses;

  economy.budgetBalance =
    income - expenses;

  economy.treasury +=
    economy.budgetBalance;

  const growthRate = 0.002;

  economy.gdp *=
    1 + growthRate;

  economy.inflation +=
    0.1 * (expenses - income)
    / economy.gdp;

  economy.unemployment +=
    0.05 * (expenses - income)
    / economy.gdp;

  economy.unemployment =
    Math.max(
      0,
      economy.unemployment
    );

  let resourceBonus = 0;

  for (const resource of Object.values(ResourceType)) {

    const amount =
      country.stockpile[resource];

    const weight =
      resourceWeights[resource] ?? 0;

    resourceBonus += amount * weight;
  }
}