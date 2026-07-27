import { type EventFactuality } from "@shared/types/Event";

/**
 * Классификация текста события по ФАКТИЧЕСКОМУ результату ответа модели
 * (docs/PRIMITIVES.md §3; решение пользователя 2026-07-27 по итогам внешнего
 * аудита).
 *
 * Зачем отдельной функцией, а не флагом в `processResponse`. Степень
 * подтверждённости — то, ради чего вся правка и делалась: если её выставляет
 * вызывающий «по смыслу», она стоит ровно столько же, сколько заголовок,
 * который она аттестует. Здесь у неё один источник — числа предложенного,
 * применённого и отклонённого по обоим каналам ответа, — и ни одного входа,
 * через который можно было бы объявить событие подтверждённым, не применив
 * ничего.
 *
 * Направление отказа выбрано в пользу недоверия: «подтверждено» требует
 * СОВПАДЕНИЯ двух независимых признаков — ни одного отказа и число применённых
 * равно числу предложенных. Примитив, потерянный где-то без записи об отказе,
 * даёт `partial`, а не `confirmed`.
 */
export interface ResponseApplicationCounts {
  /** Сколько элементов старого канала `actions` пришло в ответе. */
  proposedActions: number;
  appliedActions: number;
  rejectedActions: number;
  /** Сколько элементов канала `primitives` пришло в ответе (до разбора схемой). */
  proposedPrimitives: number;
  appliedPrimitives: number;
  rejectedPrimitives: number;
}

export function deriveEventFactuality(counts: ResponseApplicationCounts): EventFactuality {
  const proposed = counts.proposedActions + counts.proposedPrimitives;

  // Ответ без единого предложения к движку — чистый нарратив (§4). Проверять
  // нечего: движка он не просил ни о чём. Но и подтверждения у его утверждений
  // нет, поэтому это не `confirmed`, а отдельное третье состояние.
  if (proposed === 0) return "unconfirmed";

  const applied = counts.appliedActions + counts.appliedPrimitives;
  const rejected = counts.rejectedActions + counts.rejectedPrimitives;

  return rejected === 0 && applied === proposed ? "confirmed" : "partial";
}
