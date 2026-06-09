export const EconomyType ={

  Planned: "planned",

  Mixed: "mixed",

  Market: "market"
} as const;

export type EconomyType = typeof EconomyType[keyof typeof EconomyType];