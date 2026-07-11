import { describe, it, expect } from "vitest";
import { tradeTick } from "./TradeTick";
import { createTestGameState, createTestCountry } from "../../test-utils/fixtures";
import { RESOURCE_IDS } from "@shared/data/resources/resourceCatalog";
import { type ResourceType } from "@shared/types/resources/ResourcesType";

/** Все 20 ресурсов на нуле — для изолированных тестов, где важен только один. */
function emptyStockpile(): Record<ResourceType, number> {
  return Object.fromEntries(RESOURCE_IDS.map(id => [id, 0])) as Record<ResourceType, number>;
}

/**
 * Все 20 ресурсов ровно на уровне резерва (100_000 при дефолтном population
 * фикстуры 10_000_000 × DOMESTIC_RESERVE_PER_CAPITA 0.01) — не экспортируется
 * и не импортируется ничего, кроме явно переопределённого ресурса. Нужен
 * отдельно от emptyStockpile(): с ней тестировался бы импорт СРАЗУ по всем
 * 18 активным в 1946 ресурсам одновременно (каждый ниже резерва), не только
 * по проверяемому.
 */
function atReserveStockpile(): Record<ResourceType, number> {
  return Object.fromEntries(RESOURCE_IDS.map(id => [id, 100_000])) as Record<ResourceType, number>;
}

describe("tradeTick (независимый гейм-дизайн разбор, 2026-07-06)", () => {
  it("продаёт излишек сверх резерва и списывает его со stockpile", () => {
    const country = createTestCountry(); // дефолтный stockpile — oil: 500_000, population: 10_000_000
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });
    const oilBefore = country.stockpile.oil;

    tradeTick(game, country);

    // reserveTarget = 10_000_000 × 0.01 = 100_000; exportable = 400_000; sold = 40_000 (EXPORT_RATE=0.1).
    expect(country.stockpile.oil).toBeCloseTo(oilBefore - 40_000);
    expect(country.economy.exportIncome).toBeGreaterThan(0);
  });

  it("не продаёт ресурс, чей stockpile ниже внутреннего резерва (импортирует его — см. тесты ниже)", () => {
    const country = createTestCountry({ stockpile: { ...emptyStockpile(), tin: 50_000 } }); // < резерва 100_000
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.economy.exportIncome).toBe(0);
  });

  it("цена по категории: metal (iron) даёт больше дохода, чем energy (oil), при равном излишке", () => {
    const oilCountry = createTestCountry({
      id: "OIL",
      stockpile: { ...emptyStockpile(), oil: 200_000 }, // излишек 100_000
    });
    const ironCountry = createTestCountry({
      id: "IRON",
      stockpile: { ...emptyStockpile(), iron: 200_000 }, // тот же излишек 100_000
    });
    const gameOil = createTestGameState({ currentDate: "1946-01-01", countries: [oilCountry] });
    const gameIron = createTestGameState({ currentDate: "1946-01-01", countries: [ironCountry] });

    tradeTick(gameOil, oilCountry);
    tradeTick(gameIron, ironCountry);

    expect(ironCountry.economy.exportIncome).toBeGreaterThan(oilCountry.economy.exportIncome);
  });

  it("trade_embargo от другой страны снижает exportIncome", () => {
    const target = createTestCountry({ id: "TARGET" });
    const embargoer = createTestCountry({ id: "EMBARGOER" });
    embargoer.diplomacy.sanctions["TARGET"] = ["trade_embargo"];

    const gameWithout = createTestGameState({
      currentDate: "1946-01-01",
      countries: [createTestCountry({ id: "TARGET" })],
    });
    const gameWith = createTestGameState({
      currentDate: "1946-01-01",
      countries: [target, embargoer],
    });

    tradeTick(gameWithout, gameWithout.countries[0]!);
    tradeTick(gameWith, target);

    expect(target.economy.exportIncome).toBeLessThan(gameWithout.countries[0]!.economy.exportIncome);
  });

  it("ресурс с eraIntroduced в будущем (rareEarths, 1980) не торгуется в 1946", () => {
    const country = createTestCountry({ stockpile: { ...emptyStockpile(), rareEarths: 1_000_000 } });
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.stockpile.rareEarths).toBe(1_000_000);
    expect(country.economy.exportIncome).toBe(0);
  });

  it("перезаписывает exportIncome, а не суммирует поверх старого значения", () => {
    const country = createTestCountry({
      stockpile: emptyStockpile(),
      economy: { ...createTestCountry().economy, exportIncome: 999_999_999 },
    });
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.economy.exportIncome).toBe(0);
  });
});

describe("tradeTick — импорт дефицита (docs/TRADE.md, \"Явные пробелы v1\")", () => {
  it("импортирует дефицит ресурса ниже резерва и списывает деньги как importSpending", () => {
    const country = createTestCountry({ stockpile: { ...atReserveStockpile(), tin: 50_000 } }); // резерв 100_000, дефицит 50_000
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    // bought = 50_000 × IMPORT_RATE(0.1) = 5_000; tin — metal (цена 80) × IMPORT_PRICE_MARKUP(1.2).
    expect(country.stockpile.tin).toBeCloseTo(50_000 + 5_000);
    expect(country.economy.importSpending).toBeCloseTo(5_000 * 80 * 1.2);
  });

  it("не импортирует ресурс, чей stockpile уже на уровне резерва или выше", () => {
    const country = createTestCountry({ stockpile: atReserveStockpile() }); // все ровно на резерве
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.stockpile.tin).toBe(100_000);
    expect(country.economy.importSpending).toBe(0);
  });

  it("ресурс с eraIntroduced в будущем (rareEarths, 1980) не импортируется в 1946, даже при полном дефиците", () => {
    const country = createTestCountry({ stockpile: emptyStockpile() }); // rareEarths=0, дефицит полный
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.stockpile.rareEarths).toBe(0);
  });

  it("trade_embargo не влияет на импорт (осознанное упрощение v2 — эмбарго режет только экспорт)", () => {
    const target = createTestCountry({ id: "TARGET", stockpile: { ...atReserveStockpile(), tin: 50_000 } });
    const embargoer = createTestCountry({ id: "EMBARGOER" });
    embargoer.diplomacy.sanctions["TARGET"] = ["trade_embargo"];
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [target, embargoer] });

    tradeTick(game, target);

    expect(target.economy.importSpending).toBeCloseTo(5_000 * 80 * 1.2);
  });

  it("перезаписывает importSpending, а не суммирует поверх старого значения", () => {
    const country = createTestCountry({
      stockpile: atReserveStockpile(), // все ровно на резерве — импорта нет в этом тике
      economy: { ...createTestCountry().economy, importSpending: 999_999_999 },
    });
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.economy.importSpending).toBe(0);
  });

  it("экспорт одного ресурса и импорт другого в один и тот же тик не мешают друг другу", () => {
    const country = createTestCountry({
      stockpile: { ...atReserveStockpile(), oil: 200_000, tin: 50_000 }, // oil — излишек, tin — дефицит
    });
    const game = createTestGameState({ currentDate: "1946-01-01", countries: [country] });

    tradeTick(game, country);

    expect(country.economy.exportIncome).toBeGreaterThan(0);
    expect(country.economy.importSpending).toBeGreaterThan(0);
  });
});
