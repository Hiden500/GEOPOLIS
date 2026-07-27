import express from "express";
import { applyPrimitivesSchema, translateIntentSchema } from "../validation/schemas";
import { ValidationError, GameError, LLMProviderError } from "../errors/AppError";
import { getGame, setGame } from "../game/GameStore";
import { effectiveController } from "@shared/utils/regionControl";
import { GeminiProvider, toProviderSchema } from "../llm/providers/GeminiProvider";
import {
  buildPrimitiveTranslationPrompt,
  parsePrimitiveTranslation,
  primitiveTranslationSchema,
} from "../llm/primitiveTranslation";
import { buildPrimitivePreview } from "../primitives/outcomes";
import { applyPrimitiveTurn } from "../primitives/turnBatch";

const router = express.Router();
const geminiProvider = new GeminiProvider();
const TRANSLATION_RESPONSE_SCHEMA = toProviderSchema(primitiveTranslationSchema);

/**
 * Путь игрока к примитивам (docs/PRIMITIVES.md §1, гибридный интерфейс).
 *
 * Две ручки, потому что шагов ровно два и они разного класса:
 *   - `POST /translate` — ЧИСТЫЙ: зовёт модель, ничего не применяет и состояние
 *     партии не меняет. Возвращает распознанное для подтверждения;
 *   - `POST /apply` — применяет уже подтверждённое, через ту же границу хода,
 *     что и ответ модели (idempotency, отклик, история места).
 *
 * Разделение — не стилистика, а требование §1: игрок обязан увидеть, ЧТО понято,
 * до того как это случится. Слитая ручка «перевёл и сразу применил» лишала бы
 * его подтверждения, а перевод — единственное место в петле, где возможна
 * ошибка понимания.
 *
 * Быстрые кнопки интерфейса зовут `/apply` напрямую, минуя перевод: кнопка = уже
 * примитив, и рисковать переводом там не за чем.
 */

router.post("/translate", async (req, res) => {
  try {
    const game = getGame();
    if (!game) throw new GameError("No active game");

    const parsed = translateIntentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid intent input", parsed.error.issues);
    }

    // Выделение проверяется ДО модели, а не после. Промт описывает выделенный
    // регион как цель демонстративного приказа («подавить их здесь»); чужой
    // регион там означает, что модель добросовестно соберёт примитив, который
    // движок отклонит по предпосылке контроля, — вызов провайдера впустую и
    // отказ, объясняющий не то, что произошло на самом деле. Клиент чужой
    // регион в панель не пускает (`GameView.selectedOwnRegionId`), но ручка
    // обязана держать это сама: клиент — не граница доверия.
    const selectedRegionId = parsed.data.selectedRegionId;
    if (selectedRegionId !== undefined) {
      const region = game.regions.find(r => r.id === selectedRegionId);
      if (!region) {
        throw new ValidationError(`Region ${selectedRegionId} does not exist`);
      }
      if (effectiveController(region) !== game.playerCountryId) {
        throw new ValidationError(
          `Region ${selectedRegionId} is not controlled by ${game.playerCountryId}; ` +
            `orders can only target the player's own regions`
        );
      }
    }

    const prompt = buildPrimitiveTranslationPrompt(game, parsed.data.intent, selectedRegionId);
    const raw = await geminiProvider.generateResponse(prompt, TRANSLATION_RESPONSE_SCHEMA);
    const translation = parsePrimitiveTranslation(raw, game.playerCountryId);

    if ("error" in translation) {
      // Ответ модели не разобрался — это отказ провайдера по смыслу, а не
      // ошибка игрока: 502, состояние не тронуто.
      res.status(502).json({ error: translation.error });
      return;
    }

    res.json({
      primitives: translation.primitives,
      preview: buildPrimitivePreview(game, translation.primitives),
      invalid: translation.invalid,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
    } else if (error instanceof GameError) {
      res.status(404).json({ error: error.message });
    } else if (error instanceof LLMProviderError) {
      res.status(502).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.post("/apply", (req, res) => {
  try {
    const game = getGame();
    if (!game) throw new GameError("No active game");

    const parsed = applyPrimitivesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid primitives input", parsed.error.issues);
    }

    // Источник проверяется, а не переписывается молча. Через эту ручку игрок
    // действует только от своего имени; примитив с чужим источником — либо
    // ошибка клиента, либо попытка сыграть за другую страну, и в обоих случаях
    // честный отказ лучше тихой подмены (docs/CONCEPT.md §7.2, агентность).
    const foreign = parsed.data.primitives.find(p => p.sourceCountryId !== game.playerCountryId);
    if (foreign) {
      throw new ValidationError(
        `The player can only act as ${game.playerCountryId}, not as ${foreign.sourceCountryId}`
      );
    }

    const result = applyPrimitiveTurn(game, parsed.data.primitives, parsed.data.idempotencyKey);
    setGame(game);

    res.json({
      duplicate: result.duplicate,
      outcomes: result.outcomes,
      rejected: result.rejected.map(r => ({ verb: r.verb, reason: r.reason })),
    });
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
