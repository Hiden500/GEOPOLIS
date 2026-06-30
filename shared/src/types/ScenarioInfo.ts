import { type CountryTier } from "./Country";

export interface FeaturedCountry {
  id: string;
  name: string;
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