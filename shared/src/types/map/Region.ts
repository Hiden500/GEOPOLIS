import { ResourceType } from "../resources/ResourcesType";
import { type LocalizedText } from "../i18n/LocalizedText";
import { type RegionGroupShare } from "../politics/Demographics";

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

  // Ресурсы: deposit/extraction/output (docs/plans/04_RESOURCES.md).
  // deposits — richness, геологический потенциал (истощается медленно,
  // ResourceTick.ts). extraction — уровень добывающих мощностей 0..
  // MAX_EXTRACTION_LEVEL (shared/src/defines/resources.ts), меняется только
  // командами (server/src/commands/resources.ts) — не тиком. Output за тик
  // не хранится, вычисляется из обоих полей.
  deposits: Partial<Record<ResourceType, number>>;

  extraction: Partial<Record<ResourceType, number>>;

  neighboringRegionIds: number[];

  /**
   * Демо-состав (docs/CONCEPT.md §4.1): доминантная группа + до 3 меньшинств,
   * сумма долей = 1. Опционально — покрытие сценарных данных частичное
   * (server/data/scenarios/1946/demographics.json), регион без записи считается
   * НЕразмеченным (движок не выводит для него недовольство), а не «пустым».
   */
  demographics?: RegionGroupShare[] | undefined;

  sourceAdm1Codes?: string[];

  economy?: {
    agriculture: number;
    industry: number;
    mining: number;
    services: number;
  };
}