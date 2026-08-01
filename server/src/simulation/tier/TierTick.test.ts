import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { computeScore, computeTierTotals, tierTick } from "./TierTick";
import { createTestCountry } from "../../test-utils/fixtures";
import {
  MAJOR_COUNT,
  REGIONAL_COUNT,
  TIER_SCORE_GDP_WEIGHT,
  TIER_SCORE_MILITARY_WEIGHT,
  TIER_SCORE_INFLUENCE_WEIGHT,
} from "@shared/defines/tier";
import { type Country } from "@shared/types/Country";

/**
 * ТИР — НЕ ПЕРЕИМЕНОВАНИЕ ВВП.
 *
 * До 2026-07-31 `computeScore` складывал сырые величины несопоставимых
 * порядков: ВВП ~10¹¹, военная сила ~10⁵, влияние ~10². ВВП перевешивал сумму
 * остальных на шесть порядков, поэтому веса 0.5/0.3/0.2 были декоративны. Замер
 * на живом сценарии 1946: ранговая корреляция Спирмена ровно 1,0000, совпало
 * 157 мест из 157. Тестов у `TierTick` не было ни одного.
 *
 * Цена дефекта не косметическая: тир `major` определяет, кто получает ход LLM.
 *
 * Проверяются СВОЙСТВА нормализации, а не состав верхушки: конкретные страны
 * поменяет следующее наполнение данных, а «ни одно слагаемое не доминирует по
 * построению» — нет.
 */

/** Живой мир сценария; страны без данных отбрасываются, как в самом тике. */
function liveCountries(): Country[] {
  const game = createGame("1946", "USA");
  return game.countries.filter(c => c.economy.gdp > 0 || c.military.manpower > 0);
}

describe("нормализация: ни одно слагаемое не доминирует по построению", () => {
  /**
   * Ядро правки. Каждый компонент — ДОЛЯ МИРА, поэтому лежит в [0, 1], а его
   * вклад в скор ограничен собственным весом. На сырых единицах вклад ВВП был
   * порядка 10¹¹ при весе 0.5 — то есть вес не значил ничего.
   */
  it("вклад каждого компонента не превышает его вес", () => {
    const countries = liveCountries();
    const totals = computeTierTotals(countries);

    for (const country of countries) {
      const score = computeScore(country, totals);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(
        TIER_SCORE_GDP_WEIGHT + TIER_SCORE_MILITARY_WEIGHT + TIER_SCORE_INFLUENCE_WEIGHT
      );
    }
  });

  it("сумма скоров мира равна сумме весов наполненных компонентов", () => {
    const countries = liveCountries();
    const totals = computeTierTotals(countries);
    const sum = countries.reduce((s, c) => s + computeScore(c, totals), 0);

    // Доли НАПОЛНЕННОГО компонента складываются в 1, ненаполненный не даёт
    // ничего. Ожидание считается от данных, а не хардкодится: на старте 1946
    // мировая военная сумма ровно ноль (armyStrength/manpower наполняет
    // MilitaryTick уже по ходу партии), и тест не должен от этого падать —
    // как не должен и молча пропустить потерю компонента.
    const expected =
      (totals.gdp > 0 ? TIER_SCORE_GDP_WEIGHT : 0) +
      (totals.military > 0 ? TIER_SCORE_MILITARY_WEIGHT : 0) +
      (totals.influence > 0 ? TIER_SCORE_INFLUENCE_WEIGHT : 0);

    expect(expected).toBeGreaterThan(0);
    expect(sum).toBeCloseTo(expected, 6);
  });

  it("нулевая мировая сумма компонента не даёт NaN", () => {
    // Мир без армий и без влияния: оба знаменателя нулевые.
    const bare = (id: string, gdp: number): Country => {
      const c = createTestCountry({ id });
      c.economy.gdp = gdp;
      c.military.manpower = 0;
      c.military.armyStrength = 0;
      c.military.navyStrength = 0;
      c.military.airStrength = 0;
      c.diplomacy.influence = {};
      return c;
    };
    const countries = [bare("AAA", 100), bare("BBB", 50)];
    const totals = computeTierTotals(countries);

    for (const country of countries) {
      expect(Number.isFinite(computeScore(country, totals))).toBe(true);
    }
  });
});

