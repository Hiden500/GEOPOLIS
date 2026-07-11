import { type GameState } from "@shared/types/GameState";
import { WarService } from "../services/WarService";
import { type CommandResult } from "./types";

/**
 * Обёртка WarService.declareWar (идемпотентна) — используется LLM-действием
 * "war" и AiBehaviorTick.applyWarThreshold (Правило D).
 */
export function declareWar(game: GameState, initiatorId: string, targetId: string, warGoal?: string): CommandResult {
  if (!game.countries.some(c => c.id === initiatorId) || !game.countries.some(c => c.id === targetId)) {
    return { success: false, error: `Unknown country: ${initiatorId} or ${targetId}` };
  }

  new WarService(game).declareWar(initiatorId, targetId, warGoal);
  return { success: true };
}

/**
 * Ищет активную войну между двумя странами и завершает её миром — тот же
 * поиск, что раньше делал LLMService.applyPeaceAction инлайн. Используется
 * LLM-действием "peace".
 */
export function makePeaceBetween(game: GameState, countryAId: string, countryBId: string): CommandResult {
  const warService = new WarService(game);
  const war = warService.getActiveWarBetween(countryAId, countryBId);
  if (!war) {
    return { success: false, error: `No active war between ${countryAId} and ${countryBId}` };
  }

  warService.makePeace(war.id);
  return { success: true };
}
