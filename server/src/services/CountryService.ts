import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

/**
 * Сервис для операций со странами.
 * Содержит бизнес-логику для работы со странами.
 */
export class CountryService {
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
