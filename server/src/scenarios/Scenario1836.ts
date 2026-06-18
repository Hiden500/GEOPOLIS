import { type Scenario } from "./types/Scenario";
import { ERAS } from "@shared/data/eras";
import { USSR } from "../data/countries/USSR";
import { USA } from "../data/countries/USA";
import { UK } from "../data/countries/UnitedKingdom";
import { testRegions } from "../data/testRegion";

export const Scenario1836: Scenario = {
  id: "1836",
  name: "Век империй",
  startDate: "1836-01-01",
  endDate: "1945-12-31",
  technologyEra: ERAS.find(era => era.id === "1836")!,
  countries: [USSR, USA, UK],
  regions: testRegions,
  description: "Эпоха индустриализации, колониальных империй и великих держав. От Венского конгресса до конца Второй мировой войны."
};