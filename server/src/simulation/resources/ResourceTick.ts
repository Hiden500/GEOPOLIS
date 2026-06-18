import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

/**
 * Улучшенный ResourceTick с учётом инфраструктуры, технологий и истощения.
 */
export function resourceTick(
  country: Country,
  regions: Region[],
  regionIndex: Map<string, number[]>
): void {
  const ownedRegionIds = regionIndex.get(country.id) || [];

  // Бонус от технологий добычи (упрощённо)
  const miningTechLevel = country.technology.domains["Industry"] || 0;
  const techBonus = 1 + (miningTechLevel * 0.05);

  for (const regionId of ownedRegionIds) {
    const region = regions.find(r => r.id === regionId);
    if (!region) continue;

    // Бонус от инфраструктуры региона
    const infrastructureBonus = 1 + (region.infrastructure * 0.5);

    for (const [resource, amount] of Object.entries(region.resourceProduction)) {
      const amountValue = amount as number;

      // Итоговая добыча с учётом бонусов
      const actualProduction = amountValue * infrastructureBonus * techBonus;

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