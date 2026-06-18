import { type Scenario } from "./types/Scenario";
import { ERAS } from "@shared/data/eras";
import { USSR } from "../data/countries/USSR";
import { USA } from "../data/countries/USA";
import { UK } from "../data/countries/UnitedKingdom";
import { testRegions } from "../data/testRegion";

export const Scenario2000: Scenario = {
  id: "2000",
  name: "Современный мир",
  startDate: "2000-01-01",
  endDate: "2100-12-31",
  technologyEra: ERAS.find(era => era.id === "2000")!,
  countries: [USSR, USA, UK],
  regions: testRegions,
  description: "Эпоха информации, глобализации и технологической сингулярности. От начала XXI века до конца XXII века."
};
