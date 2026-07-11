import { type GameState } from "@shared/types/GameState";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { effectiveController } from "@shared/utils/regionControl";
import { MAX_EXTRACTION_LEVEL, EXTRACTION_BUILD_COST } from "@shared/defines/resources";
import { type CommandResult } from "./types";

function findCountry(game: GameState, countryId: string) {
  return game.countries.find(c => c.id === countryId);
}

function findRegion(game: GameState, regionId: number) {
  return game.regions.find(r => r.id === regionId);
}

/**
 * Строит (delta>0) или частично сворачивает (delta<0) добывающие мощности
 * региона на один ресурс (docs/plans/04_RESOURCES.md, Шаг 3). Используется
 * LLM-действием "build_extraction" (±1 уровень за ход — кап в Zod-схеме,
 * server/src/llm/actionSchemas.ts). Наращивание требует контроля над
 * регионом (docs/plans/08_WAR_WAVE1.md::effectiveController) и наличия
 * депозита ресурса; списывает EXTRACTION_BUILD_COST за уровень из казны.
 * Снятие мощностей — бесплатно, без проверки контроля (страна может
 * сворачивать добычу и на потерянной/оккупированной территории).
 */
export function buildExtraction(
  game: GameState,
  countryId: string,
  regionId: number,
  resource: ResourceType,
  delta: number
): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  const region = findRegion(game, regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };

  const currentLevel = region.extraction[resource] ?? 0;

  if (delta > 0) {
    if (effectiveController(region) !== countryId) {
      return { success: false, error: `Country ${countryId} does not control region ${regionId}` };
    }
    if (!region.deposits[resource]) {
      return { success: false, error: `No ${resource} deposit in region ${regionId}` };
    }

    const newLevel = Math.min(MAX_EXTRACTION_LEVEL, currentLevel + delta);
    const cost = (newLevel - currentLevel) * EXTRACTION_BUILD_COST;
    if (country.economy.treasury < cost) {
      return { success: false, error: `Not enough treasury: need ${cost}, have ${country.economy.treasury}` };
    }

    country.economy.treasury -= cost;
    region.extraction[resource] = newLevel;
    return { success: true };
  }

  region.extraction[resource] = Math.max(0, currentLevel + delta);
  return { success: true };
}

/**
 * Безусловно снижает уровень добывающих мощностей — для будущей интеграции
 * с войной/событиями (docs/plans/04_RESOURCES.md не требует автоматического
 * триггера в этом заходе; команда существует и тестируется напрямую, не
 * подключена к WarTick.ts). Без списания казны, без проверки контроля.
 */
export function damageExtraction(
  game: GameState,
  regionId: number,
  resource: ResourceType,
  amount: number
): CommandResult {
  const region = findRegion(game, regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };

  const currentLevel = region.extraction[resource] ?? 0;
  region.extraction[resource] = Math.max(0, currentLevel - amount);
  return { success: true };
}
