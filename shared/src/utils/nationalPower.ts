import { type Country } from "../types/Country";
import { type Region } from "../types/map/Region";
import { getDomainTier, getCombinedArmsMultiplier } from "./technology";
import { getEquipmentPower } from "./equipment";
import { EQUIPMENT_STRENGTH_WEIGHT } from "../defines/war";
import {
  POWER_GDP_SCALE,
  POWER_MILITARY_SCALE,
  POWER_POPULATION_SCALE,
  POWER_WEIGHT_GDP,
  POWER_WEIGHT_MILITARY,
  POWER_WEIGHT_POPULATION,
  POWER_WEIGHT_TECHNOLOGY,
} from "../defines/objective";

/**
 * Военная сила страны — та же мера, что WarTick.sideStrength (activePersonnel ×
 * combined-arms бонус + вклад техники), чтобы «сила на карте» и «сила в рейтинге»
 * не расходились.
 */
function militaryStrength(country: Country): number {
  return (
    country.military.activePersonnel * getCombinedArmsMultiplier(country) +
    getEquipmentPower(country) * EQUIPMENT_STRENGTH_WEIGHT
  );
}

/** Суммарный тир технологий по всем доменам страны. */
function technologyScore(country: Country): number {
  return Object.values(country.technology.domains).reduce(
    (sum, progress) => sum + getDomainTier(progress),
    0
  );
}

/**
 * Индекс национальной силы (docs/OBJECTIVES.md, план 11 категория B) —
 * взвешенная сумма нормализованных компонент: ВВП (доминирует) + военная сила +
 * население + технологии. Веса/масштабы в shared/src/defines/objective.ts.
 * Абсолютное значение не важно — служит для ранжирования стран (кто сильнее) и
 * обратной связи игроку. `regions` зарезервирован под территориальную
 * компоненту (число регионов), пока не входит в формулу — сила меряется по уже
 * агрегированным в Country величинам.
 */
export function getNationalPower(country: Country, _regions?: Region[]): number {
  const gdpComponent = country.economy.gdp / POWER_GDP_SCALE;
  const militaryComponent = militaryStrength(country) / POWER_MILITARY_SCALE;
  const populationComponent = country.population / POWER_POPULATION_SCALE;
  const techComponent = technologyScore(country);

  return (
    gdpComponent * POWER_WEIGHT_GDP +
    militaryComponent * POWER_WEIGHT_MILITARY +
    populationComponent * POWER_WEIGHT_POPULATION +
    techComponent * POWER_WEIGHT_TECHNOLOGY
  );
}

/**
 * Ранжирует все страны по силе (убыв.) и возвращает позицию игрока: сила, ранг
 * (1 — сильнейший), всего стран. Ничьи разрешаются по id (детерминизм).
 */
export function computePlayerStanding(
  countries: Country[],
  playerCountryId: string,
  regions?: Region[]
): { power: number; rank: number; total: number } {
  const ranked = countries
    .map(c => ({ id: c.id, power: getNationalPower(c, regions) }))
    .sort((a, b) => (b.power - a.power) || a.id.localeCompare(b.id));

  const index = ranked.findIndex(r => r.id === playerCountryId);
  const player = ranked[index];

  return {
    power: player ? player.power : 0,
    rank: index >= 0 ? index + 1 : ranked.length + 1,
    total: countries.length,
  };
}
