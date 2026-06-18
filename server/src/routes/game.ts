import express from "express";
import { GameService } from "../services/GameService";
import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { createGameSchema } from "../validation/schemas";
import { ValidationError, GameError } from "../errors/AppError";

const router = express.Router();
const gameService = new GameService();

router.post("/start", (req, res) => {
  try {
    // Валидация входных данных
    const validationResult = createGameSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    const { scenarioId, playerCountryId } = validationResult.data;

    // Проверка существования сценария
    if (!ScenarioRegistry[scenarioId as keyof typeof ScenarioRegistry]) {
      throw new ValidationError("Invalid scenario ID");
    }

    const game = gameService.createGame(scenarioId, playerCountryId);
    res.json(game);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof GameError) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.get("/state", (req, res) => {
  try {
    const game = gameService.getCurrentGame();
    if (!game) {
      throw new GameError("No active game");
    }
    res.json(game);
  } catch (error) {
    if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.post("/next-turn", (req, res) => {
  try {
    const game = gameService.advanceMonth();
    res.json(game);
  } catch (error) {
    if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
