import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type StrategicGoal } from "@shared/types/GrandStrategy";
import { computePlayerStanding } from "@shared/utils/nationalPower";
import { getDomainTier } from "@shared/utils/technology";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";

/**
 * Целевой слой (docs/OBJECTIVES.md, план 11 категория B). Вызывается в конце
 * simulateMonth, после агрегации и боевых тиков — чтобы позиция и оценка целей
 * отражали состояние страны на конец месяца.
 *
 * 1. Пересчитывает позицию игрока в мировом рейтинге силы (обратная связь).
 * 2. Оценивает самопоставленные цели игрока (детерминированно, без LLM) и
 *    ставит `completed` + мировой факт при выполнении.
 */
export function objectiveTick(game: GameState): void {
  game.playerStanding = computePlayerStanding(
    game.countries,
    game.playerCountryId,
    game.regions
  );

  evaluatePlayerGoals(game);
}

function evaluatePlayerGoals(game: GameState): void {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  if (!player) return;

  for (const goal of player.goals) {
    if (goal.completed) continue;
    if (isGoalMet(game, player, goal)) {
      goal.completed = true;
      game.pendingWorldFacts.push({
        countryId: player.id,
        kind: "objective_completed",
        text: `${getText(player.name, LLM_LOCALE)} achieved its strategic goal: ${goalLabel(goal)}`,
      });
    }
  }
}

/** Детерминированная проверка цели по уже трекаемому состоянию. */
function isGoalMet(game: GameState, player: Country, goal: StrategicGoal): boolean {
  switch (goal.kind) {
    case "reach_gdp":
      return player.economy.gdp >= goal.target;
    case "reach_power_rank":
      // rank 0 — ещё не посчитан; иначе 1 (сильнейший) ≤ целевого места.
      return game.playerStanding.rank >= 1 && game.playerStanding.rank <= goal.targetRank;
    case "control_regions":
      // Легальное владение (аннексированное считается, оккупированное — нет:
      // цель про устойчивый контроль, не про временный фронт).
      return game.regions.filter(r => r.ownerCountryId === player.id).length >= goal.targetCount;
    case "reach_tech_tier":
      return getDomainTier(player.technology.domains[goal.domain] ?? 0) >= goal.targetTier;
  }
}

function goalLabel(goal: StrategicGoal): string {
  if (goal.title) return goal.title;
  switch (goal.kind) {
    case "reach_gdp":
      return `reach $${(goal.target / 1e9).toFixed(0)}B GDP`;
    case "reach_power_rank":
      return `become a top-${goal.targetRank} world power`;
    case "control_regions":
      return `control ${goal.targetCount} regions`;
    case "reach_tech_tier":
      return `reach ${goal.domain} technology tier ${goal.targetTier}`;
  }
}
