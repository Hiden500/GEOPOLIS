import { type GameState } from "@shared/types/GameState";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { getGame, setGame } from "../game/GameStore";
import { LLMGateError } from "../errors/AppError";

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
   * Гейт (docs/DECISIONS.md, 2026-07-06): отказывает, если LLM ещё не
   * ответила в текущем цикле — "LLM — главный двигатель" (docs/LLM_RULES.md),
   * ход не должен листаться без единого обращения к LLM.
   */
  advanceMonth(): GameState {
    const game = getGame();
    if (!game) {
      throw new Error("No active game");
    }

    if (!game.llmRespondedThisTurn) {
      throw new LLMGateError(
        "Ход недоступен: сначала получите ответ LLM (ручной или автоматический цикл)."
      );
    }

    simulateMonth(game);
    game.llmRespondedThisTurn = false;
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
