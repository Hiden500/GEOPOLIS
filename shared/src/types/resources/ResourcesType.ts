export const ResourceType = {
  Oil: "oil",
  Coal: "coal",
  Iron: "iron",
  Bauxite: "bauxite",
  Uranium: "uranium",
  RareEarths: "rareEarths",
  Food: "food",
  Timber: "timber",
  Gold: "gold",
  Copper: "copper",
  Aluminum: "aluminum",
  Lithium: "lithium",
  Gas: "gas"
} as const;

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];