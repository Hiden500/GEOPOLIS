import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { economyTick } from "./EconomyTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import {
  INFRASTRUCTURE_BUILD_RATE,
  INFRASTRUCTURE_DECAY_RATE,
  INFRASTRUCTURE_MIN,
  INFRASTRUCTURE_MAX,
} from "@shared/defines/economy";
import { type Country } from "@shared/types/Country";

/**
 * ПЕТЛЯ «ВЛОЖИЛ → ПОСТРОИЛОСЬ → РАБОТАЕТ».
 *
 * До 2026-07-31 `region.infrastructure` не писал ни один тик: поле читали
 * формула ВВП, ставка роста, добыча и бегство капитала, а менять его было
 * нечем. Деньги на инфраструктуру при этом работали — но только потоком, через
 * прямой член в ставке роста. Перестал платить — эффект исчезал в тот же тик,
 * то есть построить было нельзя, можно было только платить.
 *
 * Проверяются СВОЙСТВА модели капитала, а не сегодняшние числа: вложение выше
 * равновесия наращивает, ниже — изнашивает, относительные различия регионов
 * внутри страны сохраняются, границы шкалы не пробиваются.
 */

/** Медиана — та же, что в `scripts/probeEconomyLoop.ts`; тесту нужен один разрез. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Интенсивность вложений, дающая равновесие ровно на текущем уровне. */
function equilibriumIntensity(avgInfrastructure: number): number {
  return INFRASTRUCTURE_DECAY_RATE * avgInfrastructure / INFRASTRUCTURE_BUILD_RATE;
}

/**
 * Прогон одной страны с одним регионом: возвращает инфраструктуру региона
 * после `months` тиков при постоянной интенсивности вложений.
 *
 * `spendingShares` намеренно не задаются: тик пересчитал бы из них
 * `infrastructureSpending` по доходу, а тест задаёт интенсивность напрямую.
 */
function runTick(infrastructure: number, intensity: number, months: number): number {
  const country: Country = createTestCountry({ id: "AAA" });
  country.economy.gdp = 1_000_000;
  delete country.economy.spendingShares;

  const region = createTestRegion({ id: 1, ownerCountryId: "AAA", infrastructure });
  region.gdp = country.economy.gdp;

  for (let month = 0; month < months; month++) {
    country.economy.infrastructureSpending = country.economy.gdp * intensity;
    economyTick(country, [region]);
  }
  return region.infrastructure;
}

describe("инфраструктура накапливается и изнашивается", () => {
  it("вложение выше равновесного наращивает инфраструктуру", () => {
    const start = 0.3;
    const above = equilibriumIntensity(start) * 2;
    expect(runTick(start, above, 24)).toBeGreaterThan(start);
  });

  it("вложение ниже равновесного изнашивает её", () => {
    const start = 0.3;
    const below = equilibriumIntensity(start) / 2;
    expect(runTick(start, below, 24)).toBeLessThan(start);
  });

  it("вложение на равновесном уровне удерживает её на месте", () => {
    const start = 0.3;
    const equal = equilibriumIntensity(start);
    const after = runTick(start, equal, 24);
    // Допуск — не «примерно равно на глаз»: равновесие точное, но ВВП за 24
    // месяца растёт, а интенсивность задаётся от него, поэтому уровень слегка
    // плывёт. Требование — остаться в пределах процента, а не совпасть побитно.
    expect(Math.abs(after - start) / start).toBeLessThan(0.01);
  });

  it("нулевое вложение не пробивает пол шкалы", () => {
    expect(runTick(0.3, 0, 600)).toBeGreaterThanOrEqual(INFRASTRUCTURE_MIN);
  });

  it("щедрое вложение не пробивает потолок шкалы", () => {
    expect(runTick(0.9, 0.5, 600)).toBeLessThanOrEqual(INFRASTRUCTURE_MAX);
  });
});

