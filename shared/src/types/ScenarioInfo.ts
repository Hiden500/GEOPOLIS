import { type CountryTier } from "./Country";
import { type LocalizedText } from "./i18n/LocalizedText";

export interface FeaturedCountry {
  id: string;
  name: LocalizedText;
  tier: CountryTier;
}

/**
 * Информация о сценарии для отображения в UI
 */
export interface ScenarioInfo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  era: string;
  difficulty?: 'easy' | 'normal' | 'hard';
  featuredCountries: FeaturedCountry[];
}