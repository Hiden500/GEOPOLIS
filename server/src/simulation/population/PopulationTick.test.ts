import { describe, it, expect } from "vitest";
import { populationTick } from "./PopulationTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import {
  BASE_BIRTH_RATE_PER_MONTH,
  STANDARD_OF_LIVING_BIRTH_FLOOR,
  BIRTH_RATE_LIVING_STANDARD_BASE,
  BIRTH_RATE_LIVING_STANDARD_COEFFICIENT,
  BIRTH_RATE_STABILITY_COEFFICIENT,
} from "@shared/defines/population";

describe("populationTick", () => {
  it("grows region population when births exceed deaths", () => {
    const country = createTestCountry();
    // stability в ШКАЛЕ ДАННЫХ 0..1 (scenario1946Schemas.ts); прежнее `80`
    // было конвенцией country.politics.stability и держало тест под багом /100.
    const region = createTestRegion({ ownerCountryId: country.id, population: 1_000_000, stability: 0.8 });
    const populationBefore = region.population;

    populationTick(country, [region]);

    expect(region.population).toBeGreaterThan(populationBefore);
  });

  it("is deterministic for identical inputs", () => {
    const countryA = createTestCountry();
    const countryB = createTestCountry();
    const regionA = createTestRegion({ ownerCountryId: countryA.id });
    const regionB = createTestRegion({ ownerCountryId: countryB.id });

    populationTick(countryA, [regionA]);
    populationTick(countryB, [regionB]);

    expect(regionA.population).toBe(regionB.population);
  });

  it("never drops region population below the 1000 floor", () => {
    const country = createTestCountry({
      economy: { ...createTestCountry().economy, gdp: 1, educationSpending: 0, welfareSpending: 0 },
    });
    const region = createTestRegion({ ownerCountryId: country.id, population: 500, stability: 0 });

    populationTick(country, [region]);

    expect(region.population).toBeGreaterThanOrEqual(1000);
  });

  it("ignores regions owned by other countries", () => {
    const country = createTestCountry();
    const foreignRegion = createTestRegion({ ownerCountryId: "OTHER" });
    const populationBefore = foreignRegion.population;

    populationTick(country, [foreignRegion]);

    expect(foreignRegion.population).toBe(populationBefore);
  });

  it("бедная аграрная страна не теряет население в мире (демографический переход, калибровка CHN)", () => {
    // Очень низкий ВВП/чел (как CHN 1946, ~$83 против ориентира $850) при
    // мизерных тратах на образование/welfare. До калибровки формула тройно
    // подавляла рождаемость и страна убывала; теперь бедность не штрафует
    // фертильность ниже аграрной нормы — население не падает.
    const poor = createTestCountry({
      population: 100_000_000,
      economy: {
        ...createTestCountry().economy,
        gdp: 8_000_000_000, // ВВП/чел = 80, глубоко ниже ориентира 850
        educationSpending: 0,
        welfareSpending: 0,
      },
    });
    const region = createTestRegion({ ownerCountryId: poor.id, population: 100_000_000, stability: 0.5 });
    const populationBefore = region.population;

    populationTick(poor, [region]);

    expect(region.population).toBeGreaterThanOrEqual(populationBefore);
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => populationTick(country, [])).not.toThrow();
  });

  it("вклад region.stability соответствует шкале данных 0..1, а не 0..100", () => {
    // ИСТОРИЯ: до 2026-07-31 тик делил region.stability ещё на 100, читая её
    // как country.politics.stability (0..100), хотя схема сценария кладёт долю
    // 0..1 (scenario1946Schemas.ts, фактический разброс 0,184…0,809). Вклад
    // стабильности в рождаемость сжимался в ~100 раз, и зелёные тесты этого не
    // видели — фикстура задавала stability: 70, то есть была написана под баг.
    //
    // СВОЙСТВО: два одинаковых региона, различающихся ТОЛЬКО стабильностью в
    // пределах шкалы данных (0,2 против 0,8), обязаны разойтись в приросте не
    // меньше, чем нижняя граница, выводимая из самих defines для шкалы 0..1:
    //   Δbirths ≥ pop × BASE_BIRTH × минимальный множитель уровня жизни ×
    //             × BIRTH_RATE_STABILITY_COEFFICIENT × Δstability
    // (множители образования/welfare ≥ 1, смертность у стабильного региона не
    // выше — оба отброшенных слагаемых только увеличивают разрыв). При
    // восстановленном делении на 100 фактический Δstability становится 0,006 и
    // разрыв падает на два порядка ниже границы — тест обязан упасть
    // (негативный контроль показан в отчёте калибровки 2026-08-03).
    const country = createTestCountry();
    const population = 100_000_000; // крупный регион: шум Math.floor пренебрежим
    const calm = createTestRegion({ ownerCountryId: country.id, population, stability: 0.8 });
    const unstable = createTestRegion({ ownerCountryId: country.id, population, stability: 0.2 });

    populationTick(country, [calm, unstable]);

    const gap = calm.population - unstable.population;
    const minLivingStandardMultiplier =
      BIRTH_RATE_LIVING_STANDARD_BASE +
      STANDARD_OF_LIVING_BIRTH_FLOOR * BIRTH_RATE_LIVING_STANDARD_COEFFICIENT;
    const minExpectedGap =
      population * BASE_BIRTH_RATE_PER_MONTH * minLivingStandardMultiplier *
        BIRTH_RATE_STABILITY_COEFFICIENT * (0.8 - 0.2) -
      2; // два Math.floor
    expect(
      gap,
      `Разрыв прироста между stability 0,8 и 0,2 — ${gap}, ожидается не меньше ` +
        `${Math.round(minExpectedGap)}. Похоже, вклад region.stability снова сжат ` +
        `(деление на 100 — чужая шкала country.politics.stability).`
    ).toBeGreaterThanOrEqual(minExpectedGap);
  });
});
