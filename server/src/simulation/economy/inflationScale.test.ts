import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { economyTick } from "./EconomyTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import {
  INFLATION_BASELINE,
  INFLATION_DEFICIT_COEFFICIENT,
  INFLATION_MIN,
  INFLATION_MAX,
  UNEMPLOYMENT_BASELINE,
  UNEMPLOYMENT_DEFICIT_COEFFICIENT,
  UNEMPLOYMENT_MIN,
  UNEMPLOYMENT_MAX,
} from "@shared/defines/economy";
import {
  STABILITY_HIGH_INFLATION_THRESHOLD,
  STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD,
} from "@shared/defines/politics";
import { type Country } from "@shared/types/Country";

/**
 * ИНФЛЯЦИЯ И БЕЗРАБОТИЦА ЖИВУТ В ОДНОЙ ШКАЛЕ СО СВОИМИ ПОРОГАМИ.
 *
 * До 2026-07-31 величина хранилась в процентах (стартовые данные 2–3 и 1–5,
 * пороги 5/15/20, текст факта для LLM), а приращение считалось в долях ВВП:
 * `0.1 × дефицит/ВВП`. Отклик был примерно в сто раз слабее собственной шкалы —
 * замер на живом сценарии 1946 за 120 месяцев: кризисный порог 20 не перешла НИ
 * ОДНА страна из 157, инфляция сдвинулась с 3,000 до 1,817.
 *
 * Проверяются СВОЙСТВА, а не сегодняшние числа: пороги достижимы устойчивым
 * дефицитом, отклик зависит от ДОЛИ ВВП а не от размера страны, и за долгую
 * партию величины не покидают коридор правдоподобия. Пороги и коэффициенты
 * берутся из констант — перекалибровка баланса не должна ломать тест.
 */

/** Доля ВВП дефицита, при которой ЦЕЛЬ величины заведомо выше её порога. */
function deficitRatioAbove(threshold: number, baseline: number, coefficient: number): number {
  // цель = baseline + coefficient × (доля × 100); полуторный запас над порогом.
  return ((threshold - baseline) / coefficient / 100) * 1.5;
}

/**
 * Прогон одной страны с ФИКСИРОВАННОЙ долей дефицита в ВВП.
 *
 * Казна намеренно велика, а долг нулевой: иначе дефицит порождал бы долг,
 * проценты по долгу входили бы в расходы, и измеряемая доля плыла бы от месяца
 * к месяцу. Тесту нужен ровно один управляемый вход.
 */
function runWithDeficitRatio(
  deficitRatio: number,
  months: number,
  gdp = 1_000_000
): { inflation: number; unemployment: number } {
  const country: Country = createTestCountry({ id: "AAA" });
  const economy = country.economy;

  economy.gdp = gdp;
  delete economy.spendingShares;
  delete economy.taxRate; // доход задаётся напрямую, не выводится из ВВП
  economy.treasury = gdp * 1e6;
  economy.debt = 0;
  economy.debtInterest = 0;

  economy.taxRevenue = gdp * 0.5;
  economy.exportIncome = 0;
  economy.stateEnterpriseIncome = 0;
  economy.otherIncome = 0;

  economy.militarySpending = 0;
  economy.researchSpending = 0;
  economy.educationSpending = 0;
  economy.infrastructureSpending = 0;
  economy.welfareSpending = 0;
  economy.importSpending = 0;
  // Расходы = доход + заданная доля ВВП: сальдо ровно deficitRatio × ВВП.
  economy.otherExpenses = economy.taxRevenue + gdp * deficitRatio;

  const region = createTestRegion({ id: 1, ownerCountryId: "AAA" });
  region.gdp = gdp;

  for (let month = 0; month < months; month++) economyTick(country, [region]);

  return { inflation: economy.inflation, unemployment: economy.unemployment };
}

