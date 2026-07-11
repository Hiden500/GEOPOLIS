import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { getDomainTier } from "@shared/utils/technology";
import {
  RESEARCH_SPENDING_SCALE,
  TIER_SLOWDOWN_PER_TIER,
  RESEARCH_CENTER_DEVELOPMENT_THRESHOLD,
  RESEARCH_CENTER_BONUS_RATE,
  RESEARCH_EDUCATION_BONUS_MULTIPLIER,
} from "@shared/defines/research";

/**
 * Прогресс по доменам технологий (docs/DECISIONS.md, 2026-07-06) — без
 * каталога именных технологий. Игрок/LLM направляют долю researchSpending
 * по доменам через `technology.researchAllocation`
 * (LLMService.applyResearchShiftAction); домены без явной доли делят
 * оставшуюся долю поровну — детерминированный дефолт для стран, которых
 * LLM не направляет каждый цикл. Баланс-константы — shared/src/defines/research.ts.
 */
export function researchTick(country: Country, regions: Region[]): void {
  const economy = country.economy;
  if (economy.researchSpending <= 0) return;

  const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

  // Подсчёт исследовательских центров (упрощённо: регионы с высоким development).
  const researchCenters = countryRegions.filter(r => r.development > RESEARCH_CENTER_DEVELOPMENT_THRESHOLD).length;
  const researchCenterBonus = 1 + researchCenters * RESEARCH_CENTER_BONUS_RATE;

  // Бонус от образования (страна без территории — gdp=0 — не получает
  // бонус, не NaN; см. EconomyTick.ts, та же защита).
  const educationRatio = economy.gdp > 0 ? economy.educationSpending / economy.gdp : 0;
  const educationBonus = 1 + educationRatio * RESEARCH_EDUCATION_BONUS_MULTIPLIER;

  const totalResearchBonus = researchCenterBonus * educationBonus;

  const domains = Object.keys(country.technology.domains);
  if (domains.length === 0) return;

  const allocation = country.technology.researchAllocation ?? {};
  const explicitShareSum = domains.reduce((sum, d) => sum + (allocation[d] ?? 0), 0);
  const unallocatedDomains = domains.filter(d => allocation[d] === undefined);
  const remainingShare = Math.max(0, 1 - explicitShareSum);
  const evenShare = unallocatedDomains.length > 0 ? remainingShare / unallocatedDomains.length : 0;

  for (const domain of domains) {
    const share = allocation[domain] ?? evenShare;
    if (share <= 0) continue;

    const currentProgress = country.technology.domains[domain] ?? 0;
    const currentTier = getDomainTier(currentProgress);
    const slowdown = 1 + currentTier * TIER_SLOWDOWN_PER_TIER;

    const gain =
      ((economy.researchSpending * share) / RESEARCH_SPENDING_SCALE) * totalResearchBonus / slowdown;

    country.technology.domains[domain] = currentProgress + gain;
  }
}
