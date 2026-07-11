import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { RESOURCE_CATALOG, RESOURCE_IDS } from "@shared/data/resources/resourceCatalog";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import {
  DOMESTIC_RESERVE_PER_CAPITA,
  EXPORT_RATE,
  SANCTION_EXPORT_PENALTY_PER_EMBARGO,
  WORLD_PRICE_BY_CATEGORY,
  WORLD_PRICE_OVERRIDES,
} from "@shared/defines/trade";

/**
 * Торговля v1 (независимый гейм-дизайн разбор, 2026-07-06) — резолюция
 * docs/ECONOMY.md Q8 ("что потребляет ресурсы, как ресурс превращается в
 * доход") + docs/TRADE.md Q7 (модель рынка). Один мировой пул цены на
 * категорию ресурса (не двусторонние сделки — N² сложность не нужна для
 * "сотен стран"), не отдельная симуляция потока/коннекторов (см. план,
 * "не в этом заходе"). Баланс-константы — shared/src/defines/trade.ts.
 */

function getWorldPrice(resourceId: ResourceType): number {
  return WORLD_PRICE_OVERRIDES[resourceId] ?? WORLD_PRICE_BY_CATEGORY[RESOURCE_CATALOG[resourceId].category];
}

function getEmbargoPenalty(game: GameState, countryId: string): number {
  const embargoCount = game.countries.filter(c =>
    c.diplomacy.sanctions[countryId]?.includes("trade_embargo")
  ).length;
  return Math.min(1, embargoCount * SANCTION_EXPORT_PENALTY_PER_EMBARGO);
}

/**
 * Продаёт излишек ресурса сверх внутреннего резерва по мировой цене,
 * перезаписывает country.economy.exportIncome (было статичное число из
 * createGame). Физически списывает проданное со stockpile — прямое
 * прочтение docs/ECONOMY.md Q8 "как ресурс превращается в доход" (продажа
 * тратит запас, не дублирует его как одновременно "и резерв, и доход").
 */
export function tradeTick(game: GameState, country: Country): void {
  const currentYear = Number(game.currentDate.split("-")[0]);
  const embargoPenalty = getEmbargoPenalty(game, country.id);

  let totalExportIncome = 0;
  const reserveTarget = country.population * DOMESTIC_RESERVE_PER_CAPITA;

  for (const resourceId of RESOURCE_IDS) {
    if (RESOURCE_CATALOG[resourceId].eraIntroduced > currentYear) continue;

    const stock = country.stockpile[resourceId] ?? 0;
    const exportable = Math.max(0, stock - reserveTarget);
    const sold = exportable * EXPORT_RATE;
    if (sold <= 0) continue;

    country.stockpile[resourceId] -= sold;
    totalExportIncome += sold * getWorldPrice(resourceId) * (1 - embargoPenalty);
  }

  country.economy.exportIncome = totalExportIncome;
}
