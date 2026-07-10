import express from "express";
import { GameService } from "../services/GameService";
import { ScenarioRegistry } from "../scenarios/ScenarioRegistry";
import { createGameSchema, advanceTurnSchema, saveSlotSchema } from "../validation/schemas";
import { ValidationError, GameError, LLMGateError, SaveNotFoundError, SaveVersionError } from "../errors/AppError";

const router = express.Router();
const gameService = new GameService();

router.post("/start", (req, res) => {
  try {
    // Валидация входных данных
    const validationResult = createGameSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    const { scenarioId, playerCountryId, locale } = validationResult.data;

    // Проверка существования сценария
    if (!ScenarioRegistry[scenarioId as keyof typeof ScenarioRegistry]) {
      throw new ValidationError("Invalid scenario ID");
    }

    const game = gameService.createGame(scenarioId, playerCountryId, locale);
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
    const validationResult = advanceTurnSchema.safeParse(req.body ?? {});
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    const game = gameService.advanceMonth(validationResult.data.months);
    res.json(game);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof LLMGateError) {
      res.status(error.statusCode).json({ error: error.message });
    } else if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.post("/save", (req, res) => {
  try {
    const validationResult = saveSlotSchema.safeParse(req.body ?? {});
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    gameService.saveGame(validationResult.data.slot);
    res.json({ ok: true });
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

router.post("/load", (req, res) => {
  try {
    const validationResult = saveSlotSchema.safeParse(req.body ?? {});
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    const game = gameService.loadGame(validationResult.data.slot);
    res.json(game);
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof SaveNotFoundError) {
      res.status(error.statusCode).json({ error: error.message });
    } else if (error instanceof SaveVersionError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.get("/saves", (req, res) => {
  try {
    res.json(gameService.listSaves());
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/saves/:slot", (req, res) => {
  try {
    const validationResult = saveSlotSchema.safeParse({ slot: req.params.slot });
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    gameService.deleteSave(validationResult.data.slot);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof SaveNotFoundError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
