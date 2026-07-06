/**
 * Прогресс на один тир домена (docs/DECISIONS.md, 2026-07-06). Тюнингуемая
 * константа, как THREAT_LEVEL/WAR_LOSER_PENALTY и т.п.
 */
export const TIER_PROGRESS_THRESHOLD = 100;

/**
 * Тир домена выводится из накопленного прогресса, не хранится отдельно —
 * нет каталога именных технологий, порядок ("нельзя тир 5 без тир 1-4")
 * сохраняется автоматически, потому что это сумма, а не выбор из меню.
 */
export function getDomainTier(domainProgress: number): number {
  return Math.floor(Math.max(0, domainProgress) / TIER_PROGRESS_THRESHOLD);
}
