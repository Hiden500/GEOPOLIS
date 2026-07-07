import { type GameState } from "../types/GameState";
import { type HistoricalHingePoint, type Precondition } from "../types/HistoricalHingePoint";

/**
 * Сколько раз подсказка развилки может попасть в промт, прежде чем перестать
 * показываться (независимо от того, ещё ли открыто окно) — независимый
 * гейм-дизайн разбор, 2026-07-06. Компромисс между "может быть пропущена за
 * один показ" и "показывается каждый месяц, засоряя промт" — несколько
 * попыток, не бесконечно.
 */
export const MAX_HINGE_POINT_SHOWS = 3;

function isPreconditionMet(game: GameState, condition: Precondition): boolean {
  switch (condition.type) {
    case "relationBelow": {
      const country = game.countries.find(c => c.id === condition.a);
      return (country?.diplomacy.relations[condition.b] ?? 0) < condition.threshold;
    }
    case "relationAbove": {
      const country = game.countries.find(c => c.id === condition.a);
      return (country?.diplomacy.relations[condition.b] ?? 0) > condition.threshold;
    }
    case "noGuaranteeFrom": {
      const guarantor = game.countries.find(c => c.id === condition.guarantor);
      return !(guarantor?.diplomacy.guarantees.includes(condition.target) ?? false);
    }
    case "stabilityBelow": {
      const country = game.countries.find(c => c.id === condition.country);
      return (country?.politics.stability ?? 100) < condition.threshold;
    }
  }
}

/**
 * Развилки, доступные для показа в текущем цикле: дата внутри окна, ВСЕ
 * предусловия выполнены, ещё не исчерпан лимит показов (MAX_HINGE_POINT_SHOWS).
 * Не мутирует game — только читает; инкремент showCount — на вызывающей
 * стороне (LLMService), только когда подсказка реально попала в промт.
 */
export function getEligibleHingePoints(
  game: GameState,
  catalog: HistoricalHingePoint[]
): HistoricalHingePoint[] {
  const currentPeriod = game.currentDate.slice(0, 7); // "YYYY-MM"

  return catalog.filter(hp => {
    if (!hp.representable) return false;
    if (currentPeriod < hp.windowStart || currentPeriod > hp.windowEnd) return false;
    if ((game.hingePointShowCount[hp.id] ?? 0) >= MAX_HINGE_POINT_SHOWS) return false;
    return hp.preconditions.every(condition => isPreconditionMet(game, condition));
  });
}
