import { z } from "zod";
import { RESOURCE_IDS } from "@shared/data/resources/resourceCatalog";

/**
 * Схемы расслоённых файлов сценария 1946 (docs/plans/05_DATA_LAYOUT.md).
 * Ключи deposits/extraction ограничены каталогом ресурсов — единственным
 * источником истины (shared/src/data/resources/resourceCatalog.ts). Партиальность
 * (Partial<Record<ResourceType, number>>) требует z.record(z.string(), ...) +
 * refine — z.record(z.enum(...), ...) в Zod v4 требует ВСЕ ключи enum (полный
 * record), не подходит для частичной записи.
 */
const RESOURCE_ID_SET = new Set<string>(RESOURCE_IDS);
const resourceRecordSchema = z.record(z.string(), z.number()).refine(
  (rec) => Object.keys(rec).every((k) => RESOURCE_ID_SET.has(k)),
  { message: `Ключи должны быть из каталога ресурсов: ${RESOURCE_IDS.join(", ")}` }
);

export const regionCoreSchema = z.object({
  id: z.number().int().positive(),
  geoJsonId: z.string().min(1),
  area: z.number().nonnegative(),
  neighboringRegionIds: z.array(z.number().int()),
  sourceAdm1Codes: z.array(z.string()).optional(),
});
export type RegionCoreEntry = z.infer<typeof regionCoreSchema>;
export const regionCoreFileSchema = z.array(regionCoreSchema);

export const regionStateSchema = z.object({
  id: z.number().int().positive(),
  ownerCountryId: z.string().min(1),
  occupiedBy: z.string().min(1).optional(),
  population: z.number().nonnegative(),
  urbanization: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  infrastructure: z.number().min(0).max(1),
  development: z.number().min(0).max(1),
  gdp: z.number().nonnegative(),
  deposits: resourceRecordSchema,
  extraction: resourceRecordSchema,
});
export type RegionStateEntry = z.infer<typeof regionStateSchema>;
export const regionStateFileSchema = z.array(regionStateSchema);

/** region_id (geoJsonId) → имя. Частичное покрытие допустимо (см. getText fallback). */
export const namesFileSchema = z.record(z.string(), z.string());
export type NamesFile = z.infer<typeof namesFileSchema>;

/**
 * Авторская страна countries.json (docs/plans/05_DATA_LAYOUT.md, Срез 2) — только
 * реально ненулевые/содержательные поля, зеркалит CountryInput
 * (server/src/data/countries/templates/CreateCountry.ts). Нулевые рантайм-блоки
 * (technology/military/stockpile/researchedTechnologyIds/goals/population,
 * пустая diplomacy) в файле отсутствуют — их дефолтит createCountry на загрузке.
 */
const economyProfileOverrideSchema = z.object({
  taxRate: z.number().optional(),
  spending: z.object({
    military: z.number(),
    research: z.number(),
    education: z.number(),
    infrastructure: z.number(),
    welfare: z.number(),
    other: z.number(),
  }).partial().optional(),
  treasuryShare: z.number().optional(),
  exportShare: z.number().optional(),
  stateEnterpriseShare: z.number().optional(),
  otherIncomeShare: z.number().optional(),
  inflation: z.number().optional(),
  unemployment: z.number().optional(),
  tradeBalance: z.number().optional(),
  debtInterestShare: z.number().optional(),
});

const authoredDiplomacySchema = z.object({
  allies: z.array(z.string()).optional(),
  rivals: z.array(z.string()).optional(),
  puppets: z.array(z.string()).optional(),
  sphereOfInfluence: z.array(z.string()).optional(),
  relations: z.record(z.string(), z.number()).optional(),
  influence: z.record(z.string(), z.number()).optional(),
  guarantees: z.array(z.string()).optional(),
  sanctions: z.record(z.string(), z.array(z.string())).optional(),
});

const authoredTechnologySchema = z.object({
  domains: z.record(z.string(), z.number()).optional(),
  researchAllocation: z.record(z.string(), z.number()).optional(),
});

const authoredMilitarySchema = z.object({
  manpower: z.number().optional(),
  activePersonnel: z.number().optional(),
  reservePersonnel: z.number().optional(),
  militaryBudget: z.number().optional(),
  armyStrength: z.number().optional(),
  navyStrength: z.number().optional(),
  airStrength: z.number().optional(),
  nuclearWarheads: z.number().optional(),
  equipment: z.record(z.string(), z.number()).optional(),
});

export const authoredCountrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().min(1),
  color: z.string().min(1),
  capitalRegionId: z.number().int().nonnegative(),
  economyType: z.enum(["planned", "mixed", "market"]),
  economyProfile: economyProfileOverrideSchema.optional(),
  population: z.number().nonnegative().optional(),
  technology: authoredTechnologySchema.optional(),
  researchedTechnologyIds: z.array(z.string()).optional(),
  military: authoredMilitarySchema.optional(),
  diplomacy: authoredDiplomacySchema.optional(),
  politics: z.object({
    ideology: z.string().min(1),
    governmentType: z.string().optional(),
    stability: z.number().optional(),
    legitimacy: z.number().optional(),
    corruption: z.number().optional(),
    governmentSupport: z.number().optional(),
  }),
  stockpile: z.record(z.string(), z.number()).optional(),
  goals: z.array(z.unknown()).optional(),
  // Валютные зоны (docs/plans/10_CURRENCY_ZONES.md) — id страны-якоря.
  currencyZoneAnchor: z.string().min(1).optional(),
});
export type AuthoredCountry = z.infer<typeof authoredCountrySchema>;
export const authoredCountryFileSchema = z.array(authoredCountrySchema);
