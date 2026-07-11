import { type GameState } from "@shared/types/GameState";
import { type SanctionType } from "@shared/types/DiplomacyState";
import { DiplomacyService } from "../services/DiplomacyService";
import { type CommandResult } from "./types";

const diplomacyService = new DiplomacyService();

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function requireCountries(game: GameState, ...ids: string[]): string | undefined {
  const missing = ids.find(id => !game.countries.some(c => c.id === id));
  return missing ? `Unknown country: ${missing}` : undefined;
}

/** Обёртка DiplomacyService.changeRelation — используется LLM-действием "diplomacy". */
export function setRelation(game: GameState, fromId: string, toId: string, delta: number): CommandResult {
  const error = requireCountries(game, fromId, toId);
  if (error) return { success: false, error };

  diplomacyService.changeRelation(game.countries, fromId, toId, delta);
  return { success: true };
}

/** Обёртка DiplomacyService.changeInfluence — используется LLM-действием "influence". */
export function setInfluence(game: GameState, fromId: string, toId: string, delta: number): CommandResult {
  const error = requireCountries(game, fromId, toId);
  if (error) return { success: false, error };

  diplomacyService.changeInfluence(game.countries, fromId, toId, delta);
  return { success: true };
}

/** Обёртка DiplomacyService.addSanction — используется LLM-действием "sanction". */
export function applySanction(
  game: GameState,
  fromId: string,
  toId: string,
  sanctionType: SanctionType
): CommandResult {
  const error = requireCountries(game, fromId, toId);
  if (error) return { success: false, error };

  diplomacyService.addSanction(game.countries, fromId, toId, sanctionType);
  return { success: true };
}

/** Обёртка DiplomacyService.addGuarantee — используется LLM-действием "guarantee". */
export function setGuarantee(game: GameState, guarantorId: string, guaranteedId: string): CommandResult {
  const error = requireCountries(game, guarantorId, guaranteedId);
  if (error) return { success: false, error };

  diplomacyService.addGuarantee(game.countries, guarantorId, guaranteedId);
  return { success: true };
}

/**
 * Односторонний сдвиг отношений без реципрокного эффекта — точная обёртка
 * формулы AiBehaviorTick Правило B (коалиционный бандвагонинг/балансировка,
 * `docs/plans/03_MODIFIERS_COMMANDS.md`). Не переиспользует
 * DiplomacyService.changeRelation: у того есть побочный реципрокный сдвиг
 * на 50%, которого в этой AI-формуле нет — переиспользование незаметно
 * изменило бы откалиброванный баланс.
 */
export function nudgeRelationOneSided(game: GameState, fromId: string, toId: string, delta: number): CommandResult {
  const error = requireCountries(game, fromId, toId);
  if (error) return { success: false, error };

  const from = game.countries.find(c => c.id === fromId)!;
  const current = from.diplomacy.relations[toId] ?? 0;
  from.diplomacy.relations[toId] = clamp(current + delta, -100, 100);
  return { success: true };
}

/**
 * Линейное сближение влияния к цели — точная обёртка формулы AiBehaviorTick
 * Правило B (бандвагонинг: влияние игрока над угрожаемой страной растёт к
 * доминированию). Отдельно от setInfluence — там дельта, здесь интерполяция
 * к target.
 */
export function nudgeInfluenceTowardTarget(
  game: GameState,
  fromId: string,
  toId: string,
  target: number,
  rate: number
): CommandResult {
  const error = requireCountries(game, fromId, toId);
  if (error) return { success: false, error };

  const from = game.countries.find(c => c.id === fromId)!;
  const current = from.diplomacy.influence[toId] ?? 0;
  from.diplomacy.influence[toId] = clamp(current + (target - current) * rate, 0, 100);
  return { success: true };
}
