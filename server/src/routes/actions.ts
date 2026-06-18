import express from "express";
import { GameService } from "../services/GameService";
import { playerActionSchema } from "../validation/schemas";
import { ValidationError, GameError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";

const router = express.Router();
const gameService = new GameService();

/**
 * Создаёт новое действие игрока.
 */
router.post("/actions", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    // Валидация входных данных
    const validationResult = playerActionSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new ValidationError("Invalid action input", validationResult.error.issues);
    }

    const action = validationResult.data;

    // Генерируем title и description на основе типа действия
    const titles: Record<string, string> = {
      build_factory: "Строительство завода",
      build_mine: "Строительство шахты",
      build_infrastructure: "Строительство инфраструктуры",
      recruit_units: "Набор подразделений"
    };

    const descriptions: Record<string, string> = {
      build_factory: "Строительство нового промышленного предприятия",
      build_mine: "Разработка нового месторождения ресурсов",
      build_infrastructure: "Улучшение инфраструктуры региона",
      recruit_units: "Формирование новых военных подразделений"
    };

    // Добавляем действие в список действий игрока
    const newAction: any = {
      id: `action-${Date.now()}`,
      type: action.type,
      regionId: action.regionId,
      title: titles[action.type] || "Действие",
      description: descriptions[action.type] || "",
      createdAt: new Date().toISOString()
    };

    if (action.parameters) {
      newAction.parameters = action.parameters;
    }

    game.playerActions.push(newAction);

    setGame(game);
    res.json({ success: true, action });
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

/**
 * Получает список действий игрока.
 */
router.get("/actions", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    res.json(game.playerActions);
  } catch (error) {
    if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Удаляет действие игрока по ID.
 */
router.delete("/actions/:id", (req, res) => {
  try {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    const { id } = req.params;
    const actionIndex = game.playerActions.findIndex(a => a.id === id);

    if (actionIndex === -1) {
      throw new GameError("Action not found");
    }

    game.playerActions.splice(actionIndex, 1);
    setGame(game);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
