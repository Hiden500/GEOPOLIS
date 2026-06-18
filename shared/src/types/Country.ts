import { type EconomyState } from "./EconomyState";
import { type MilitaryState } from "./MilitaryState";
import { type TechnologyState } from "./TechnologyState";
import { type DiplomacyState } from "./DiplomacyState";
import { type StrategicGoal } from "./GrandStrategy";
import { type PoliticsState } from "./PoliticsState";
import { type ResourceStockpile } from "./resources/ResourceStockpile";
import { type EconomyType } from "./EconomyType";

export interface Country {
  id: string;

  name: string;

  shortName: string;

  color: string;

  capitalRegionId: number;

  population: number;

  economy: EconomyState;

  economyType: EconomyType;

  technology: TechnologyState;

  researchedTechnologyIds: string[];

  military: MilitaryState;

  diplomacy: DiplomacyState;

  politics: PoliticsState;

  stockpile: ResourceStockpile;

  goals: StrategicGoal[];
}