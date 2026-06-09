export interface CountryAction {

  countryId: string;

  category:
    | "economy"
    | "military"
    | "research"
    | "diplomacy"
    | "politics";

  description: string;
}