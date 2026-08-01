import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { type Modifier } from "@shared/types/Modifier";
import { RegionEconomyService } from "../../services/RegionEconomyService";
import { effectiveController } from "@shared/utils/regionControl";
import { getDomainTier } from "@shared/utils/technology";
import { effectiveValue } from "@shared/utils/modifiers";
import { ModifierAttribute } from "@shared/defines/modifierAttributes";
import { OCCUPATION_EXTRACTION_PENALTY } from "@shared/defines/occupation";
import {
  MINING_TECH_BONUS_RATE,
  INFRASTRUCTURE_PRODUCTION_BONUS_RATE,
  MINING_SECTOR_BONUS_RATE,
  RESOURCE_DEPLETION_RATE_PER_MONTH,
  RESOURCE_DEPLETION_FLOOR_SHARE,
  MAX_EXTRACTION_LEVEL,
} from "@shared/defines/resources";

/**
 * Deposit/extraction/output (docs/plans/04_RESOURCES.md): `deposits[resource]`
 * — richness, геологический потенциал (истощается медленно, пропорционально
 * фактической добыче); `extraction[resource]` — уровень мощностей
 * 0..MAX_EXTRACTION_LEVEL, меняется только командами
 * (server/src/commands/resources.ts), не этим тиком. Оккупированные регионы
 * (docs/plans/08_WAR_WAVE1.md, Шаг 1) добывают на оккупанта —
 * `regions.filter` идёт по `effectiveController`, не `ownerCountryId`.
 */
export function resourceTick(
  country: Country,
  regions: Region[],
  modifiers: Modifier[] = []
): void {
  const countryRegions = regions.filter(r => effectiveController(r) === country.id);
  const regionEconomyService = new RegionEconomyService();

  // Бонус от технологий добычи (упрощённо). "industry" — реальный ключ
  // домена эры 1946 (см. shared/src/data/eras.ts), тот же ключ и в 1836.
  // ТИР, а не сырой прогресс — тот же дефект, что в PopulationTick.ts:
  // `MINING_TECH_BONUS_RATE` задан «на единицу уровня», а `domains[...]` копит
  // по 100 за тир. До правки бонус добычи достигал ×18,8
  // (`.agent/audits/formula-audit-2026-07-30.md`).
  const miningTechLevel = getDomainTier(country.technology.domains["industry"] ?? 0);
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

    for (const [resource, richness] of Object.entries(region.deposits)) {
      const richnessValue = richness as number;
      const level = region.extraction[resource as ResourceType] ?? 0;
      const extractionFactor = level / MAX_EXTRACTION_LEVEL;

      // Нет развёрнутых мощностей — нет добычи, месторождение не истощается.
      if (extractionFactor <= 0) continue;

      const baseProduction =
        richnessValue * extractionFactor * infrastructureBonus * techBonus * miningBonus * occupationPenalty;

      // Временные эффекты вроде "забастовка −50% на 6 мес" — модификатор
      // (docs/plans/03_MODIFIERS_COMMANDS.md), финальный множитель.
      const actualProduction = effectiveValue(
        baseProduction,
        ModifierAttribute.ResourceOutput,
        { kind: "region", id: region.id },
        modifiers
      );

      const key = resource as keyof typeof country.stockpile;
      country.stockpile[key] += actualProduction;

      // Истощение richness — пропорционально фактической добыче
      // (extractionFactor=1 на полностью развёрнутых мощностях — тот же
      // темп, что был у прежней конфлированной модели).
      const newRichness = richnessValue * (1 - RESOURCE_DEPLETION_RATE_PER_MONTH * extractionFactor);

      // Не истощать полностью, оставляем минимум долю RESOURCE_DEPLETION_FLOOR_SHARE
      if (newRichness > richnessValue * RESOURCE_DEPLETION_FLOOR_SHARE) {
        (region.deposits as Record<string, number>)[resource] = newRichness;
      }
    }
  }
}
