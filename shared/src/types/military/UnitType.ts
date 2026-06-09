export const UnitType = {

  Infantry: "infantry",

  Armor: "armor",

  Artillery: "artillery",

  Fighter: "fighter",

  Bomber: "bomber",

  Destroyer: "destroyer",

  Cruiser: "cruiser",

  Battleship: "battleship",

  Carrier: "carrier",

  Submarine: "submarine"
} as const;

export type UnitType = typeof UnitType[keyof typeof UnitType];