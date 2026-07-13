import { ResourceType } from "@shared/types/resources/ResourcesType";

/**
 * Общие подписи/иконки ресурсов — используются ResourceTicker и статами
 * ресурсов в шапке HUD (docs/plans/12_UI_REDESIGN.md §6: "переиспользовать
 * локализованные подписи", не дублировать по компонентам).
 */
export const RESOURCE_CODES: Partial<Record<ResourceType, string>> = {
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

export const RESOURCE_ICONS: Partial<Record<ResourceType, string>> = {
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

export function formatResourceAmount(amount: number): string {
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(1)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(1)}K`;
  return Math.round(amount).toString();
}
