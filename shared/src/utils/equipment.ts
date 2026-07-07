import { type Country } from "../types/Country";
import { type EquipmentType } from "../types/military/EquipmentType";
import { getDomainTier } from "./technology";

/**
 * War Phase 2 (независимый гейм-дизайн разбор, 2026-07-06) — какой домен
 * технологий даёт "боевой буст" каждой категории техники. Жёстко привязано
 * к доменам эры 1946 (см. shared/src/data/eras.ts) — тот же принцип, что уже
 * принят для biology/industry (PopulationTick.ts/ResourceTick.ts) и
 * combined-arms (technology.ts): 1946 — единственный играбельный сценарий
 * сейчас, не обобщается на 1836/2000 без отдельного захода.
 */
const EQUIPMENT_DOMAIN_MAP: Record<EquipmentType, string> = {
  rifles: "infantry",
  artillery: "infantry",
  trucks: "industry",
  tanks: "armor",
  fighters: "aviation",
  bombers: "aviation",
  destroyers: "naval",
  submarines: "naval",
};

/** Бонус эффективности единицы техники за каждый тир соответствующего домена. */
const EQUIPMENT_TIER_BONUS = 0.1;

/**
 * Суммарная "боевая мощь" экипировки страны — количество единиц по каждой
 * категории, взвешенное эффективностью (растёт с тиром домена категории).
 * При нулевой технике (дефолт всех стран сейчас) — 0, не влияет на бой.
 */
export function getEquipmentPower(country: Country): number {
  let power = 0;
  for (const [type, count] of Object.entries(country.military.equipment)) {
    const domain = EQUIPMENT_DOMAIN_MAP[type as EquipmentType];
    const tier = getDomainTier(country.technology.domains[domain] ?? 0);
    power += count * (1 + tier * EQUIPMENT_TIER_BONUS);
  }
  return power;
}
