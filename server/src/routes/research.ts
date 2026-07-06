import express from "express";
import { CountryService } from "../services/CountryService";
import { ResearchService } from "../services/ResearchService";
import { GameError, CountryError } from "../errors/AppError";
import { getGame } from "../game/GameStore";

const router = express.Router();
const countryService = new CountryService();
const researchService = new ResearchService();

/**
 * Получает состояние технологий страны (тиры по доменам, текущее
 * распределение фокуса). Распределение фокуса меняется через PlayerIntent →
 * LLM 'research_shift' экшн (docs/DECISIONS.md, 2026-07-06), не через этот
 * роут — нет отдельного REST-эндпоинта для смены фокуса.
 */
router.get("/state", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    res.json(researchService.getTechnologyState(playerCountry));
  } catch (error) {
    if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
