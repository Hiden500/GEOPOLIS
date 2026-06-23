import { type ResourceStockpile } from "@shared/types/resources/ResourceStockpile";
import { ResourceType } from "@shared/types/resources/ResourcesType";

interface Props {
  stockpile: ResourceStockpile;
}

const RESOURCE_LABELS: Partial<Record<ResourceType, string>> = {
  [ResourceType.Aluminum]: "Алюминий",
  [ResourceType.Bauxite]: "Бокситы",
  [ResourceType.Coal]: "Уголь",
  [ResourceType.Copper]: "Медь",
  [ResourceType.Food]: "Пища",
  [ResourceType.Gas]: "Газ",
  [ResourceType.Iron]: "Железо",
  [ResourceType.Gold]: "Золото",
  [ResourceType.Oil]: "Нефть",
  [ResourceType.Lithium]: "Литий",
  [ResourceType.RareEarths]: "Редкие металлы",
  [ResourceType.Timber]: "Древесина",
  [ResourceType.Uranium]: "Уран",
};

const RESOURCE_CODES: Partial<Record<ResourceType, string>> = {
  [ResourceType.Aluminum]: "ALU",
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
};

function formatAmount(amount: number): string {
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return Math.round(amount).toString();
}

export function ResourceTicker({ stockpile }: Props) {
  const entries = Object.entries(stockpile).filter(([, amount]) => amount > 0);

  if (entries.length === 0) return null;

  return (
    <div className="resource-ticker">
      {entries.map(([resource, amount]) => (
        <div
          key={resource}
          className="resource-chip"
          title={`${RESOURCE_LABELS[resource as ResourceType] ?? resource}: ${Math.round(amount).toLocaleString("ru-RU")}`}
        >
          <span className="resource-chip-code">{RESOURCE_CODES[resource as ResourceType] ?? resource.slice(0, 3).toUpperCase()}</span>
          <span className="resource-chip-value">{formatAmount(amount)}</span>
        </div>
      ))}
    </div>
  );
}
