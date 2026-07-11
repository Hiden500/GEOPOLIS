import { ResourceType } from "../resources/ResourcesType";
import { type LocalizedText } from "../i18n/LocalizedText";

export interface Region {

  id: number;

  geoJsonId: string;

  names: LocalizedText;

  ownerCountryId: string;

  // Военная оккупация (docs/plans/08_WAR_WAVE1.md, Шаг 1) — поверх
  // ownerCountryId, не вместо него. Война двигает только это поле; владение
  // (ownerCountryId) двигает только мирный договор. Отсутствие = регион не
  // оккупирован, полный контроль у ownerCountryId. Кто сейчас фактически
  // контролирует регион — shared/src/utils/regionControl.ts::effectiveController.
  occupiedBy?: string | undefined;

  population: number;

  area: number;

  urbanization: number;

  stability: number;

  infrastructure: number;

  development: number;

  gdp: number;

  resourceProduction: Partial<Record<ResourceType, number>>;

  neighboringRegionIds: number[];

  sourceAdm1Codes?: string[];

  economy?: {
    agriculture: number;
    industry: number;
    mining: number;
    services: number;
  };
}