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
