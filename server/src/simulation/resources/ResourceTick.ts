import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { RegionEconomyService } from "../../services/RegionEconomyService";
import { effectiveController } from "@shared/utils/regionControl";
import { OCCUPATION_EXTRACTION_PENALTY } from "@shared/defines/occupation";
import {
  MINING_TECH_BONUS_RATE,
  INFRASTRUCTURE_PRODUCTION_BONUS_RATE,
  MINING_SECTOR_BONUS_RATE,
  RESOURCE_DEPLETION_RATE_PER_MONTH,
  RESOURCE_DEPLETION_FLOOR_SHARE,
} from "@shared/defines/resources";

/**
 * Улучшенный ResourceTick с учётом инфраструктуры, технологий, истощения и
 * региональной экономики. Баланс-константы — shared/src/defines/resources.ts.
 * Оккупированные регионы (docs/plans/08_WAR_WAVE1.md, Шаг 1) добывают на
 * оккупанта — regions.filter идёт по effectiveController, не ownerCountryId
 * (легальный владелец из оккупированного региона ничего не получает).
 */
export function resourceTick(
  country: Country,
  regions: Region[]
): void {
  const countryRegions = regions.filter(r => effectiveController(r) === country.id);
  const regionEconomyService = new RegionEconomyService();

  // Бонус от технологий добычи (упрощённо). "industry" — реальный ключ
  // домена эры 1946 (см. shared/src/data/eras.ts), тот же ключ и в 1836.
  const miningTechLevel = country.technology.domains["industry"] || 0;
  const techBonus = 1 + (miningTechLevel * MINING_TECH_BONUS_RATE);

  for (const region of countryRegions) {
    // Инициализируем экономику региона если нужно
    if (!region.economy) {
      regionEconomyService.initializeRegionEconomy(region);
    }

    // Бонус от инфраструктуры региона
    const infrastructureBonus = 1 + (region.infrastructure * INFRASTRUCTURE_PRODUCTION_BONUS_RATE);

    // Бонус от сектора mining в региональной экономике
    const miningBonus = region.economy ? (1 + region.economy.mining * MINING_SECTOR_BONUS_RATE) : 1;

    // Штраф оккупанту — регион под оккупацией отдаёт только долю обычной добычи.
    const occupationPenalty = region.occupiedBy ? OCCUPATION_EXTRACTION_PENALTY : 1;

    for (const [resource, amount] of Object.entries(region.resourceProduction)) {
      const amountValue = amount as number;

      // Итоговая добыча с учётом бонусов (инфраструктура + технологии + сектор mining + оккупация)
      const actualProduction = amountValue * infrastructureBonus * techBonus * miningBonus * occupationPenalty;

      const key = resource as keyof typeof country.stockpile;
      country.stockpile[key] += actualProduction;

      // Истощение месторождения (очень медленное)
      const newAmount = amountValue * (1 - RESOURCE_DEPLETION_RATE_PER_MONTH);

      // Не истощать полностью, оставляем минимум долю RESOURCE_DEPLETION_FLOOR_SHARE
      if (newAmount > amountValue * RESOURCE_DEPLETION_FLOOR_SHARE) {
        (region.resourceProduction as Record<string, number>)[resource] = newAmount;
      }
    }
  }
}