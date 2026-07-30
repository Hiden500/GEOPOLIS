import { describe, it, expect } from "vitest";
import { corruptionBase, legitimacyBase } from "./politics";
import { POWER_STRUCTURES } from "../types/politics/Government";
import { COUNTRY_POLITICS_SCALE_MAX } from "../defines/discontent";
import {
  IDEOLOGY_AXIS_MIN,
  IDEOLOGY_AXIS_MAX,
  type IdeologyCoordinates,
} from "../types/politics/Ideology";

/**
 * Свойства структурных базисов политики, а не их снимок: конкретные числа
 * (`defines/politics.ts`) — плейсхолдеры под калибровку, и тест, приколоченный
 * к ним, ломался бы на каждой правке баланса, ничего не проверяя по существу.
 */

const HYBRID: IdeologyCoordinates = { economic: 0, political: 0 };
const CONSOLIDATED_DEMOCRACY: IdeologyCoordinates = { economic: 0, political: 0.9 };
const CONSOLIDATED_AUTOCRACY: IdeologyCoordinates = { economic: 0, political: -0.9 };

describe("corruptionBase — по механизму удержания власти", () => {
  it("конкурентная многопартийность коррумпирована меньше личного режима и безвластия", () => {
    expect(corruptionBase("competitive_multiparty")).toBeLessThan(corruptionBase("personalist"));
    expect(corruptionBase("competitive_multiparty")).toBeLessThan(corruptionBase("fragmented"));
  });

  it("сужение конкуренции повышает базис монотонно", () => {
    expect(corruptionBase("competitive_multiparty"))
      .toBeLessThan(corruptionBase("limited_multiparty"));
    expect(corruptionBase("limited_multiparty"))
      .toBeLessThan(corruptionBase("dominant_party"));
    expect(corruptionBase("dominant_party"))
      .toBeLessThan(corruptionBase("one_party"));
  });

  it("каждая форма власти перечня даёт базис в шкале 0..100", () => {
    // Полноту таблицы держит компилятор (Record<PowerStructure, number>);
    // тест проверяет, что ни одна запись не выпала из шкалы.
    for (const structure of POWER_STRUCTURES) {
      const base = corruptionBase(structure);
      expect(Number.isFinite(base)).toBe(true);
      expect(base).toBeGreaterThanOrEqual(0);
      expect(base).toBeLessThanOrEqual(COUNTRY_POLITICS_SCALE_MAX);
    }
  });

  it("формы власти не схлопнуты в одно значение", () => {
    const distinct = new Set(POWER_STRUCTURES.map(corruptionBase));
    expect(distinct.size).toBeGreaterThan(POWER_STRUCTURES.length / 2);
  });

  it("страна без размеченной формы власти получает фолбэк, а не ноль", () => {
    const fallback = corruptionBase(undefined);
    expect(Number.isFinite(fallback)).toBe(true);
    expect(fallback).toBeGreaterThan(0);
  });
});

describe("legitimacyBase — по координатам спектра", () => {
  it("консолидированная демократия легитимнее гибридного режима", () => {
    expect(legitimacyBase(CONSOLIDATED_DEMOCRACY, undefined))
      .toBeGreaterThan(legitimacyBase(HYBRID, undefined));
  });

  it("консолидированная автократия ТОЖЕ легитимнее гибридного режима", () => {
    // Ветвь, которой не было бы у линейной модели «чем демократичнее, тем
    // легитимнее»: у консолидированного полюса источник мандата есть, у
    // режима посередине не работает ни один.
    expect(legitimacyBase(CONSOLIDATED_AUTOCRACY, undefined))
      .toBeGreaterThan(legitimacyBase(HYBRID, undefined));
  });

  it("при равной консолидации демократический полюс легитимнее автократического", () => {
    expect(legitimacyBase(CONSOLIDATED_DEMOCRACY, undefined))
      .toBeGreaterThan(legitimacyBase(CONSOLIDATED_AUTOCRACY, undefined));
  });

  it("экономическая ось на базу не влияет", () => {
    // Заявление «никогда» из комментария у констант, закреплённое тестом:
    // плановая экономика сама по себе не делает власть менее правомочной.
    const planned = legitimacyBase({ economic: IDEOLOGY_AXIS_MIN, political: -0.9 }, undefined);
    const market = legitimacyBase({ economic: IDEOLOGY_AXIS_MAX, political: -0.9 }, undefined);
    expect(planned).toBe(market);
  });

  it("оккупационная и колониальная администрации имеют меньше мандата, чем та же точка спектра", () => {
    const own = legitimacyBase(CONSOLIDATED_DEMOCRACY, "competitive_multiparty");
    expect(legitimacyBase(CONSOLIDATED_DEMOCRACY, "occupation_administration")).toBeLessThan(own);
    expect(legitimacyBase(CONSOLIDATED_DEMOCRACY, "colonial_administration")).toBeLessThan(own);
  });

  it("наследственный двор легитимнее личного режима в той же точке спектра", () => {
    // Разные источники мандата при неразличимых координатах — ровно то, чего
    // не могла таблица по ярлыку (Саудовская Аравия и Испания Франко).
    expect(legitimacyBase(CONSOLIDATED_AUTOCRACY, "dynastic_court"))
      .toBeGreaterThan(legitimacyBase(CONSOLIDATED_AUTOCRACY, "personalist"));
  });

  it("неразмеченная форма власти даёт нулевую поправку, а не штраф", () => {
    const neutralStructures = POWER_STRUCTURES.filter(
      s => legitimacyBase(HYBRID, s) === legitimacyBase(HYBRID, undefined)
    );
    expect(neutralStructures.length).toBeGreaterThan(0);
    expect(legitimacyBase(HYBRID, undefined))
      .toBeGreaterThan(legitimacyBase(HYBRID, "occupation_administration"));
  });

  it("держится в шкале 0..100 на краях осей и любой форме власти", () => {
    for (const structure of [...POWER_STRUCTURES, undefined]) {
      for (const political of [IDEOLOGY_AXIS_MIN, 0, IDEOLOGY_AXIS_MAX]) {
        for (const economic of [IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX]) {
          const base = legitimacyBase({ economic, political }, structure);
          expect(Number.isFinite(base)).toBe(true);
          expect(base).toBeGreaterThanOrEqual(0);
          expect(base).toBeLessThanOrEqual(COUNTRY_POLITICS_SCALE_MAX);
        }
      }
    }
  });
});
