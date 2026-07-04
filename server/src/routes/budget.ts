import express from "express";
import { GameService } from "../services/GameService";
import { CountryService } from "../services/CountryService";
import { updateBudgetSchema } from "../validation/schemas";
import { ValidationError, GameError, CountryError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";

const router = express.Router();
const gameService = new GameService();
const countryService = new CountryService();

/**
 * Обновляет бюджет страны.
 */
router.put("/", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    // Валидация входных данных
    const validationResult = updateBudgetSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid budget input", validationResult.error.issues);
    }

    const budgetUpdate = validationResult.data;

    // Находим страну игрока
    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    const economy = countryService.updateBudget(playerCountry, budgetUpdate);

    setGame(game);
    res.json({ success: true, budget: economy });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Получает текущий бюджет страны.
 */
router.get("/", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    res.json(playerCountry.economy);
  } catch (error) {
    if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
