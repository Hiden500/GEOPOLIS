import { type GameState } from "@shared/types/GameState";
import { type WindowKind } from "../hooks/useWindows";
import { getText } from "@shared/types/i18n/LocalizedText";

export function getInspectorTitle(kind: WindowKind, game: GameState): string {
  if (kind.type === "country") {
    return game.countries.find(c => c.id === kind.countryId)?.name ?? "Страна";
  }
  if (kind.type === "region") {
    const region = game.regions.find(r => r.id === kind.regionId);
    return region ? getText(region.names) : "Регион";
  }
  return "";
}
