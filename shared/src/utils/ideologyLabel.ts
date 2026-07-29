import {
  ECONOMIC_BANDS,
  POLITICAL_BANDS,
  bandFor,
  type IdeologyBand,
} from "../defines/ideologyBands";
import { type IdeologyAnchor } from "../types/politics/IdeologyAnchor";
import { type IdeologyCoordinates } from "../types/politics/Ideology";

/**
 * Как показать позицию страны на спектре (`docs/CONCEPT.md` §4.2).
 *
 * Два вида результата, а не одна строка, потому что источники строк разные и
 * склеивать их здесь нельзя: имя якоря — контент сценария с готовыми
 * переводами, ступени — ключи словаря интерфейса. Разрешение в текст делает
 * слой отображения, у которого есть и локаль, и `t()`.
 */
export type IdeologyLabel =
  | { kind: "anchor"; anchor: IdeologyAnchor }
  | { kind: "bands"; economic: IdeologyBand; political: IdeologyBand };

function distance(a: IdeologyCoordinates, b: IdeologyCoordinates): number {
  return Math.hypot(a.economic - b.economic, a.political - b.political);
}

/**
 * Ярлык позиции: ближайший якорь, накрывающий точку, иначе — пара ступеней.
 *
 * ЯРЛЫК ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ. Держать его строкой в состоянии значит
 * держать производное значение рядом с источником: сдвиг координат реформой
 * оставил бы строку прежней, и страна показывалась бы старым режимом после
 * смены курса. Ровно из-за хранимого ярлыка возник дефект союзов — решение
 * принималось по тексту наклейки (`docs/DECISIONS.md`, 2026-07-27).
 *
 * Порядок «якорь раньше ступеней» задан каталогом: якорь описывает конкретное
 * явление, ступени — общее положение, и конкретное точнее.
 */
export function resolveIdeologyLabel(
  coordinates: IdeologyCoordinates,
  anchors: readonly IdeologyAnchor[]
): IdeologyLabel {
  let nearest: IdeologyAnchor | undefined;
  let nearestDistance = Infinity;

  for (const anchor of anchors) {
    const d = distance(coordinates, anchor.center);
    // Строгое `<` даёт устойчивость к порядку в массиве: при равной дистанции
    // выигрывает первый по каталогу, а не последний прочитанный.
    if (d <= anchor.radius && d < nearestDistance) {
      nearest = anchor;
      nearestDistance = d;
    }
  }

  if (nearest) return { kind: "anchor", anchor: nearest };

  return {
    kind: "bands",
    economic: bandFor(ECONOMIC_BANDS, coordinates.economic),
    political: bandFor(POLITICAL_BANDS, coordinates.political),
  };
}
