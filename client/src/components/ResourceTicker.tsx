import { useTranslation } from "react-i18next";
import { type ResourceStockpile } from "@shared/types/resources/ResourceStockpile";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { RESOURCE_CODES, RESOURCE_ICONS, formatResourceAmount } from "../utils/resourceDisplay";

interface Props {
  stockpile: ResourceStockpile;
}

export function ResourceTicker({ stockpile }: Props) {
  const { t } = useTranslation("resourceTicker");
  const entries = Object.entries(stockpile).filter(([, amount]) => amount > 0);

  if (entries.length === 0) return null;

  return (
    <div className="resource-ticker">
      {entries.map(([resource, amount]) => (
        <div
          key={resource}
          className="resource-chip"
          title={`${t(`resources.${resource}`, { defaultValue: resource })}: ${Math.round(amount).toLocaleString("ru-RU")}`}
        >
          <span className="resource-chip-icon">{RESOURCE_ICONS[resource as ResourceType] ?? "•"}</span>
          <span className="resource-chip-code">{RESOURCE_CODES[resource as ResourceType] ?? resource.slice(0, 3).toUpperCase()}</span>
          <span className="resource-chip-value">{formatResourceAmount(amount)}</span>
        </div>
      ))}
    </div>
  );
}
