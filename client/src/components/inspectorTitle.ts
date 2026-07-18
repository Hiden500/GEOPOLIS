import { type GameState } from "@shared/types/GameState";
import { type WindowKind } from "../hooks/useWindows";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";

export function getInspectorTitle(kind: WindowKind, game: GameState, locale?: Locale): string {
  if (kind.type === "country") {
    const country = game.countries.find(c => c.id === kind.countryId);
    return country ? getText(country.name, locale) : "Страна";
  }
  if (kind.type === "region") {
    const region = game.regions.find(r => r.id === kind.regionId);
    return region ? getText(region.names, locale) : "Регион";
  }
  return "";
}
