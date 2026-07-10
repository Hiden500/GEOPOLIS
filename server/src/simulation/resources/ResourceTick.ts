import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { RegionEconomyService } from "../../services/RegionEconomyService";

/**
 * Улучшенный ResourceTick с учётом инфраструктуры, технологий, истощения и региональной экономики.
 */
export function resourceTick(
  country: Country,
  regions: Region[]
): void {
  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);
  const regionEconomyService = new RegionEconomyService();

  // Бонус от технологий добычи (упрощённо). "industry" — реальный ключ
  // домена эры 1946 (см. shared/src/data/eras.ts), тот же ключ и в 1836.
  const miningTechLevel = country.technology.domains["industry"] || 0;
  const techBonus = 1 + (miningTechLevel * 0.05);

  for (const region of countryRegions) {
    // Инициализируем экономику региона если нужно
    if (!region.economy) {
      regionEconomyService.initializeRegionEconomy(region);
    }

    // Бонус от инфраструктуры региона
    const infrastructureBonus = 1 + (region.infrastructure * 0.5);

    // Бонус от сектора mining в региональной экономике
    const miningBonus = region.economy ? (1 + region.economy.mining * 0.3) : 1;

    for (const [resource, amount] of Object.entries(region.resourceProduction)) {
      const amountValue = amount as number;

      // Итоговая добыча с учётом бонусов (инфраструктура + технологии + сектор mining)
      const actualProduction = amountValue * infrastructureBonus * techBonus * miningBonus;

      const key = resource as keyof typeof country.stockpile;
      country.stockpile[key] += actualProduction;

      // Истощение месторождения (очень медленное)
      // Уменьшаем на 0.01% в месяц
      const depletionRate = 0.0001;
      const newAmount = amountValue * (1 - depletionRate);

      // Не истощать полностью, оставляем минимум 10%
      if (newAmount > amountValue * 0.1) {
        (region.resourceProduction as Record<string, number>)[resource] = newAmount;
      }
    }
  }
}