import { type Scenario } from "./types/Scenario";
import { USSR } from "../data/countries/USSR";
import { USA } from "../data/countries/USA";
import { testRegions } from "../data/testRegion";
import { ERAS } from "@shared/data/eras";

export const Scenario1946: Scenario = {

  id: "1946",

  name: "Cold War Begins",

  startDate: "1946-01-01",

  technologyEra: ERAS.find(era => era.id === "1946")!,

  countries: [USSR, USA],

  regions: testRegions,

  description: "Начало холодной войны."
};