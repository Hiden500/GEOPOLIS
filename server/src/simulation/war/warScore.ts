import { type War } from "@shared/types/War";
import {
  WARSCORE_PER_NET_FLIP,
  WARSCORE_CASUALTY_WEIGHT,
  WARSCORE_DECISIVE_THRESHOLD,
  WARSCORE_WINNING_THRESHOLD,
} from "@shared/defines/war";

/**
 * warScore (docs/plans/08_WAR_WAVE1.md, Шаг 2a) — чистая функция, НЕ хранимое
 * поле War. Производное состояние (флипы + потери уже в War) не дублируется в
 * GameState: считается на месте в промте LLM и при заключении мира (Шаг 2b),
 * не рискует рассинхроном. Диапазон −100..100 от лица атакующих:
 * + = атакующие впереди, − = обороняющиеся впереди, 0 = равновесие.
 */
export function computeWarScore(war: War): number {
  const flipDiff = war.territoryFlips.toAttackers - war.territoryFlips.toDefenders;
  const territory = flipDiff * WARSCORE_PER_NET_FLIP;

  const attackerCasualties = sumSideCasualties(war, war.attackers);
  const defenderCasualties = sumSideCasualties(war, war.defenders);
  const totalCasualties = attackerCasualties + defenderCasualties;

  // Кто пролил меньше крови относительно врага — в плюсе. Обороняющиеся
  // потеряли больше → положительно (преимущество атакующих).
  const casualtyBalance = totalCasualties > 0
    ? ((defenderCasualties - attackerCasualties) / totalCasualties) * WARSCORE_CASUALTY_WEIGHT
    : 0;

  return clamp(Math.round(territory + casualtyBalance), -100, 100);
}

/** Суммарные потери одной стороны (сумма War.casualties по её странам). */
export function sumSideCasualties(war: War, sideIds: string[]): number {
  return sideIds.reduce((sum, id) => sum + (war.casualties[id] ?? 0), 0);
}

/**
 * Ярлык исхода для промта LLM по warScore — грубая шкала «кто и насколько
 * впереди», чтобы модель предлагала соразмерный мир, не выдумывая по цифре.
 */
export function warScoreLabel(score: number): string {
  if (score >= WARSCORE_DECISIVE_THRESHOLD) return "attackers decisively winning";
  if (score >= WARSCORE_WINNING_THRESHOLD) return "attackers winning";
  if (score > -WARSCORE_WINNING_THRESHOLD) return "roughly even";
  if (score > -WARSCORE_DECISIVE_THRESHOLD) return "defenders winning";
  return "defenders decisively winning";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
