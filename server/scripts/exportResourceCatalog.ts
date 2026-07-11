import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RESOURCE_CATALOG } from "@shared/data/resources/resourceCatalog";
import { MAX_EXTRACTION_LEVEL } from "@shared/defines/resources";

/**
 * Экспортирует RESOURCE_CATALOG (shared/src/data/resources/resourceCatalog.ts)
 * и MAX_EXTRACTION_LEVEL (shared/src/defines/resources.ts) в
 * scripts/map/out/resource_catalog.json — единый источник истины по ресурсам
 * для Python-пайплайна (docs/plans/05_DATA_LAYOUT.md, Срез 3). Раньше
 * fill_region_economy_1946.py/validate_region_economy_1946.py дублировали
 * список ресурсов и MAX_EXTRACTION_LEVEL вручную с комментарием-синхронизацией.
 *
 * Запуск: npm run export:resource-catalog (в server/), часть make_1946.py
 * (Срез 5) — первый шаг пайплайна.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "..", "scripts", "map", "out", "resource_catalog.json");

function main(): void {
  const payload = {
    _meta: {
      generator: "server/scripts/exportResourceCatalog.ts",
      source: "shared/src/data/resources/resourceCatalog.ts + shared/src/defines/resources.ts",
    },
    maxExtractionLevel: MAX_EXTRACTION_LEVEL,
    resources: RESOURCE_CATALOG,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(`Экспортировано ${Object.keys(RESOURCE_CATALOG).length} ресурсов -> ${OUT_PATH}`);
}

main();
