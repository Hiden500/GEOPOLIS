export const EquipmentType = {

  Rifles: "rifles",

  Trucks: "trucks",

  Tanks: "tanks",

  Fighters: "fighters",

  Bombers: "bombers",

  Artillery: "artillery",

  Destroyers: "destroyers",

  Submarines: "submarines"

} as const;

export type EquipmentType =
  (typeof EquipmentType)[keyof typeof EquipmentType];