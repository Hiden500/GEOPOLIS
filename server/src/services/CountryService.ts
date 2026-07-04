import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type UpdateBudgetInput } from "../validation/schemas";

/**
 * Сервис для операций со странами.
 * Содержит бизнес-логику для работы со странами.
 */
export class CountryService {
  /**
   * Обновляет распределение бюджета страны как доли income (не абсолюты —
   * см. docs/ECONOMY.md "Модель единиц") и сразу выводит абсолютные
   * *Spending из текущего income, чтобы UI не ждал следующего хода.
   * EconomyTick пересчитывает те же поля из этих же долей каждый тик,
   * когда income меняется (тот же паттерн, что taxRate → taxRevenue) —
   * per-category потолки уже проверены zod-схемой (BUDGET_SPENDING_SHARE_CAPS),
   * здесь их не дублируем.
   */
  updateBudget(country: Country, budgetUpdate: UpdateBudgetInput): Country["economy"] {
    const { economy } = country;

    economy.spendingShares = { ...budgetUpdate };

    const income = economy.taxRevenue + economy.exportIncome + economy.stateEnterpriseIncome + economy.otherIncome;
    economy.militarySpending = income * budgetUpdate.military;
    economy.researchSpending = income * budgetUpdate.research;
    economy.educationSpending = income * budgetUpdate.education;
    economy.infrastructureSpending = income * budgetUpdate.infrastructure;
    economy.welfareSpending = income * budgetUpdate.welfare;

    const expenses = economy.militarySpending + economy.researchSpending + economy.educationSpending +
      economy.infrastructureSpending + economy.welfareSpending + economy.debtInterest + economy.otherExpenses;

    economy.budgetBalance = income - expenses;

    return economy;
  }

  /**
   * Находит страну по ID.
   */
  findCountryById(countries: Country[], countryId: string): Country | null {
    return countries.find(c => c.id === countryId) || null;
  }

  /**
   * Получает все регионы страны.
   */
  getCountryRegions(regions: Region[], countryId: string): Region[] {
    return regions.filter(r => r.ownerCountryId === countryId);
  }

  /**
   * Рассчитывает общий ВВП страны.
   */
  calculateTotalGDP(country: Country): number {
    return country.economy.gdp;
  }

  /**
   * Рассчитывает ВВП на душу населения.
   */
  calculateGDPPerCapita(country: Country): number {
    if (country.population === 0) return 0;
    return country.economy.gdp / country.population;
  }

  /**
   * Проверяет, может ли страна позволить себе расходы.
   */
  canAfford(country: Country, amount: number): boolean {
    return country.economy.treasury >= amount;
  }

  /**
   * Получает соседние страны.
   */
  getNeighborCountries(country: Country, allCountries: Country[], regions: Region[]): Country[] {
    const countryRegions = this.getCountryRegions(regions, country.id);
    const neighborIds = new Set<string>();

    for (const region of countryRegions) {
      for (const neighborRegionId of region.neighboringRegionIds) {
        const neighborRegion = regions.find(r => r.id === neighborRegionId);
        if (neighborRegion && neighborRegion.ownerCountryId !== country.id) {
          neighborIds.add(neighborRegion.ownerCountryId);
        }
      }
    }

    return allCountries.filter(c => neighborIds.has(c.id));
  }
}
