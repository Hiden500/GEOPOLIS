import express from "express";
import { playerIntentSchema } from "../validation/schemas";
import { ValidationError, GameError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";

const router = express.Router();

/**
 * Сохраняет намерение игрока на текущий ход свободным текстом
 * (docs/DECISIONS.md, 2026-07-04). Уходит в LLM-промт следующего цикла,
 * очищается движком после успешного processResponse — не история.
 */
router.put("/", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const validationResult = playerIntentSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid intent input", validationResult.error.issues);
    }

    game.playerIntent = validationResult.data.intent;
    setGame(game);

    res.json({ success: true, intent: game.playerIntent });
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
