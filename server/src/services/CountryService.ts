import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type UpdateBudgetInput } from "../validation/schemas";
import { grossIncome, disposableIncome } from "../simulation/economy/budgetBase";

/**
 * Сервис для операций со странами.
 * Содержит бизнес-логику для работы со странами.
 */
export class CountryService {
  /**
   * Обновляет распределение бюджета страны как доли РАСПОЛАГАЕМОГО дохода (не
   * абсолюты — см. docs/ECONOMY.md "Модель единиц") и сразу выводит абсолютные
   * *Spending, чтобы UI не ждал следующего хода.
   *
   * База и набор расходов — те же, что у `EconomyTick.updateBudget`
   * (`simulation/economy/budgetBase.ts`), и это требование, а не совпадение:
   * игрок, сохранивший роспись, обязан увидеть тот же `budgetBalance`, который
   * при неизменном состоянии посчитает следующий ход. Пока база здесь была
   * полным доходом, а `importSpending` не входил в расходы, показанный баланс
   * расходился с ходом на `(1 − Σдолей) × importSpending`.
   *
   * Per-category потолки уже проверены zod-схемой (BUDGET_SPENDING_SHARE_CAPS),
   * здесь их не дублируем.
   */
  updateBudget(country: Country, budgetUpdate: UpdateBudgetInput): Country["economy"] {
    const { economy } = country;

    economy.spendingShares = { ...budgetUpdate };

    const income = grossIncome(country);
    const budgetBase = disposableIncome(country);
    economy.militarySpending = budgetBase * budgetUpdate.military;
    economy.researchSpending = budgetBase * budgetUpdate.research;
    economy.educationSpending = budgetBase * budgetUpdate.education;
    economy.infrastructureSpending = budgetBase * budgetUpdate.infrastructure;
    economy.welfareSpending = budgetBase * budgetUpdate.welfare;

    const expenses = economy.militarySpending + economy.researchSpending + economy.educationSpending +
      economy.infrastructureSpending + economy.welfareSpending + economy.debtInterest +
      economy.otherExpenses + economy.importSpending;

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
      for (const neighborRegionId of region.landNeighboringRegionIds) {
        const neighborRegion = regions.find(r => r.id === neighborRegionId);
        if (neighborRegion && neighborRegion.ownerCountryId !== country.id) {
          neighborIds.add(neighborRegion.ownerCountryId);
        }
      }
    }

    return allCountries.filter(c => neighborIds.has(c.id));
  }
}
