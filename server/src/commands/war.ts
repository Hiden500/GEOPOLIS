import { type GameState } from "@shared/types/GameState";
import { type War } from "@shared/types/War";
import { WarService } from "../services/WarService";
import { transferRegion as transferRegionCore } from "../simulation/war/occupation";
import { type CommandResult } from "./types";

/**
 * Обёртка WarService.declareWar (идемпотентна) — используется LLM-действием
 * "war" и AiBehaviorTick.applyWarThreshold (Правило D).
 */
export function declareWar(
  game: GameState,
  initiatorId: string,
  targetId: string,
  warGoal?: string
): CommandResult<War> {
  if (!game.countries.some(c => c.id === initiatorId) || !game.countries.some(c => c.id === targetId)) {
    return { success: false, error: `Unknown country: ${initiatorId} or ${targetId}` };
  }

  // Война возвращается вызывающему: примитив `war` обязан отчитаться её id и
  // фактическим составом сторон ПОСЛЕ авто-втягивания коалиций, а собирать их
  // повторным поиском по `game.wars` значило бы завести второе мнение о том,
  // что только что создал сервис.
  const war = new WarService(game).declareWar(initiatorId, targetId, warGoal);
  return { success: true, applied: war };
}

/**
 * Ищет активную войну между двумя странами и завершает её миром — тот же
 * поиск, что раньше делал LLMService.applyPeaceAction инлайн. Используется
 * LLM-действием "peace".
 */
export function makePeaceBetween(
  game: GameState,
  countryAId: string,
  countryBId: string
): CommandResult<string> {
  const warService = new WarService(game);
  const war = warService.getActiveWarBetween(countryAId, countryBId);
  if (!war) {
    return { success: false, error: `No active war between ${countryAId} and ${countryBId}` };
  }

  warService.makePeace(war.id);
  return { success: true, applied: war.id };
}

/**
 * Атомарная передача региона новому легальному владельцу (аннексия). Единственная
 * прод-мутация ownerCountryId вне сценарной загрузки (docs/plans/08_WAR_WAVE1.md,
 * Шаг 2b) — WarService.makePeace вызывает ядро напрямую; эта обёртка для внешних
 * инициаторов (будущее LLM-действие "annex"/"peace" с условиями).
 */
export function transferRegion(game: GameState, regionId: number, newOwnerId: string): CommandResult {
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };
  if (!game.countries.some(c => c.id === newOwnerId)) {
    return { success: false, error: `Unknown country: ${newOwnerId}` };
  }

  transferRegionCore(game, region, newOwnerId);
  return { success: true };
}
