import { type Region } from "@shared/types/map/Region";
import { type Country } from "@shared/types/Country";

/**
 * Сервис для операций с регионами.
 * Содержит бизнес-логику для работы с регионами.
 */
export class RegionService {
  /**
   * Находит регион по ID.
   */
  findRegionById(regions: Region[], regionId: number): Region | null {
    return regions.find(r => r.id === regionId) || null;
  }

  /**
   * Получает соседние регионы.
   */
  getNeighborRegions(regions: Region[], regionId: number): Region[] {
    const region = this.findRegionById(regions, regionId);
    if (!region) return [];

    return region.neighboringRegionIds
      .map(id => this.findRegionById(regions, id))
      .filter((r): r is Region => r !== null);
  }

  /**
   * Получает регионы страны.
   */
  getCountryRegions(regions: Region[], countryId: string): Region[] {
    return regions.filter(r => r.ownerCountryId === countryId);
  }

  /**
   * Рассчитывает ВВП региона.
   */
  calculateRegionGDP(region: Region): number {
    const baseMultiplier = 1000;
    return Math.floor(region.population * region.development * region.infrastructure * baseMultiplier);
  }

  /**
   * Проверяет, граничит ли регион с другой страной.
   */
  bordersCountry(regions: Region[], regionId: number, countryId: string): boolean {
    const neighbors = this.getNeighborRegions(regions, regionId);
    return neighbors.some(r => r.ownerCountryId === countryId);
  }

  /**
   * Получает регионы, граничащие с указанной страной.
   */
  getBorderRegions(regions: Region[], countryId: string, targetCountryId: string): Region[] {
    const countryRegions = this.getCountryRegions(regions, countryId);
    const borderRegions: Region[] = [];

    for (const region of countryRegions) {
      if (this.bordersCountry(regions, region.id, targetCountryId)) {
        borderRegions.push(region);
      }
    }

    return borderRegions;
  }
}
