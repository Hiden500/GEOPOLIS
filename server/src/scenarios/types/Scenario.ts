import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type EraDefinition } from "@shared/types/research/EraDefinition";

export interface Scenario {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  technologyEra: EraDefinition;
  countries: Country[];
  regions: Region[];
  description: string;
}