import { type Country } from "@shared/types/Country";
import { type EconomyProfile } from "@shared/types/EconomyProfile";
import { createEmptyEconomyState } from "@shared/constants/createEmptyEconomyState";
import { ECONOMY_ARCHETYPES } from "./economyArchetypes";

/**
 * Авторский ввод страны: всё, кроме `economy` (выводится createGame из
 * economyProfile × gdp) и кроме полных economyProfile (мержится с архетипом
 * по economyType — авторить нужно только оверрайды, не весь профиль).
 * См. docs/ECONOMY.md ("Модель единиц") и docs/TODO.md (упрощение создания стран).
 */
export type CountryInput = Omit<Country, "economy" | "economyProfile" | "tier"> & {
  economyProfile?: Partial<Omit<EconomyProfile, "spending">> & {
    spending?: Partial<EconomyProfile["spending"]>;
  };
};

/**
 * Строит Country из авторского ввода: мержит economyProfile с архетип-дефолтом
 * по economyType, заполняет `economy` нулевым placeholder'ом (реальные денежные
 * значения выводит createGame после агрегации ВВП региона).
 */
export function createCountry(input: CountryInput): Country {
  const archetype = ECONOMY_ARCHETYPES[input.economyType];
  const overrides = input.economyProfile;

  const economyProfile: EconomyProfile = {
    ...archetype,
    ...overrides,
    spending: { ...archetype.spending, ...overrides?.spending },
  };

  return {
    ...input,
    tier: "minor", // переопределяется assignInitialTiers при createGame
    economyProfile,
    economy: {
      ...createEmptyEconomyState(),
      inflation: economyProfile.inflation ?? 0,
      unemployment: economyProfile.unemployment ?? 0,
      tradeBalance: economyProfile.tradeBalance ?? 0,
    },
  };
}