describe("пороги инфляции и безработицы достижимы дефицитом", () => {
  it("устойчивый дефицит выводит инфляцию за кризисный порог", () => {
    const ratio = deficitRatioAbove(
      STABILITY_HIGH_INFLATION_THRESHOLD,
      INFLATION_BASELINE,
      INFLATION_DEFICIT_COEFFICIENT
    );
    const { inflation } = runWithDeficitRatio(ratio, 120);
    expect(inflation).toBeGreaterThan(STABILITY_HIGH_INFLATION_THRESHOLD);
  });

  it("устойчивый дефицит выводит безработицу за порог штрафа", () => {
    const ratio = deficitRatioAbove(
      STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD,
      UNEMPLOYMENT_BASELINE,
      UNEMPLOYMENT_DEFICIT_COEFFICIENT
    );
    const { unemployment } = runWithDeficitRatio(ratio, 120);
    expect(unemployment).toBeGreaterThan(STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD);
  });

  it("сбалансированный бюджет держит обе величины у базовой линии, а не у порога", () => {
    const { inflation, unemployment } = runWithDeficitRatio(0, 120);
    expect(inflation).toBeLessThan(STABILITY_HIGH_INFLATION_THRESHOLD);
    expect(unemployment).toBeLessThan(STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD);
    expect(inflation).toBeCloseTo(INFLATION_BASELINE, 1);
    expect(unemployment).toBeCloseTo(UNEMPLOYMENT_BASELINE, 1);
  });
});

describe("отклик определяется долей ВВП, а не размером страны", () => {
  /**
   * Прямая защита от возврата дефекта: приращение в абсолютных единицах дало бы
   * двум странам с одинаковой бюджетной дисциплиной, но разным ВВП, разную
   * инфляцию. Разница в масштабе здесь — миллион раз.
   */
  it("две страны с одной долей дефицита и разным ВВП приходят к одной инфляции", () => {
    const ratio = 0.05;
    const small = runWithDeficitRatio(ratio, 60, 1_000_000);
    const large = runWithDeficitRatio(ratio, 60, 1_000_000_000_000);

    expect(large.inflation).toBeCloseTo(small.inflation, 6);
    expect(large.unemployment).toBeCloseTo(small.unemployment, 6);
  });
});

describe("границы коридора не пробиваются", () => {
  it("экстремальный дефицит не уводит инфляцию выше потолка", () => {
    const { inflation, unemployment } = runWithDeficitRatio(100, 600);
    expect(inflation).toBeLessThanOrEqual(INFLATION_MAX);
    expect(unemployment).toBeLessThanOrEqual(UNEMPLOYMENT_MAX);
  });

  it("экстремальный профицит не уводит величины ниже пола", () => {
    const { inflation, unemployment } = runWithDeficitRatio(-100, 600);
    expect(inflation).toBeGreaterThanOrEqual(INFLATION_MIN);
    expect(unemployment).toBeGreaterThanOrEqual(UNEMPLOYMENT_MIN);
  });

  it("потолок инфляции выше кризисного порога — иначе клип съел бы само событие", () => {
    expect(INFLATION_MAX).toBeGreaterThan(STABILITY_HIGH_INFLATION_THRESHOLD);
    expect(UNEMPLOYMENT_MAX).toBeGreaterThan(STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD);
  });
});

describe("живой сценарий 1946: коридор держится всю партию", () => {
  /**
   * Страховка от разгона и от вырождения. Интегратор без якоря уехал бы за
   * границы, а слишком жёсткое насыщение схлопнуло бы все страны в одно число —
   * инфляция стала бы мировой константой. Поэтому проверяется и коридор, и
   * сохранившийся РАЗБРОС между странами.
   */
  it("за 120 месяцев инфляция и безработица всех стран остаются в границах", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 120; month++) simulateMonth(game);

    const live = game.countries.filter(c => c.economy.gdp > 0);
    expect(live.length).toBeGreaterThan(0);

    for (const country of live) {
      const { inflation, unemployment } = country.economy;
      expect(Number.isFinite(inflation)).toBe(true);
      expect(Number.isFinite(unemployment)).toBe(true);
      expect(inflation).toBeGreaterThanOrEqual(INFLATION_MIN);
      expect(inflation).toBeLessThanOrEqual(INFLATION_MAX);
      expect(unemployment).toBeGreaterThanOrEqual(UNEMPLOYMENT_MIN);
      expect(unemployment).toBeLessThanOrEqual(UNEMPLOYMENT_MAX);
    }

    // Разброс жив: величина реагирует на бюджет конкретной страны, а не на
    // общий множитель. Без этого коридор проходил бы и у константы.
    const inflations = live.map(c => c.economy.inflation);
    expect(Math.max(...inflations) - Math.min(...inflations)).toBeGreaterThan(0.1);
  }, 120_000);
});
