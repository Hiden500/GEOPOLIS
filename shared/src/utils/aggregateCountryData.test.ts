import { describe, it, expect } from "vitest";
import { type Country } from "../types/Country";
import { type Region } from "../types/map/Region";
import { aggregateCountryFromRegions } from "./aggregateCountryData";

/**
 * Агрегация «регионы → страна» на границе, которую открыл жизненный цикл
 * государств (docs/CONCEPT.md §7.1).
 *
 * До Милстоуна 1 функция при пустом списке регионов выходила РАНЬШЕ записи
 * чисел, и население с ВВП замерзали на последнем посчитанном значении. Пока
 * страны не появлялись и не исчезали, до этой ветки было не доехать. Раскол
 * доезжает штатно — и молча: осколок, созданный до передачи ему регионов,
 * унаследовал бы численность метрополии и с ней ушёл бы в индекс силы, в промт
 * и в проверку сходимости сумм.
 */

function country(overrides: Partial<Country> = {}): Country {
  return {
    id: "AAA",
    population: 5_000_000,
    economy: { gdp: 1_000_000_000 },
    ...overrides,
  } as unknown as Country;
}

function region(overrides: Partial<Region> = {}): Region {
  return {
    id: 1,
    ownerCountryId: "AAA",
    population: 1_000,
    gdp: 2_000,
    infrastructure: 0.5,
    stability: 0.5,
    development: 0.5,
    deposits: {},
    ...overrides,
  } as unknown as Region;
}

describe("aggregateCountryFromRegions", () => {
  it("страна без регионов обнуляется, а не остаётся с прежними числами", () => {
    const c = country();
    aggregateCountryFromRegions(c, []);
    expect(c.population).toBe(0);
    expect(c.economy.gdp).toBe(0);
  });

  it("страна, чьи регионы ушли другому владельцу, тоже обнуляется", () => {
    // Ровно путь раскола: регион остался в мире, но принадлежит уже не ей.
    const c = country();
    aggregateCountryFromRegions(c, [region({ ownerCountryId: "BBB" })]);
    expect(c.population).toBe(0);
    expect(c.economy.gdp).toBe(0);
  });

  it("нулевое население регионов не даёт NaN в средневзвешенных", () => {
    const c = country();
    aggregateCountryFromRegions(c, [region({ population: 0, gdp: 0 })]);
    expect(Number.isFinite(c.population)).toBe(true);
    expect(Number.isFinite(c.economy.gdp)).toBe(true);
  });

  it("обычный случай не изменился: суммы по своим регионам", () => {
    const c = country();
    aggregateCountryFromRegions(c, [
      region({ id: 1, population: 100, gdp: 10 }),
      region({ id: 2, population: 200, gdp: 20 }),
      region({ id: 3, population: 999, gdp: 99, ownerCountryId: "BBB" }),
    ]);
    expect(c.population).toBe(300);
    expect(c.economy.gdp).toBe(30);
  });
});
