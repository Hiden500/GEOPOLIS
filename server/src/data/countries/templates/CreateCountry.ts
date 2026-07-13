import { type Country } from "@shared/types/Country";
import { type EconomyProfile } from "@shared/types/EconomyProfile";
import { type TechnologyState } from "@shared/types/TechnologyState";
import { type MilitaryState } from "@shared/types/MilitaryState";
import { type DiplomacyState } from "@shared/types/DiplomacyState";
import { type PoliticsState } from "@shared/types/PoliticsState";
import { type ResourceStockpile } from "@shared/types/resources/ResourceStockpile";
import { type StrategicGoal } from "@shared/types/GrandStrategy";
import { createEmptyEconomyState } from "@shared/defines/createEmptyEconomyState";
import { createEmptyMilitaryState } from "@shared/defines/createEmptyMilitaryState";
import { createEmptyDiplomacyState } from "@shared/defines/createEmptyDiplomacyState";
import { createEmptyResourceStockpile } from "@shared/defines/createEmptyResourceStockpile";
import { ECONOMY_ARCHETYPES } from "./economyArchetypes";

/**
 * Авторский ввод страны: всё, кроме `economy`/`tier` (выводятся createGame) и
 * кроме нулевых рантайм-блоков (technology/military/diplomacy/stockpile/goals) —
 * их дефолтит createCountry, авторить нужно только реальные ненулевые оверрайды
 * (docs/plans/05_DATA_LAYOUT.md: "countries.json — ТОЛЬКО авторское"). politics
 * — исключение: ideology остаётся обязательной (это факт о стране, не дефолт),
 * остальные поля политики дефолтятся.
 * См. docs/ECONOMY.md ("Модель единиц") и docs/TODO.md (упрощение создания стран).
 */
export type CountryInput = Omit<
  Country,
  "economy" | "economyProfile" | "tier" | "population" | "aiTraits" |
  "technology" | "researchedTechnologyIds" | "military" | "diplomacy" | "politics" | "stockpile" | "goals"
> & {
  economyProfile?: Partial<Omit<EconomyProfile, "spending">> & {
    spending?: Partial<EconomyProfile["spending"]>;
  };
  population?: number;
  technology?: Partial<TechnologyState>;
  researchedTechnologyIds?: string[];
  military?: Partial<Omit<MilitaryState, "equipment">> & {
    equipment?: Partial<MilitaryState["equipment"]>;
  };
  diplomacy?: Partial<DiplomacyState>;
  politics: Partial<Omit<PoliticsState, "ideology">> & Pick<PoliticsState, "ideology">;
  stockpile?: Partial<ResourceStockpile>;
  goals?: StrategicGoal[];
};

/**
 * Строит Country из авторского ввода: мержит economyProfile с архетип-дефолтом
 * по economyType, заполняет `economy` нулевым placeholder'ом (реальные денежные
 * значения выводит createGame после агрегации ВВП региона), дефолтит остальные
 * рантайм-блоки нулевыми/пустыми значениями поверх авторских оверрайдов.
 */
export function createCountry(input: CountryInput): Country {
  const archetype = ECONOMY_ARCHETYPES[input.economyType];
  const overrides = input.economyProfile;

  const economyProfile: EconomyProfile = {
    ...archetype,
    ...overrides,
    spending: { ...archetype.spending, ...overrides?.spending },
  };

  const emptyMilitary = createEmptyMilitaryState();
  const emptyDiplomacy = createEmptyDiplomacyState();

  return {
    ...input,
    tier: "minor", // переопределяется assignInitialTiers при createGame
    population: input.population ?? 0,
    // Нейтральный placeholder — createGame() перезаписывает реальным
    // seeded-посевом (docs/AI_RULES.md §"Искусственный интеллект стран").
    aiTraits: { aggressiveness: 1, riskTolerance: 1 },
    economyProfile,
    economy: {
      ...createEmptyEconomyState(),
      inflation: economyProfile.inflation ?? 0,
      unemployment: economyProfile.unemployment ?? 0,
      tradeBalance: economyProfile.tradeBalance ?? 0,
    },
    technology: {
      domains: input.technology?.domains ?? {},
      ...(input.technology?.researchAllocation !== undefined
        ? { researchAllocation: input.technology.researchAllocation }
        : {}),
    },
    researchedTechnologyIds: input.researchedTechnologyIds ?? [],
    military: {
      ...emptyMilitary,
      ...input.military,
      equipment: { ...emptyMilitary.equipment, ...input.military?.equipment },
    },
    diplomacy: { ...emptyDiplomacy, ...input.diplomacy },
    politics: {
      governmentType: "Unknown",
      stability: 50,
      legitimacy: 50,
      corruption: 30,
      governmentSupport: 50,
      ...input.politics,
    },
    stockpile: { ...createEmptyResourceStockpile(), ...input.stockpile },
    goals: input.goals ?? [],
  };
}
