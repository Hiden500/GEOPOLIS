import { ResourceType } from "../types/resources/ResourcesType";
import { ResourceStockpile } from "../types/resources/ResourceStockpile";

export function createEmptyStockpile(): ResourceStockpile {
  return Object.values(ResourceType).reduce((stockpile, type) =>  {
    if (typeof type === "string") {
      stockpile[type as ResourceType] = 0;
    }
    return stockpile;
  }, {} as ResourceStockpile);
}