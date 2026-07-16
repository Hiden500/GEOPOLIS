import { type GameState, type LastTurnReport, type TurnReportMetric } from "@shared/types/GameState";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { getGame, setGame } from "../game/GameStore";
import * as SaveService from "../game/SaveService";
import { type SaveSlotMeta } from "../game/SaveService";
import { GameError, LLMGateError } from "../errors/AppError";

/**
 * Слот автосейва (docs/plans/01_PERSISTENCE_STATE.md) — перезаписывается
 * после каждого успешного хода.
 */
const AUTOSAVE_SLOT = "autosave";

const TURN_REPORT_METRICS: TurnReportMetric[] = [
  "power",
  "rank",
  "gdp",
  "treasury",
  "population",
  "stability",
  "legitimacy",
  "regions",
];

type TurnSnapshot = Record<TurnReportMetric, number> & {
  date: string;
  completedGoalIds: Set<string>;
};

function takeTurnSnapshot(game: GameState): TurnSnapshot | null {
  const country = game.countries.find(candidate => candidate.id === game.playerCountryId);
  if (!country) {
    return null;
  }

  return {
    date: game.currentDate,
    power: game.playerStanding.power,
    rank: game.playerStanding.rank,
    gdp: country.economy.gdp,
    treasury: country.economy.treasury,
    population: country.population,
    stability: country.politics.stability,
    legitimacy: country.politics.legitimacy,
    regions: game.regions.reduce(
      (count, region) => count + (region.ownerCountryId === game.playerCountryId ? 1 : 0),
      0,
    ),
    completedGoalIds: new Set(country.goals.filter(goal => goal.completed).map(goal => goal.id)),
  };
}

function buildLastTurnReport(before: TurnSnapshot, after: TurnSnapshot, months: number): LastTurnReport {
  return {
    fromDate: before.date,
    toDate: after.date,
    months,
    changes: TURN_REPORT_METRICS.flatMap(metric =>
      Object.is(before[metric], after[metric])
        ? []
        : [{ metric, before: before[metric], after: after[metric] }],
    ),
    completedGoalIds: [...after.completedGoalIds].filter(id => !before.completedGoalIds.has(id)),
  };
}

/**
 * Сервис для управления игрой.
 * Содержит бизнес-логику создания, загрузки и выполнения симуляции.
 */
export class GameService {
  /**
   * Создаёт новую игру по сценарию.
   */
  createGame(scenarioId: string, playerCountryId: string, locale?: Locale): GameState {
    const game = createGame(scenarioId as any, playerCountryId, locale);
    setGame(game);
    return game;
  }

  /**
   * Выполняет `months` месяцев симуляции подряд (переменная длина хода,
   * docs/DECISIONS.md, 2026-07-05: тики остаются месячными, длина хода —
   * каденция решений, не новый шаг симуляции).
   * Гейт (docs/DECISIONS.md, 2026-07-06): отказывает, если LLM ещё не
   * ответила в текущем цикле — "LLM — главный двигатель" (docs/LLM_RULES.md).
   * Один ответ LLM разблокирует весь мульти-месячный ход: гейт проверяется
   * один раз на входе, флаг сбрасывается один раз в конце.
   */
  advanceMonth(months: number = 1): GameState {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }

    if (!game.llmRespondedThisTurn) {
      throw new LLMGateError(
        "Ход недоступен: сначала получите ответ LLM (ручной или автоматический цикл)."
      );
    }

    const before = takeTurnSnapshot(game);

    for (let i = 0; i < months; i++) {
      simulateMonth(game);
    }
    const after = takeTurnSnapshot(game);
    if (before && after) {
      game.lastTurnReport = buildLastTurnReport(before, after, months);
    }
    game.llmRespondedThisTurn = false;
    setGame(game);

    // Автосейв (docs/plans/01_PERSISTENCE_STATE.md): перезаписываемый слот
    // после каждого успешного хода — рестарт сервера не теряет кампанию.
    SaveService.saveGame(game, AUTOSAVE_SLOT);

    return game;
  }

  /**
   * Получает текущее состояние игры.
   */
  getCurrentGame(): GameState | null {
    return getGame();
  }

  /**
   * Удаляет игру из хранилища.
   */
  deleteGame(): void {
    setGame(null as any);
  }

  /**
   * Сохраняет текущую игру в именованный слот.
   */
  saveGame(slot: string): void {
    const game = getGame();
    if (!game) {
      throw new GameError("No active game");
    }
    SaveService.saveGame(game, slot);
  }

  /**
   * Загружает игру из слота и делает её текущей.
   */
  loadGame(slot: string): GameState {
    const game = SaveService.loadGame(slot);
    setGame(game);
    return game;
  }

  /**
   * Список слотов сейвов с метаданными.
   */
  listSaves(): SaveSlotMeta[] {
    return SaveService.listSaves();
  }

  /**
   * Удаляет слот сейва.
   */
  deleteSave(slot: string): void {
    SaveService.deleteSave(slot);
  }
}
