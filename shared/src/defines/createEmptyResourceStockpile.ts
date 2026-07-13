import { type ResourceStockpile } from "../types/resources/ResourceStockpile";
import { ResourceType } from "../types/resources/ResourcesType";

/** Placeholder ResourceStockpile — все ресурсы каталога на нуле. */
export function createEmptyResourceStockpile(): ResourceStockpile {
  return Object.fromEntries(
    Object.values(ResourceType).map((type) => [type, 0])
  ) as ResourceStockpile;
}
