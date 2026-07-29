import { type GameState, type WorldFactSource } from "@shared/types/GameState";
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
  // региону значило бы выдумать факт, которого в результате нет. Раскол
  // затрагивает МНОГО мест сразу, и «история места» о нём сказать нечего,
  // кроме смены флага: она уже выражена владением региона, а запись в каждый
  // отделившийся регион дублировала бы её десятками строк, не добавляя факта.
  //
  // Дипломатический блок — акты МЕЖДУ ГОСУДАРСТВАМИ, у них места нет вовсе, и
  // резюме каждого называет страны, а не регион. Исключение по существу одно:
  // мир, двигающий границу, оставляет в аннексированных регионах след, который
  // истории места был бы к лицу. Он не сделан осознанно — записи потребовалась
  // бы своя строка отклика, а не заголовок про страны, — и занесён в
  // `docs/TODO.md`, а не спрятан.
  //
  // Мягкие воздействия Милстоуна 1 делятся по тому же признаку, а не по классу:
  // `send_aid`, `condemn` и `support_proxy` происходят МЕЖДУ государствами и
  // места не имеют, а `capital_flight` бьёт по конкретному региону — «отсюда
  // ушли деньги» истории места принадлежит буквально, и запись у него есть.
  if (
    applied.verb === "enact_reform" ||
    applied.verb === "split_country" ||
    applied.verb === "diplomacy" ||
    applied.verb === "sanction" ||
    applied.verb === "war" ||
    applied.verb === "peace" ||
    applied.verb === "send_aid" ||
    applied.verb === "condemn" ||
    applied.verb === "support_proxy"
  ) {
    return entries;
  }

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
 *
 * Смотрит в ОБА кольца — и применённых батчей, и пустых: вопрос «этот запрос уже
 * приходил?» одинаков для тех и других, различается только цена вытеснения
 * ключа, и именно поэтому кольца разные (см. `rememberBatchKey`).
 */
export function isDuplicatePrimitiveBatch(game: GameState, idempotencyKey: string): boolean {
  return (
    game.primitiveBatchKeys.includes(idempotencyKey) ||
    game.primitiveNoopBatchKeys.includes(idempotencyKey)
  );
}

/**
 * Кладёт ключ в кольцо — своё для применившего батча и своё для пустого.
 *
 * Ключ нужен обоим: без него повтор ОТКЛОНЁННОГО батча второй раз наплодил бы
 * диагностические факты об одних и тех же отказах. Но кольцо у них раздельное
 * (2026-07-26, внешний аудит), потому что цена вытеснения несимметрична:
 *
 *   - вытеснили ключ применённого батча → его сетевой ретрай перестал
 *     опознаваться как дубль и применился ВТОРЫМ приказом: мир изменился молча,
 *     ровно то, против чего ключ и заведён (docs/CONCEPT.md §7.2);
 *   - вытеснили ключ пустого → его повтор второй раз записал диагностику.
 *
 * В общем кольце на 32 записи дешёвое вытесняло дорогое: 32 заведомо
 * невозможных приказа игрока (или 32 пустых батча — это ловил и прежний тест,
 * фиксируя вытеснение `key-0` как норму) стирали ключ настоящего ответа модели.
 * Раздельные кольца делают эту подмену невозможной: пустые вытесняют только
 * пустых.
 */
function rememberBatchKey(game: GameState, idempotencyKey: string, changedWorld: boolean): void {
  if (changedWorld) {
    game.primitiveBatchKeys = [...game.primitiveBatchKeys, idempotencyKey].slice(
      -MAX_PRIMITIVE_BATCH_KEYS
    );
    return;
  }
  game.primitiveNoopBatchKeys = [...game.primitiveNoopBatchKeys, idempotencyKey].slice(
    -MAX_PRIMITIVE_BATCH_KEYS
  );
}

/**
 * Кладёт ключ ОТВЕТА в живое состояние — ровно один раз и в правильное кольцо.
 *
 * Зачем отдельно от `rememberBatchKey`. Ответ модели — это транзакция ШИРЕ
 * батча примитивов (`LLMService.processResponse`): у неё два канала, клон
 * состояния и собственный откат. Ключ, записанный движком, живёт на клоне и
 * потому:
 *   - при откате уходит вместе с клоном — повтор откаченного ответа заново
 *     писал бы диагностику, инкрементировал ход модели и врал признаком дубля;
 *   - при ответе БЕЗ примитивов не пишется вовсе — движка не звали, — и повтор
 *     применял старый канал `actions` второй раз (найдено независимым ревью
 *     2026-07-27: отношения 20 → 40 на повторе того же текста);
 *   - выбирает кольцо по числу применённых ПРИМИТИВОВ, а мир мог измениться
 *     старым каналом.
 *
 * Поэтому ключ ответа принадлежит уровню ответа: он переписывается сюда после
 * решения commit/rollback, в кольцо, выбранное по факту изменения МИРА обоими
 * каналами. Прежняя запись движка (она есть, если ответ закоммичен) снимается
 * из обоих колец, чтобы ключ не лежал в двух местах и не занимал слот дважды.
 */
export function rememberResponseBatchKey(
  game: GameState,
  idempotencyKey: string,
  changedWorld: boolean
): void {
  game.primitiveBatchKeys = game.primitiveBatchKeys.filter(key => key !== idempotencyKey);
  game.primitiveNoopBatchKeys = game.primitiveNoopBatchKeys.filter(key => key !== idempotencyKey);
  rememberBatchKey(game, idempotencyKey, changedWorld);
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
 * @param source канал запроса — влияет только на учёт диагностики отказов
 *   (у игрока и режиссёра свои квоты подробных записей, docs/PRIMITIVES.md §3).
 */
export function applyPrimitiveTurn(
  game: GameState,
  primitives: readonly Primitive[],
  idempotencyKey: string,
  source: WorldFactSource = "player"
): PrimitiveTurnResult {
  if (isDuplicatePrimitiveBatch(game, idempotencyKey)) {
    return { duplicate: true, applied: [], outcomes: [], rejected: [] };
  }

  const result = applyPrimitiveBatch(game, primitives, source);

  // Всё, что читает состояние, — строго после движка (см. заметку о ссылках).
  const outcomes = buildPrimitiveOutcomes(game, result.applied);
  appendPlaceHistory(game, result.applied, outcomes);

  // Ключ записывается и тогда, когда всё было отклонено (повтор запроса не
  // должен второй раз наплодить диагностику), но в СВОЁ кольцо — пустые батчи
  // не вытесняют ключи применённых.
  rememberBatchKey(game, idempotencyKey, result.applied.length > 0);

  return { duplicate: false, applied: result.applied, outcomes, rejected: result.rejected };
}