describe("веса военной силы и влияния реально работают", () => {
  /**
   * Свойство сформулировано через веса, а не через числа: страна, уступающая по
   * ВВП, но существенно превосходящая по армии, обязана обгонять по скору,
   * когда её преимущество перевешивает отставание С УЧЁТОМ ВЕСОВ. На сырых
   * единицах это было невозможно ни при каком разрыве в армии.
   */
  it("военный гигант с меньшим ВВП обгоняет экономику без армии", () => {
    const merchant = createTestCountry({ id: "MER" });
    merchant.economy.gdp = 100;
    merchant.military.manpower = 0;
    merchant.military.armyStrength = 0;
    merchant.military.navyStrength = 0;
    merchant.military.airStrength = 0;
    merchant.diplomacy.influence = {};

    const warrior = createTestCountry({ id: "WAR" });
    warrior.economy.gdp = 60; // 60% ВВП торговца
    warrior.military.manpower = 1_000_000;
    warrior.military.armyStrength = 0;
    warrior.military.navyStrength = 0;
    warrior.military.airStrength = 0;
    warrior.diplomacy.influence = {};

    const countries = [merchant, warrior];
    const totals = computeTierTotals(countries);

    // Торговец: 0.5×(100/160) = 0.3125. Воин: 0.5×(60/160) + 0.3×1 = 0.4875.
    expect(computeScore(warrior, totals)).toBeGreaterThan(computeScore(merchant, totals));
  });
});

describe("живой сценарий 1946: ранг по тиру расходится с рангом по ВВП", () => {
  /**
   * Дефект был именно в СОВПАДЕНИИ рангов: скор был монотонной функцией ВВП, то
   * есть переставить местами две страны не мог никогда. Проверяется наличие
   * хотя бы одной инверсии — свойство, не зависящее от состава данных. На старой
   * формуле инверсий ровно ноль по построению.
   */
  it("существует пара стран, где порядок по скору обратен порядку по ВВП", () => {
    const countries = liveCountries();
    const totals = computeTierTotals(countries);

    let inversions = 0;
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const a = countries[i]!;
        const b = countries[j]!;
        const gdpOrder = Math.sign(a.economy.gdp - b.economy.gdp);
        const scoreOrder = Math.sign(computeScore(a, totals) - computeScore(b, totals));
        if (gdpOrder !== 0 && scoreOrder !== 0 && gdpOrder !== scoreOrder) inversions++;
      }
    }

    expect(inversions).toBeGreaterThan(0);
  }, 60_000);

  it("верхушка по тиру отличается по составу от верхушки по ВВП", () => {
    const countries = liveCountries();
    const totals = computeTierTotals(countries);
    const topN = MAJOR_COUNT + REGIONAL_COUNT;

    const byScore = new Set(
      [...countries].sort((a, b) => computeScore(b, totals) - computeScore(a, totals))
        .slice(0, topN).map(c => c.id)
    );
    const byGdp = new Set(
      [...countries].sort((a, b) => b.economy.gdp - a.economy.gdp)
        .slice(0, topN).map(c => c.id)
    );

    const shared = [...byScore].filter(id => byGdp.has(id)).length;
    // Не должна совпадать полностью — иначе тир снова переименование ВВП.
    expect(shared).toBeLessThan(topN);
    // И не должна разойтись целиком: ВВП остаётся законной частью силы.
    expect(shared).toBeGreaterThan(topN / 2);
  }, 60_000);
});

describe("tierTick раздаёт тиры по количеству мест", () => {
  it("на живом мире ровно MAJOR_COUNT великих и REGIONAL_COUNT региональных", () => {
    const countries = liveCountries();
    tierTick(countries);

    expect(countries.filter(c => c.tier === "major")).toHaveLength(MAJOR_COUNT);
    expect(countries.filter(c => c.tier === "regional")).toHaveLength(REGIONAL_COUNT);
    expect(countries.filter(c => c.tier === "minor").length).toBe(
      countries.length - MAJOR_COUNT - REGIONAL_COUNT
    );
  });

  it("мир без данных тиры не трогает", () => {
    const blank = createTestCountry({ id: "AAA", tier: "minor" });
    blank.economy.gdp = 0;
    blank.military.manpower = 0;
    tierTick([blank]);
    expect(blank.tier).toBe("minor");
  });
});
