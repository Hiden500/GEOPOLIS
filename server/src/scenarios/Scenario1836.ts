import { type Scenario } from "./types/Scenario";
import { ERAS } from "@shared/data/eras";

export const Scenario1836: Scenario = {

  id: "1836",

  name: "Age of Empires",

  startDate: "1836-01-01",

  technologyEra: ERAS.find(era => era.id === "1836")!,

  countries: [],

  regions: [],

  description: "Мир после Венского конгресса."
};