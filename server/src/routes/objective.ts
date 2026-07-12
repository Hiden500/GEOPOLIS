import express from "express";
import { setGoalsSchema } from "../validation/schemas";
import { ValidationError, GameError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";
import { setPlayerGoals } from "../commands/objective";
import { type StrategicGoal } from "@shared/types/GrandStrategy";

const router = express.Router();

/**
 * Устанавливает самопоставленные цели игрока (docs/OBJECTIVES.md). Заменяет
 * весь список; движок оценит выполнение на ближайшем ходу (ObjectiveTick).
 * `completed` не принимается — им владеет движок (сбрасывается в false).
 */
router.put("/goals", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const validationResult = setGoalsSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid goals input", validationResult.error.issues);
    }

    // completed добавляется командой (false); вход его не несёт.
    const goals = validationResult.data.goals.map(g => ({ ...g, completed: false })) as StrategicGoal[];
    const result = setPlayerGoals(game, goals);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    setGame(game);

    const player = game.countries.find(c => c.id === game.playerCountryId);
    res.json({ success: true, goals: player?.goals ?? [] });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
