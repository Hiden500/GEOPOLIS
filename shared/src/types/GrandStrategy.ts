/**
 * Самопоставленная цель игрока (docs/OBJECTIVES.md, план 11 категория B).
 * Игрок объявляет свои цели; движок детерминированно проверяет их выполнение
 * каждый ход (server/src/simulation/ObjectiveTick.ts::evaluatePlayerGoals) и
 * ставит `completed`. Дискриминированный union по `kind` — движок умеет
 * оценивать ровно эти виды из уже трекаемого состояния (без LLM-суждения).
 * `title` опционально: UI может вывести подпись из `kind` + параметров.
 *
 * Имя `StrategicGoal` историческое (поле `Country.goals`) — до этого был
 * плоский {id,title,priority,completed}-плейсхолдер, который никто не читал.
 */
export type StrategicGoal =
  | { id: string; kind: "reach_gdp"; target: number; completed: boolean; title?: string }
  | { id: string; kind: "reach_power_rank"; targetRank: number; completed: boolean; title?: string }
  | { id: string; kind: "control_regions"; targetCount: number; completed: boolean; title?: string }
  | { id: string; kind: "reach_tech_tier"; domain: string; targetTier: number; completed: boolean; title?: string };

/** Виды целей — для валидации и UI-меню. */
export const STRATEGIC_GOAL_KINDS = [
  "reach_gdp",
  "reach_power_rank",
  "control_regions",
  "reach_tech_tier",
] as const;
