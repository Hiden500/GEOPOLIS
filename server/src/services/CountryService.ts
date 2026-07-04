import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type UpdateBudgetInput } from "../validation/schemas";

/**
 * Сервис для операций со странами.
 * Содержит бизнес-логику для работы со странами.
 */
export class CountryService {
  /**
   * Проверяет бюджетный ввод против реального состояния страны — то, что
   * zod-схема не может: она видит только форму запроса, не game state.
   * Дефицит намеренно разрешён (docs/TODO.md) — это не проверка суммы,
   * а защита от абсурда: ни одна статья не может быть больше всего ВВП
   * страны. Точные per-category потолки (доля income) приходят в шаге 2
   * "доли/проценты" — здесь только грубая защита от нонсенса.
   */
  validateBudgetUpdate(country: Country, budgetUpdate: UpdateBudgetInput): { valid: boolean; error?: string } {
    const gdp = country.economy.gdp;
    const fields: [string, number][] = [
      ["militarySpending", budgetUpdate.militarySpending],
      ["researchSpending", budgetUpdate.researchSpending],
      ["educationSpending", budgetUpdate.educationSpending],
      ["infrastructureSpending", budgetUpdate.infrastructureSpending],
      ["welfareSpending", budgetUpdate.welfareSpending],
    ];

    for (const [field, value] of fields) {
      if (value > gdp) {
        return { valid: false, error: `${field} (${value}) exceeds country GDP (${gdp})` };
      }
    }

    return { valid: true };
  }

  /**
   * Обновляет распределение бюджета страны и пересчитывает баланс.
   */
  updateBudget(country: Country, budgetUpdate: UpdateBudgetInput): Country["economy"] {
    const { economy } = country;

    economy.militarySpending = budgetUpdate.militarySpending;
    economy.researchSpending = budgetUpdate.researchSpending;
    economy.educationSpending = budgetUpdate.educationSpending;
    economy.infrastructureSpending = budgetUpdate.infrastructureSpending;
    economy.welfareSpending = budgetUpdate.welfareSpending;

    const income = economy.taxRevenue + economy.exportIncome + economy.stateEnterpriseIncome + economy.otherIncome;
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
