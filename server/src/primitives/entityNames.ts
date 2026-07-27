import { type GameState } from "@shared/types/GameState";
import { type LocalizedText } from "@shared/types/i18n/LocalizedText";

/**
 * Локализованные имена сущностей мира для откликов и причин отказа.
 *
 * Отдельным модулем, потому что потребителей теперь двое и они на разных
 * слоях: отклик применённого примитива (`outcomes.ts`) и структурная причина
 * отказа (`PrimitiveEngine.ts` → `rejections.ts`). Пока резолверы жили внутри
 * отклика, движку оставалось только собирать сырые `region 68` и `estonians` в
 * текст — ровно то, что игрок и читал вместо имён.
 *
 * Фолбэк всюду — честный идентификатор, а не выдуманное имя: сущность без
 * имени не должна превращать строку в пустоту.
 */

export function regionNames(game: GameState, regionId: number): LocalizedText {
  const region = game.regions.find(r => r.id === regionId);
  return region?.names ?? { en: `region ${regionId}`, ru: `регион ${regionId}` };
}

export function groupNames(game: GameState, groupId: string): LocalizedText {
  const definition = game.ethnicGroups.find(g => g.id === groupId);
  return definition?.names ?? { en: groupId, ru: groupId };
}

export function countryNames(game: GameState, countryId: string): LocalizedText {
  const country = game.countries.find(c => c.id === countryId);
  return country?.name ?? { en: countryId, ru: countryId };
}
