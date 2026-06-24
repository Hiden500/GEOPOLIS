import { type GameState } from "@shared/types/GameState";
import { type WindowKind } from "../hooks/useWindows";

export function getInspectorTitle(kind: WindowKind, game: GameState): string {
  if (kind.type === "country") {
    return game.countries.find(c => c.id === kind.countryId)?.name ?? "Страна";
  }
  if (kind.type === "region") {
    return game.regions.find(r => r.id === kind.regionId)?.name ?? "Регион";
  }
  return "";
}
