export const ActionType = {
  Research: "research",
  Build: "build",
  Diplomacy: "diplomacy",
  Military: "military",
  Economy: "economy",
  Intelligence: "intelligence",
  Politics: "politics",
  BuildFactory: "build_factory",
  BuildMine: "build_mine",
  BuildInfrastructure: "build_infrastructure",
  RecruitUnits: "recruit_units",
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];
