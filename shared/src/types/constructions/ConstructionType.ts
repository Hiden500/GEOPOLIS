export const ConstructionType=  {

  Factory: "factory",

  Railway: "railway",

  Airbase: "airbase",

  Port: "port",

  Radar: "radar",

  NuclearPlant: "nuclearPlant",

  ResearchCenter: "researchCenter",

  PowerPlant: "powerPlant"
} as const;

export type ConstructionType = (typeof ConstructionType)[keyof typeof ConstructionType];