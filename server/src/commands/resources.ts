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
 * глаголом алфавита "build_extraction" (±1 уровень за ход задаёт сам глагол:
 * `params.direction`, величины движок считает сам — `PrimitiveEngine`; до
 * 2026-08-02 это был кап Zod-схемы удалённого канала `actions`).
 * Наращивание требует контроля над
 * регионом (docs/plans/08_WAR_WAVE1.md::effectiveController) и наличия
 * депозита ресурса; списывает EXTRACTION_BUILD_COST за уровень из казны.
 * Снятие мощностей — бесплатно, без проверки контроля (страна может
 * сворачивать добычу и на потерянной/оккупированной территории).
 *
 * ПОТОЛОК И ПОЛ ОТКЛОНЯЮТСЯ, А НЕ РАПОРТУЮТ УСПЕХ (2026-08-01). Раньше вызов
 * на уровне `MAX_EXTRACTION_LEVEL` клампился и возвращал `success: true`, ничего
 * не изменив. Для сценария 1946 это означало, что действие бесполезно ВСЕГДА:
 * все 2055 пар (регион, ресурс) с депозитом стоят ровно на потолке, и прогон
 * команды по каждой из них даёт 2055 ложных успехов и ноль изменений состояния
 * (`server/scripts/probeResourceGates.ts`). Ложный успех хуже отказа: движок
 * записывает в летопись действие, которого не было, а модель считает мощности
 * построенными. Само по себе это действие не оживляет — нужны данные с уровнями
 * ниже потолка или другой потолок (развилка в `docs/IDEAS.md`).
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
    if (currentLevel >= MAX_EXTRACTION_LEVEL) {
      return {
        success: false,
        error: `Extraction of ${resource} in region ${regionId} is already at maximum level ${MAX_EXTRACTION_LEVEL}`,
      };
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

  if (currentLevel <= 0) {
    return { success: false, error: `No ${resource} extraction to dismantle in region ${regionId}` };
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
