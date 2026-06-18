import { type GameState } from "@shared/types/GameState";
import { simulateMonth } from "../simulation/SimulationEngine";

/**
 * Сервис для управления симуляцией.
 * Отвечает за запуск и контроль симуляции мира.
 */
export class SimulationService {
  /**
   * Выполняет один месяц симуляции.
   */
  simulateMonth(game: GameState): GameState {
    simulateMonth(game);
    return game;
  }

  /**
   * Выполняет несколько месяцев симуляции.
   */
  simulateMonths(game: GameState, months: number): GameState {
    for (let i = 0; i < months; i++) {
      simulateMonth(game);
    }
    return game;
  }

  /**
   * Проверяет, можно ли выполнить симуляцию.
   */
  canSimulate(game: GameState): boolean {
    return game !== null && game.countries.length > 0 && game.regions.length > 0;
  }
}
