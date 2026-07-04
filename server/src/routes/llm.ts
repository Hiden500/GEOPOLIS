import express from "express";
import { GameService } from "../services/GameService";
import { LLMService } from "../services/LLMService";
import { llmResponseSchema } from "../validation/schemas";
import { ValidationError, GameError } from "../errors/AppError";

const router = express.Router();
const gameService = new GameService();

/**
 * Ручной LLM-цикл, шаг 1: отдать промт для копирования в внешнюю LLM.
 * Промт сохраняется в game.llmContext.
 */
router.get("/prompt", (req, res) => {
  try {
    const game = gameService.getCurrentGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const llmService = new LLMService(game);
    const prompt = llmService.generatePrompt();
    llmService.savePrompt(prompt);

    res.json({ prompt, llmTurn: game.llmTurn ?? 0 });
  } catch (error) {
    if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Ручной LLM-цикл, шаг 2: принять вставленный ответ LLM,
 * провалидировать и применить (LLMService.processResponse).
 * Невалидная структура — 400 с причиной, ничего не применяется.
 */
router.post("/response", (req, res) => {
  try {
    const validationResult = llmResponseSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid input", validationResult.error.issues);
    }

    const game = gameService.getCurrentGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const llmService = new LLMService(game);
    const result = llmService.processResponse(validationResult.data.response);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result);
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
