import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { RESOURCE_CATALOG, RESOURCE_IDS } from "@shared/data/resources/resourceCatalog";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import {
  DOMESTIC_RESERVE_PER_CAPITA,
  EXPORT_RATE,
  IMPORT_RATE,
  IMPORT_PRICE_MARKUP,
  SANCTION_EXPORT_PENALTY_PER_EMBARGO,
  WORLD_PRICE_BY_CATEGORY,
  WORLD_PRICE_OVERRIDES,
  CURRENCY_ZONE_EXPORT_BONUS,
  CURRENCY_ZONE_IMPORT_DISCOUNT,
  CURRENCY_ZONE_SANCTION_PROTECTION,
} from "@shared/defines/trade";

/**
 * Торговля v1 (независимый гейм-дизайн разбор, 2026-07-06) — резолюция
 * docs/ECONOMY.md Q8 ("что потребляет ресурсы, как ресурс превращается в
 * доход") + docs/TRADE.md Q7 (модель рынка). Один мировой пул цены на
 * категорию ресурса (не двусторонние сделки — N² сложность не нужна для
 * "сотен стран"), не отдельная симуляция потока/коннекторов (см. план,
 * "не в этом заходе"). Баланс-константы — shared/src/defines/trade.ts.
 *
 * Импорт дефицита (docs/TRADE.md, "Явные пробелы v1") — симметрично экспорту:
 * ресурс ниже резерва докупается по мировой цене с наценкой. Не гейтится
 * trade_embargo (эмбарго в этой модели режет только доход от продажи,
 * не способность покупать — сознательное упрощение, не пробел).
 *
 * Валютные зоны (docs/plans/10_CURRENCY_ZONES.md) — Country.currencyZoneAnchor:
 * член зоны получает бонус к экспортному доходу/скидку на импорт и частичную
 * защиту от санкций СО СТОРОНЫ ВНЕ зоны (эмбарго от якоря/другого члена той
 * же зоны штрафует полностью — зона не защищает "изнутри"). Сам якорь
 * (на него ссылаются, но у него самого currencyZoneAnchor не задан) — без бонусов.
 */

function getWorldPrice(resourceId: ResourceType): number {
  return WORLD_PRICE_OVERRIDES[resourceId] ?? WORLD_PRICE_BY_CATEGORY[RESOURCE_CATALOG[resourceId].category];
}

/**
 * Живой ли якорь валютной зоны страны — и если да, то какой.
 *
 * Проверка существования якоря добавлена Милстоуном 1 (сессия жизненного цикла).
 * До неё зона выводилась ИЗ ПОЛЯ, а не из мира: сравнивались якоря двух стран,
 * и вопрос «а якорь-то ещё существует?» не задавался нигде. Пока страны не
 * исчезали, разницы не было. С роспуском страны бывшие члены её зоны остались
 * бы привязаны к идентификатору-призраку — и продолжали бы получать бонус
 * экспорта, скидку импорта и защиту от санкций от государства, которого нет.
 * Это тихая поломка, а не падение: числа остаются правдоподобными.
 *
 * Перенос ссылок (`countryRefs.ts`) чистит это поле в момент операции, поэтому
 * штатным путём призрака не возникает. Проверка здесь — вторая линия для
 * сейва и данных сценария, собранных мимо движка: подсистема не обязана
 * доверять тому, что все входы прошли через жизненный цикл.
 */
function livingAnchorOf(game: GameState, country: Country): string | undefined {
  const anchor = country.currencyZoneAnchor;
  if (anchor === undefined) return undefined;
  return game.countries.some(c => c.id === anchor) ? anchor : undefined;
}

/** Тот же живой якорь или один из двух — член зоны другого. */
function isZoneMate(game: GameState, a: Country, b: Country): boolean {
  const anchorA = livingAnchorOf(game, a);
  const anchorB = livingAnchorOf(game, b);
  if (anchorA !== undefined && anchorA === anchorB) return true;
  if (anchorA === b.id) return true;
  if (anchorB === a.id) return true;
  return false;
}

function getEmbargoPenalty(game: GameState, target: Country): number {
  let penalty = 0;
  for (const embargoer of game.countries) {
    if (!embargoer.diplomacy.sanctions[target.id]?.includes("trade_embargo")) continue;

    const protectedByZone =
      livingAnchorOf(game, target) !== undefined && !isZoneMate(game, target, embargoer);
    penalty += protectedByZone
      ? SANCTION_EXPORT_PENALTY_PER_EMBARGO * (1 - CURRENCY_ZONE_SANCTION_PROTECTION)
      : SANCTION_EXPORT_PENALTY_PER_EMBARGO;
  }
  return Math.min(1, penalty);
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
  const embargoPenalty = getEmbargoPenalty(game, country);

  // Бонус/скидка члена валютной зоны — сам якорь (currencyZoneAnchor не
  // задан) их не получает. Членство требует ЖИВОГО якоря: ссылка на
  // распавшееся государство зоной не является (см. `livingAnchorOf`).
  const isZoneMember = livingAnchorOf(game, country) !== undefined;
  const exportZoneMultiplier = isZoneMember ? 1 + CURRENCY_ZONE_EXPORT_BONUS : 1;
  const importZoneMultiplier = isZoneMember ? 1 - CURRENCY_ZONE_IMPORT_DISCOUNT : 1;

  let totalExportIncome = 0;
  let totalImportSpending = 0;
  const reserveTarget = country.population * DOMESTIC_RESERVE_PER_CAPITA;

  for (const resourceId of RESOURCE_IDS) {
    if (RESOURCE_CATALOG[resourceId].eraIntroduced > currentYear) continue;

    const stock = country.stockpile[resourceId] ?? 0;

    if (stock >= reserveTarget) {
      const exportable = stock - reserveTarget;
      const sold = exportable * EXPORT_RATE;
      if (sold <= 0) continue;

      country.stockpile[resourceId] -= sold;
      totalExportIncome += sold * getWorldPrice(resourceId) * (1 - embargoPenalty) * exportZoneMultiplier;
    } else {
      const deficit = reserveTarget - stock;
      const bought = deficit * IMPORT_RATE;
      if (bought <= 0) continue;

      country.stockpile[resourceId] += bought;
      totalImportSpending += bought * getWorldPrice(resourceId) * IMPORT_PRICE_MARKUP * importZoneMultiplier;
    }
  }

  country.economy.exportIncome = totalExportIncome;
  country.economy.importSpending = totalImportSpending;
}
