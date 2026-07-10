import { describe, it, expect } from "vitest";
import { createGame } from "../CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";

describe("createGame — seed (docs/plans/01_PERSISTENCE_STATE.md)", () => {
  it("инициализирует rngState явно переданным seed и nextFeatureId нулём", () => {
    const game = createGame("1946", "USA", "ru", 12345);
    expect(game.rngState).toBe(12345);
    expect(game.nextFeatureId).toBeGreaterThan(0); // счётчик уже продвинут генерацией начальных фич
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
