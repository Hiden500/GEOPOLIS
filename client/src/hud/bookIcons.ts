import {
  IconEconomy,
  IconIndustry,
  IconTechnology,
  IconPopulationTab,
  IconPolitics,
  IconDiplomacy,
  IconIntelligence,
  IconRankings,
  IconChronicle,
} from "./icons";
import { type BookId } from "./types";

/**
 * Отдельный файл от icons.tsx (не .tsx): react-refresh/only-export-components
 * запрещает смешивать экспорт компонентов с обычными константами в одном файле.
 */
export const BOOK_ICONS: Record<BookId, typeof IconEconomy> = {
  economy: IconEconomy,
  industry: IconIndustry,
  technology: IconTechnology,
  population: IconPopulationTab,
  politics: IconPolitics,
  diplomacy: IconDiplomacy,
  intelligence: IconIntelligence,
  rankings: IconRankings,
  chronicle: IconChronicle,
};
