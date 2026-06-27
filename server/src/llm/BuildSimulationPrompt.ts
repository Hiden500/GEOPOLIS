import { type GameState } from "@shared/types/GameState";
import { LLMService } from "../services/LLMService";

export function buildSimulationPrompt(
  game: GameState,
  playerActions: string[]
): string {
  const llmService = new LLMService(game);
  const basePrompt = llmService.generatePrompt();

  // Добавляем специфические действия игрока
  const actionsSection = `
## Specific Actions

### Player Actions
${playerActions.join("\n")}
`;

  return basePrompt + actionsSection;
}
