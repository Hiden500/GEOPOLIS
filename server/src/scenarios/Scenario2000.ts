import { type Scenario } from "./types/Scenario";
import { ERAS } from "@shared/data/eras";

export const Scenario2000: Scenario = {

  id: "2000",

  name: "Modern World",

  startDate: "2000-01-01",

  technologyEra: ERAS.find(era => era.id === "2000")!,

  countries: [],

  regions: [],

  description: "Современный мир."
};