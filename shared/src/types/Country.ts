import { type EconomyState } from "./EconomyState";
import { type EconomyProfile } from "./EconomyProfile";
import { type MilitaryState } from "./MilitaryState";
import { type TechnologyState } from "./TechnologyState";
import { type DiplomacyState } from "./DiplomacyState";
import { type StrategicGoal } from "./GrandStrategy";
import { type PoliticsState } from "./PoliticsState";
import { type ResourceStockpile } from "./resources/ResourceStockpile";
import { type EconomyType } from "./EconomyType";
import { type AiTraits } from "./AiTraits";
import { type LocalizedText } from "./i18n/LocalizedText";

export type CountryTier = "major" | "regional" | "minor";

export interface Country {
  id: string;

  name: LocalizedText;

  shortName: LocalizedText;

  color: string;

  /** Важность страны. Пересчитывается раз в год по gdp+military+influence.
   *  При нулевых данных (плейсхолдеры) остаётся на историческом стартовом значении. */
  tier: CountryTier;

  capitalRegionId: number;

  population: number;

  /**
   * Авторские масштаб-свободные доли (источник истины для дизайна страны).
   * createGame выводит из него денежные поля `economy` как profile × gdp.
   * См. docs/ECONOMY.md.
   */
  economyProfile: EconomyProfile;

  /**
   * Денежные значения в абсолютном масштабе ВВП. Заполняется createCountry
   * placeholder-нулями и перезаписывается createGame после агрегации ВВП —
   * не источник истины при авторинге страны, см. economyProfile.
   */
  economy: EconomyState;

  economyType: EconomyType;

  technology: TechnologyState;

  researchedTechnologyIds: string[];

  military: MilitaryState;

  diplomacy: DiplomacyState;

  politics: PoliticsState;

  stockpile: ResourceStockpile;

  goals: StrategicGoal[];

  /**
   * Посеяно один раз при createGame (seeded RNG, docs/AI_RULES.md) — не
   * авторское поле, createCountry() ставит нейтральный placeholder
   * {aggressiveness: 1, riskTolerance: 1}, createGame() перезаписывает его
   * реальным посевом (тот же паттерн, что tier/technology.domains).
   */
  aiTraits: AiTraits;

  /**
   * Id страны-"якоря" валютной зоны (docs/plans/10_CURRENCY_ZONES.md) —
   * отсутствие поля = страна финансово независима (типичный случай для
   * большинства стран). Раздельно от diplomacy.sphereOfInfluence/puppets —
   * не каждая сфера влияния означает общий финансовый блок. Сама
   * страна-якорь это поле на себе не выставляет — "является ли X якорем"
   * определяется по факту, что другие страны на неё ссылаются.
   */
  currencyZoneAnchor?: string;
}