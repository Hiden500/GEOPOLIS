import { describe, it, expect } from "vitest";
import { createGame } from "../CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";
import { AI_TRAIT_MIN, AI_TRAIT_MAX } from "@shared/defines/ai";

describe("createGame — seed (docs/plans/01_PERSISTENCE_STATE.md)", () => {
  it("продвигает rngState посевом aiTraits (не равен сырому seed) и инициализирует nextFeatureId", () => {
    const game = createGame("1946", "USA", "ru", 12345);
    // rngState больше не равен сырому seed — посев aiTraits (docs/AI_RULES.md)
    // продвигает его на 2 вызова nextRandom на страну, чтобы следующий реальный
    // потребитель game.rng не начинал с того же состояния молча.
    expect(game.rngState).not.toBe(12345);
    expect(game.nextFeatureId).toBeGreaterThan(0); // счётчик уже продвинут генерацией начальных фич
  });

  it("сеет aiTraits каждой стране в диапазоне [AI_TRAIT_MIN, AI_TRAIT_MAX], не все одинаковые", () => {
    const game = createGame("1946", "USA", "ru", 12345);

    for (const country of game.countries) {
      expect(country.aiTraits.aggressiveness).toBeGreaterThanOrEqual(AI_TRAIT_MIN);
      expect(country.aiTraits.aggressiveness).toBeLessThanOrEqual(AI_TRAIT_MAX);
      expect(country.aiTraits.riskTolerance).toBeGreaterThanOrEqual(AI_TRAIT_MIN);
      expect(country.aiTraits.riskTolerance).toBeLessThanOrEqual(AI_TRAIT_MAX);
    }

    const distinctAggressiveness = new Set(game.countries.map(c => c.aiTraits.aggressiveness));
    expect(distinctAggressiveness.size).toBeGreaterThan(1); // реальная вариативность, не константа на всех
  });

  it("одинаковый seed даёт идентичные aiTraits (детерминизм посева)", () => {
    const gameA = createGame("1946", "USA", "ru", 999);
    const gameB = createGame("1946", "USA", "ru", 999);

    expect(gameA.countries.map(c => c.aiTraits)).toEqual(gameB.countries.map(c => c.aiTraits));
    expect(gameA.rngState).toBe(gameB.rngState);
  });

  it(
    "два прогона симуляции с одним seed дают идентичное состояние (глубокое сравнение) — " +
      "критерий приёмки плана 01, покрывает и fitness-функцию правила 5(б) детерминизма",
    () => {
      const MONTHS = 12;

      const gameA = createGame("1946", "USA", "ru", 42);
      for (let i = 0; i < MONTHS; i++) simulateMonth(gameA);

      const gameB = createGame("1946", "USA", "ru", 42);
      for (let i = 0; i < MONTHS; i++) simulateMonth(gameB);

      expect(gameA).toEqual(gameB);
    }
  );

  it("разные seed могут давать разные id для сгенерированных фич не гарантированно, но nextFeatureId одинаково детерминирован по одному seed", () => {
    const gameA = createGame("1946", "USA", "ru", 7);
    const gameB = createGame("1946", "USA", "ru", 7);

    expect(gameA.nextFeatureId).toBe(gameB.nextFeatureId);
    expect(gameA.mapFeatures.map(f => f.id)).toEqual(gameB.mapFeatures.map(f => f.id));
  });
});
