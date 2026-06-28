/**
 * Сырьевые ресурсы. Только добыча — переделы (сталь, алюминий) не моделируются
 * как ресурс региона, это выход промышленности страны. Источник истины по
 * категориям/эрам появления — shared/src/data/resources/resourceCatalog.ts;
 * каждый член здесь обязан иметь запись в каталоге и наоборот.
 */
export const ResourceType = {
  Oil: "oil",
  Coal: "coal",
  Gas: "gas",
  Iron: "iron",
  Copper: "copper",
  Gold: "gold",
  Tin: "tin",
  Nickel: "nickel",
  Bauxite: "bauxite",
  Tungsten: "tungsten",
  Manganese: "manganese",
  Chromium: "chromium",
  Uranium: "uranium",
  RareEarths: "rareEarths",
  Lithium: "lithium",
  Food: "food",
  Timber: "timber",
  Cotton: "cotton",
  Rubber: "rubber",
  Nitrates: "nitrates",
} as const;

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];