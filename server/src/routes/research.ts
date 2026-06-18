import express from "express";
import { GameService } from "../services/GameService";
import { CountryService } from "../services/CountryService";
import { startResearchSchema } from "../validation/schemas";
import { ValidationError, GameError, CountryError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";

const router = express.Router();
const gameService = new GameService();
const countryService = new CountryService();

/**
 * Запускает исследование технологии.
 */
router.post("/start", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    // Валидация входных данных
    const validationResult = startResearchSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid research input", validationResult.error.issues);
    }

    const { projectId } = validationResult.data;

    // Находим страну игрока
    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    // Проверяем, что проект ещё не исследуется
    const existingProject = playerCountry.technology.projects.find(p => p.technologyId === projectId);
    if (existingProject) {
      throw new ValidationError("Project already being researched");
    }

    // Проверяем, что технология ещё не исследована
    if (playerCountry.researchedTechnologyIds.includes(projectId)) {
      throw new ValidationError("Technology already researched");
    }

    // Создаём новый проект
    const newProject = {
      id: `project-${Date.now()}`,
      technologyId: projectId,
      name: `Research ${projectId}`,
      domain: "Research",
      progress: 0,
      requiredProgress: 100,
      progressPerMonth: 10,
      cost: playerCountry.economy.researchSpending,
      requiredTechnologyIds: [],
      requiredResources: {},
      startDate: new Date().toISOString(),
      estimatedMonths: 10,
      completed: false
    };

    playerCountry.technology.projects.push(newProject);
    setGame(game);

    res.json({ success: true, project: newProject });
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
 * Останавливает исследование.
 */
router.post("/stop/:projectId", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const { projectId } = req.params;

    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    const projectIndex = playerCountry.technology.projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) {
      throw new GameError("Project not found");
    }

    playerCountry.technology.projects.splice(projectIndex, 1);
    setGame(game);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Получает список активных исследований.
 */
router.get("/active", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const playerCountry = countryService.findCountryById(game.countries, game.playerCountryId);
    if (!playerCountry) {
      throw new CountryError("Player country not found");
    }

    res.json(playerCountry.technology.projects);
  } catch (error) {
    if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Получает состояние технологий страны.
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

    res.json({
      domains: playerCountry.technology.domains,
      researchedIds: playerCountry.researchedTechnologyIds,
      projects: playerCountry.technology.projects
    });
  } catch (error) {
    if (error instanceof GameError || error instanceof CountryError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
