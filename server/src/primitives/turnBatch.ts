import { type GameState } from "@shared/types/GameState";
import {
  type PlaceHistoryEntry,
  type PrimitiveOutcomeRecord,
} from "@shared/types/politics/PrimitiveOutcome";
import {
  MAX_PRIMITIVE_BATCH_KEYS,
  PLACE_HISTORY_MAX_ENTRIES,
} from "@shared/defines/discontent";
import { applyPrimitiveBatch } from "./PrimitiveEngine";
import { buildPrimitiveOutcomes } from "./outcomes";
import { type AppliedPrimitive, type Primitive, type RejectedPrimitive } from "./types";

/**
 * Граница хода для примитивов: idempotency, локализуемый отклик, история места.
 *
 * Почему отдельным слоем, а не внутри движка. `applyPrimitiveBatch` — чистая
 * механика применения: она обязана применять то, что её попросили, столько раз,
 * сколько её позвали. Защита от ПОВТОРНОГО применения одного и того же ответа —
 * свойство границы хода (docs/CONCEPT.md §7.2, «Idempotency-key на ход (против
 * двойного применения)»), а не арифметики эффектов: движок не может отличить
 * «модель второй раз предлагает подавить тот же регион» (законно, ловится капом
 * «один verb на цель») от «тот же самый HTTP-запрос доехал дважды» (ретрай,
 * двойной клик). Различает их только ключ, который даёт вызывающий.
 *
 * Цена отсутствия защиты конкретна: два `repress` подряд по одной группе
 * поднимают `suppression` с 0.6 в 1.0 — состояние мира расходится с тем, что
 * игрок сделал, и расходится молча.
 *
 * ВАЖНО про ссылки на состояние. `applyPrimitiveBatch` коммитит результат
 * поэлементным переносом, и идентичность объектов сохраняется ПОЗИЦИОННО (см.
 * JSDoc `restore`). Поэтому всё, что читает состояние, здесь стоит ПОСЛЕ вызова
 * движка, и ни одна ссылка на регион/страну через него не проносится.
 */

export interface PrimitiveTurnResult {
  /**
   * Батч с этим ключом уже применялся — ничего не сделано.
   * Отдельный флаг, а не пустой `applied`: «применено ноль примитивов» и
   * «повтор уже применённого» — разные вещи, и путать их в интерфейсе нельзя.
   */
  duplicate: boolean;
  applied: AppliedPrimitive[];
  /** Локализуемый отклик по каждому применённому примитиву (порядок тот же). */
  outcomes: PrimitiveOutcomeRecord[];
  rejected: RejectedPrimitive[];
}

/** Регионы, чью историю места затронул примитив, с готовой записью для каждого. */
function placeHistoryEntries(
  date: string,
  applied: AppliedPrimitive,
  outcome: PrimitiveOutcomeRecord
): { regionId: number; entry: PlaceHistoryEntry }[] {
  const entries: { regionId: number; entry: PlaceHistoryEntry }[] = [];

  // Реформа — общегосударственный акт без места: приписывать её произвольному
  // региону значило бы выдумать факт, которого в результате нет.
  if (applied.verb === "enact_reform") return entries;

  entries.push({
    regionId: applied.regionId,
    entry: { date, verb: applied.verb, line: outcome.headline },
  });

  if (applied.verb === "grant_autonomy") {
    // Соседи получают СВОЮ запись со ссылкой на источник уступки: в истории
    // соседнего места произошло не «дали автономию», а «отозвалось на уступку
    // рядом». Дубликаты по региону схлопываются — одна уступка оставляет у
    // соседа одну запись, сколько бы групп в нём ни отозвалось.
    for (const regionId of new Set(applied.neighbourEffects.map(e => e.regionId))) {
      entries.push({
        regionId,
        entry: {
          date,
          verb: applied.verb,
          line: {
            key: "grantAutonomy.echoInPlace",
            names: outcome.headline.names ?? {},
          },
        },
      });
    }
  }

  return entries;
}

/**
 * Дописывает историю места с капом (docs/CONCEPT.md §5.6 — кап обязателен).
 * Вытесняются САМЫЕ СТАРЫЕ записи: инспектор места показывает недавнее.
 */
function appendPlaceHistory(
  game: GameState,
  applied: readonly AppliedPrimitive[],
  outcomes: readonly PrimitiveOutcomeRecord[]
): void {
  for (let i = 0; i < applied.length; i++) {
    const outcome = outcomes[i];
    const primitive = applied[i];
    if (!outcome || !primitive) continue;

    for (const { regionId, entry } of placeHistoryEntries(game.currentDate, primitive, outcome)) {
      const region = game.regions.find(r => r.id === regionId);
      if (!region) continue;
      const history = [...(region.placeHistory ?? []), entry];
      region.placeHistory = history.slice(-PLACE_HISTORY_MAX_ENTRIES);
    }
  }
}

/**
 * Применялся ли уже батч с этим ключом.
 *
 * Отдельной функцией, потому что у вызывающего есть работа, которую нельзя
 * делать повторно, но которая происходит ДО применения примитивов: запись
 * диагностических фактов об отказах структурной схемы и границы агентности.
 * Без раннего вопроса повтор запроса не применил бы ничего (это ловит ключ
 * внутри `applyPrimitiveTurn`), но продублировал бы диагностику.
 */
export function isDuplicatePrimitiveBatch(game: GameState, idempotencyKey: string): boolean {
  return game.primitiveBatchKeys.includes(idempotencyKey);
}

/**
 * Применяет батч примитивов на границе хода.
 *
 * Единственная точка входа для LLM-пути и для приказа игрока: обе стороны
 * обязаны получить одинаковые гарантии — защиту от дубля, отклик, построенный
 * из фактических величин, и запись в историю места.
 *
 * @param idempotencyKey стабильный ключ запроса. Для ответа модели выводится из
 *   его содержания (повторно вставленный ответ даёт тот же ключ), для действия
 *   игрока приходит от клиента (второй клик по той же кнопке — тот же ключ).
 */
export function applyPrimitiveTurn(
  game: GameState,
  primitives: readonly Primitive[],
  idempotencyKey: string
): PrimitiveTurnResult {
  if (isDuplicatePrimitiveBatch(game, idempotencyKey)) {
    return { duplicate: true, applied: [], outcomes: [], rejected: [] };
  }

  const result = applyPrimitiveBatch(game, primitives);

  // Всё, что читает состояние, — строго после движка (см. заметку о ссылках).
  const outcomes = buildPrimitiveOutcomes(game, result.applied);
  appendPlaceHistory(game, result.applied, outcomes);

  // Ключ записывается и тогда, когда всё было отклонено: повтор запроса не
  // должен второй раз наплодить диагностические факты об одних и тех же отказах.
  game.primitiveBatchKeys = [...game.primitiveBatchKeys, idempotencyKey].slice(
    -MAX_PRIMITIVE_BATCH_KEYS
  );

  return { duplicate: false, applied: result.applied, outcomes, rejected: result.rejected };
}
