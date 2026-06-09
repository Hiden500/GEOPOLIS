import { type GameState } from "@shared/types/GameState";
import { type CountryAction } from "../ai/CountryAction";

export function buildSimulationPrompt(
  game: GameState,
  playerActions: string[],
  worldActions: CountryAction[]
): string {

  return `
Дата:
${game.currentDate}

Игрок:

${playerActions.join("\n")}

Действия других стран:

${worldActions
  .map(
    a =>
      `${a.countryId}: ${a.description}`
  )
  .join("\n")
}

Сымитируй события следующего периода.
Верни JSON.
`;
}