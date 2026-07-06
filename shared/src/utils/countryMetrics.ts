import { type Country } from "../types/Country";
import { type Region } from "../types/map/Region";

/**
 * ВВП на душу населения (docs/DECISIONS.md, 2026-07-06) — тривиальная
 * производная, оба входа уже трекаются движком. Не хранится отдельно.
 */
export function getGdpPerCapita(country: Country): number {
  if (country.population <= 0) return 0;
  return country.economy.gdp / country.population;
}

/**
 * Калибровка "благосостояния" — США 1946 в игровых единицах (~0.12T ВВП /
 * 141M населения ≈ 850/чел) как ориентир "средней крупной державы", не
 * абсолютная истина — тюнингуемая константа, как THREAT_LEVEL и т.п.
 */
const GDP_PER_CAPITA_REFERENCE = 850;

/**
 * Доля дохода на welfare, соответствующая полному баллу компонента —
 * доктрины экономики сейчас закладывают welfare до ~0.30 (см.
 * economyArchetypes.ts), поэтому ориентируемся на этот потолок.
 */
const MAX_EXPECTED_WELFARE_SHARE = 0.3;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function totalIncome(country: Country): number {
  const e = country.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/**
 * "Благосостояние/уровень жизни" (docs/DECISIONS.md, 2026-07-06) — отдельная
 * от politics.legitimacy ось: авторитарный режим может иметь высокий
 * уровень жизни при просевшей легитимности, и наоборот. Композит (0-100) из
 * уже трекаемых величин, ничего нового не авторится по стране:
 * ВВП/чел (50%), доля дохода на welfare (20%), средняя урбанизация и
 * инфраструктура регионов страны (по 15%).
 */
export function getLivingStandardIndex(country: Country, regions: Region[]): number {
  const gdpPerCapita = getGdpPerCapita(country);
  const gdpComponent = clampPercent((gdpPerCapita / GDP_PER_CAPITA_REFERENCE) * 100);

  const income = totalIncome(country);
  const welfareShare = income > 0 ? country.economy.welfareSpending / income : 0;
  const welfareComponent = clampPercent((welfareShare / MAX_EXPECTED_WELFARE_SHARE) * 100);

  const ownedRegions = regions.filter(r => r.ownerCountryId === country.id);
  const avgUrbanization = average(ownedRegions.map(r => r.urbanization));
  const avgInfrastructure = average(ownedRegions.map(r => r.infrastructure));

  return (
    gdpComponent * 0.5 +
    welfareComponent * 0.2 +
    avgUrbanization * 100 * 0.15 +
    avgInfrastructure * 100 * 0.15
  );
}
