import { type GameState } from "./GameState";

/**
 * Версия формата сейва (docs/plans/01_PERSISTENCE_STATE.md). Несовпадение
 * при загрузке — честный отказ, без миграций (пока не понадобятся).
 *
 * v2 (2026-07-10, docs/plans/02_LLM_CONTRACT.md, Шаг 3): новое обязательное
 * поле GameState.chronicle — breaking change формата, старые сейвы (v1)
 * честно отклоняются, не молча ломаются.
 *
 * v3 (2026-07-11, docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 2): новое
 * обязательное поле GameState.modifiers — та же логика честного отказа,
 * старые сейвы (v2) отклоняются.
 *
 * v4 (2026-07-26, docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A): три
 * новых обязательных поля GameState — ethnicGroups, groupImpactMemory,
 * regionCrisisLatch (демо-состав и память воздействий, docs/CONCEPT.md §4.1).
 * Старые сейвы (v3) отклоняются: без каталога групп движок не выведет
 * недовольство ни для одного региона.
 *
 * v5 (2026-07-26, тот же план, сессия B): новое обязательное поле
 * GameState.primitiveBatchKeys — журнал idempotency-ключей применённых батчей
 * примитивов (docs/CONCEPT.md §7.2). Сейв v4 без него загрузился бы с
 * `undefined` вместо массива, то есть с отключённой защитой от двойного
 * применения — молча и ровно там, где она нужна. Честный отказ вместо
 * тихой деградации.
 */
export const SAVE_VERSION = 5;

export interface SaveFile {
  version: number;
  savedAt: string;
  game: GameState;
}
