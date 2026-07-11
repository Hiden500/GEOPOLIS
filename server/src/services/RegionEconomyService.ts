import { type Region } from "@shared/types/map/Region";
import { type Country } from "@shared/types/Country";
import { ResourceType } from "@shared/types/resources/ResourcesType";

/**
 * Сервис для управления региональной экономикой.
 * Региональная экономика основана на секторах: agriculture, industry, mining, services.
 */
export class RegionEconomyService {
  /**
   * Инициализирует экономические сектора региона на основе его характеристик.
   */
  initializeRegionEconomy(region: Region): Region {
    // Если экономика уже инициализирована, возвращаем как есть
    if (region.economy) {
      return region;
    }

    // Распределяем сектора на основе развития и урбанизации
    // Чем выше урбанизация, тем больше services и industry
    // Чем ниже урбанизация, тем больше agriculture
    // Чем выше development, тем больше industry
    // Наличие ресурсов увеличивает mining

    let agriculture = 0.3;
    let industry = 0.2;
    let mining = 0.1;
    let services = 0.4;

    // Корректировка на основе урбанизации
    if (region.urbanization > 0.7) {
      agriculture *= 0.5;
      services *= 1.5;
      industry *= 1.2;
    } else if (region.urbanization < 0.3) {
      agriculture *= 1.5;
      services *= 0.5;
      industry *= 0.8;
    }

    // Корректировка на основе развития
    if (region.development > 0.7) {
      industry *= 1.5;
      services *= 1.3;
      agriculture *= 0.7;
    } else if (region.development < 0.3) {
      industry *= 0.6;
      agriculture *= 1.3;
    }

    // Корректировка на основе ресурсов
    const hasResources = Object.keys(region.deposits).length > 0;
    if (hasResources) {
      mining *= 2.0;
      industry *= 1.2;
    }

    // Нормализация чтобы сумма была 1.0
    const total = agriculture + industry + mining + services;
    agriculture /= total;
    industry /= total;
    mining /= total;
    services /= total;

    region.economy = {
      agriculture,
      industry,
      mining,
      services,
    };

    return region;
  }

  /**
   * Рассчитывает производство региона по секторам.
   */
  calculateRegionalProduction(region: Region): {
    food: number;
    industrialOutput: number;
    resourceExtraction: Partial<Record<ResourceType, number>>;
    taxIncome: number;
  } {
    if (!region.economy) {
      this.initializeRegionEconomy(region);
    }

    const { economy } = region;
    if (!economy) {
      return {
        food: 0,
        industrialOutput: 0,
        resourceExtraction: {},
        taxIncome: 0,
      };
    }

    // Базовое производство на основе ВВП и инфраструктуры
    const baseProduction = region.gdp * region.infrastructure;

    // Agriculture производит food
    const food = baseProduction * economy.agriculture * 0.01;

    // Industry производит industrial output
    const industrialOutput = baseProduction * economy.industry * 0.015;

    // Mining производит ресурсы
    const resourceExtraction: Partial<Record<ResourceType, number>> = {};
    if (economy.mining > 0) {
      for (const [resourceType, baseAmount] of Object.entries(region.deposits)) {
        const extraction = baseAmount * economy.mining * region.infrastructure;
        resourceExtraction[resourceType as ResourceType] = extraction;
      }
    }

    // Services производят tax income
    const taxIncome = baseProduction * economy.services * 0.02;

    return {
      food,
      industrialOutput,
      resourceExtraction,
      taxIncome,
    };
  }

  /**
   * Агрегирует региональную экономику к стране.
   */
  aggregateRegionEconomy(country: Country, regions: Region[]): {
    totalFood: number;
    totalIndustrialOutput: number;
    totalResourceExtraction: Record<ResourceType, number>;
    totalTaxIncome: number;
    averageSectors: {
      agriculture: number;
      industry: number;
      mining: number;
      services: number;
    };
  } {
    const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

    let totalFood = 0;
    let totalIndustrialOutput = 0;
    let totalTaxIncome = 0;
    const totalResourceExtraction: Partial<Record<ResourceType, number>> = {};
    let totalAgriculture = 0;
    let totalIndustry = 0;
    let totalMining = 0;
    let totalServices = 0;

    for (const region of countryRegions) {
      const production = this.calculateRegionalProduction(region);

      totalFood += production.food;
      totalIndustrialOutput += production.industrialOutput;
      totalTaxIncome += production.taxIncome;

      for (const [resourceType, amount] of Object.entries(production.resourceExtraction)) {
        totalResourceExtraction[resourceType as ResourceType] =
          (totalResourceExtraction[resourceType as ResourceType] || 0) + amount;
      }

      if (region.economy) {
        totalAgriculture += region.economy.agriculture;
        totalIndustry += region.economy.industry;
        totalMining += region.economy.mining;
        totalServices += region.economy.services;
      }
    }

    const regionCount = countryRegions.length || 1;
    const averageSectors = {
      agriculture: totalAgriculture / regionCount,
      industry: totalIndustry / regionCount,
      mining: totalMining / regionCount,
      services: totalServices / regionCount,
    };

    return {
      totalFood,
      totalIndustrialOutput,
      totalResourceExtraction: totalResourceExtraction as Record<ResourceType, number>,
      totalTaxIncome,
      averageSectors,
    };
  }

  /**
   * Обновляет экономические сектора региона на основе инвестиций.
   */
  updateRegionalSectors(
    region: Region,
    investment: {
      agriculture?: number;
      industry?: number;
      mining?: number;
      services?: number;
    }
  ): Region {
    if (!region.economy) {
      this.initializeRegionEconomy(region);
    }

    if (!region.economy) {
      return region;
    }

    // Применяем инвестиции как небольшие изменения в секторах
    const changeRate = 0.01; // 1% изменение за единицу инвестиции

    if (investment.agriculture) {
      region.economy.agriculture += investment.agriculture * changeRate;
    }
    if (investment.industry) {
      region.economy.industry += investment.industry * changeRate;
    }
    if (investment.mining) {
      region.economy.mining += investment.mining * changeRate;
    }
    if (investment.services) {
      region.economy.services += investment.services * changeRate;
    }

    // Нормализация
    const total = region.economy.agriculture + region.economy.industry + region.economy.mining + region.economy.services;
    region.economy.agriculture /= total;
    region.economy.industry /= total;
    region.economy.mining /= total;
    region.economy.services /= total;

    return region;
  }
}
