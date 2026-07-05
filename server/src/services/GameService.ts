import { type GameState } from "@shared/types/GameState";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { getGame, setGame } from "../game/GameStore";

/**
 * Сервис для управления игрой.
 * Содержит бизнес-логику создания, загрузки и выполнения симуляции.
 */
export class GameService {
  /**
   * Создаёт новую игру по сценарию.
   */
  createGame(scenarioId: string, playerCountryId: string, locale?: Locale): GameState {
    const game = createGame(scenarioId as any, playerCountryId, locale);
    setGame(game);
    return game;
  }

  /**
   * Выполняет один месяц симуляции.
   */
  advanceMonth(): GameState {
    const game = getGame();
    if (!game) {
      throw new Error("No active game");
    }

    simulateMonth(game);
    setGame(game);
    return game;
  }

  /**
   * Получает текущее состояние игры.
   */
  getCurrentGame(): GameState | null {
    return getGame();
  }

  /**
   * Удаляет игру из хранилища.
   */
  deleteGame(): void {
    setGame(null as any);
  }
}
