import { useTranslation } from "react-i18next";
import { type ResourceStockpile } from "@shared/types/resources/ResourceStockpile";
import { ResourceType } from "@shared/types/resources/ResourcesType";

interface Props {
  stockpile: ResourceStockpile;
}

const RESOURCE_CODES: Partial<Record<ResourceType, string>> = {
  [ResourceType.Bauxite]: "BAU",
  [ResourceType.Coal]: "COL",
  [ResourceType.Copper]: "CU",
  [ResourceType.Food]: "FOD",
  [ResourceType.Gas]: "GAS",
  [ResourceType.Iron]: "IRN",
  [ResourceType.Gold]: "AU",
  [ResourceType.Oil]: "OIL",
  [ResourceType.Lithium]: "LI",
  [ResourceType.RareEarths]: "REE",
  [ResourceType.Timber]: "TMB",
  [ResourceType.Uranium]: "URN",
  [ResourceType.Tin]: "TIN",
  [ResourceType.Nickel]: "NI",
  [ResourceType.Tungsten]: "TUN",
  [ResourceType.Manganese]: "MN",
  [ResourceType.Chromium]: "CR",
  [ResourceType.Cotton]: "COT",
  [ResourceType.Rubber]: "RUB",
  [ResourceType.Nitrates]: "NIT",
};

const RESOURCE_ICONS: Partial<Record<ResourceType, string>> = {
  [ResourceType.Oil]: "🛢️",
  [ResourceType.Coal]: "⚫",
  [ResourceType.Gas]: "🔥",
  [ResourceType.Iron]: "⛓️",
  [ResourceType.Copper]: "🔶",
  [ResourceType.Gold]: "🥇",
  [ResourceType.Tin]: "🥫",
  [ResourceType.Nickel]: "⚙️",
  [ResourceType.Bauxite]: "⛏️",
  [ResourceType.Tungsten]: "💡",
  [ResourceType.Manganese]: "🔩",
  [ResourceType.Chromium]: "✨",
  [ResourceType.Uranium]: "☢️",
  [ResourceType.RareEarths]: "💎",
  [ResourceType.Lithium]: "🔋",
  [ResourceType.Food]: "🌾",
  [ResourceType.Timber]: "🪵",
  [ResourceType.Cotton]: "🧵",
  [ResourceType.Rubber]: "⭕",
  [ResourceType.Nitrates]: "🧪",
};

function formatAmount(amount: number): string {
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return Math.round(amount).toString();
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
          <span className="resource-chip-value">{formatAmount(amount)}</span>
        </div>
      ))}
    </div>
  );
}