describe("накопление сохраняет авторскую разметку регионов", () => {
  /**
   * Вложения задаются СТРАНОЙ, а инфраструктура размечена ПО РЕГИОНАМ
   * (`docs/provenance/`). Механика, тянущая все регионы страны к одному числу,
   * стёрла бы эти данные за десяток лет — поэтому множитель общий, а отношение
   * между регионами обязано сохраняться.
   */
  it("отношение инфраструктуры двух регионов страны не меняется", () => {
    const country = createTestCountry({ id: "AAA" });
    country.economy.gdp = 1_000_000;
    delete country.economy.spendingShares;
    const rich = createTestRegion({ id: 1, ownerCountryId: "AAA", infrastructure: 0.8 });
    const poor = createTestRegion({ id: 2, ownerCountryId: "AAA", infrastructure: 0.2 });
    rich.gdp = 700_000;
    poor.gdp = 300_000;

    const ratioBefore = rich.infrastructure / poor.infrastructure;

    for (let month = 0; month < 60; month++) {
      country.economy.infrastructureSpending = country.economy.gdp * 0.08;
      economyTick(country, [rich, poor]);
    }

    expect(rich.infrastructure / poor.infrastructure).toBeCloseTo(ratioBefore, 6);
    expect(rich.infrastructure).toBeGreaterThan(0.8);
  });
});

describe("живой сценарий 1946: построенное переживает прекращение вложений", () => {
  /**
   * СВОЙСТВО ВЫБРАНО ИМЕННО ТАК, И ЭТО ВАЖНО. Первая редакция теста сравнивала
   * страну, которая вкладывается, со страной, которая не вкладывается, — и
   * оказалась зелёной ДАЖЕ С ОТКЛЮЧЁННЫМ накоплением: разницу давал член
   * потока (`INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT`), работавший и до
   * правки. Тест проверял чужую механику.
   *
   * Накопление отличает от потока ровно одно: НАСЛЕДИЕ. Обе страны здесь
   * вторую половину прогона тратят одинаково; разойтись они могут только тем,
   * что одна успела построить актив, а другая нет. Поток к этому моменту
   * равен у обеих и разницы дать не может по построению.
   *
   * Порог 2% против наблюдаемых 3,3%: запас невелик, потому что и сам эффект
   * невелик — построенное сегодня работает в двадцать раз слабее стройки
   * (разбор и числа — у коэффициентов в `shared/src/defines/economy.ts`).
   */
  it("страна, вкладывавшаяся 5 лет, сохраняет преимущество ещё 5 лет спустя", () => {
    const LOW = { military: 0.15, research: 0.05, education: 0.10, infrastructure: 0.02, welfare: 0.33 };
    const HIGH = { military: 0.15, research: 0.05, education: 0.10, infrastructure: 0.30, welfare: 0.05 };

    const run = (buildsFirst: boolean): { growth: number; infrastructure: number } => {
      const game = createGame("1946", "USA");
      const withGdp = game.countries.filter(c => c.economy.gdp > 0);
      const sorted = [...withGdp].sort((a, b) => b.economy.gdp - a.economy.gdp);
      const subject = sorted[Math.floor(sorted.length / 2)]!;

      const gdp0 = subject.economy.gdp;
      subject.economy.spendingShares = { ...(buildsFirst ? HIGH : LOW) };
      for (let month = 0; month < 60; month++) simulateMonth(game);

      // Вторая половина одинакова у обоих — дальше говорит только наследие.
      subject.economy.spendingShares = { ...LOW };
      for (let month = 0; month < 60; month++) simulateMonth(game);

      return {
        growth: subject.economy.gdp / gdp0,
        infrastructure: median(
          game.regions.filter(r => r.ownerCountryId === subject.id).map(r => r.infrastructure)
        ),
      };
    };

    const built = run(true);
    const idle = run(false);

    expect(built.infrastructure).toBeGreaterThan(idle.infrastructure * 1.5);
    expect(built.growth / idle.growth - 1).toBeGreaterThan(0.02);
  }, 120_000);
});
