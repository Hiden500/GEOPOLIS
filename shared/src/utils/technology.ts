import { type Country } from "../types/Country";

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

/**
 * Военные домены эры 1946 (shared/src/data/eras.ts) — жёстко зашиты на эту
 * эру, как и biology/industry в PopulationTick.ts/ResourceTick.ts: 1946 —
 * единственный играбельный сценарий сейчас, другие эры используют другие
 * имена доменов (не обобщаем без отдельного захода).
 */
const MILITARY_DOMAINS = ["armor", "infantry", "aviation", "naval"];

/** Бонус к боевой силе за каждый тир САМОГО СЛАБОГО из военных доменов. */
const COMBINED_ARMS_BONUS_PER_MIN_TIER = 0.05;

/** Потолок мультипликатора — не даёт combined-arms бонусу расти неограниченно. */
const COMBINED_ARMS_MAX_MULTIPLIER = 2;

/**
 * Combined-arms бонус (независимый гейм-дизайн разбор, 2026-07-06) — награда
 * за широту вложений в военные домены, не за суммарный объём. Специально
 * Math.min, не среднее: страна получает бонус только если вложилась во ВСЕ
 * военные домены, не только в один (без каталога именных доктрин — тот же
 * принцип, что уже принят для технологий в целом).
 */
export function getCombinedArmsMultiplier(country: Country): number {
  const minTier = Math.min(
    ...MILITARY_DOMAINS.map(domain => getDomainTier(country.technology.domains[domain] ?? 0))
  );
  return Math.min(1 + minTier * COMBINED_ARMS_BONUS_PER_MIN_TIER, COMBINED_ARMS_MAX_MULTIPLIER);
}
