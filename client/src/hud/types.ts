/**
 * Общие типы HUD (docs/plans/12_UI_REDESIGN.md, Срез 2 — каркас).
 * 9 «книг» левой панели — фиксированный набор из эталона §1, порядок важен
 * (соответствует хоткеям 1-9).
 */
export type BookId =
  | "economy"
  | "industry"
  | "technology"
  | "population"
  | "politics"
  | "diplomacy"
  | "intelligence"
  | "rankings"
  | "chronicle";

export const BOOK_ORDER: BookId[] = [
  "economy",
  "industry",
  "technology",
  "population",
  "politics",
  "diplomacy",
  "intelligence",
  "rankings",
  "chronicle",
];

/**
 * Книги без реального контента в Срезе 2 (см. docs/plans/12_UI_REDESIGN.md,
 * Срез 2 — честная заглушка вместо выдуманных данных; наполнение — Срез 3).
 * "population" сюда НЕ входит: отдана TerritoriesPanel (список регионов
 * игрока) — старая шапка теряла единственный вход в этот экран при замене
 * TopStatBar, регион-данные реальны и тематически подходят разделу.
 */
export const BOOKS_WITHOUT_CONTENT: ReadonlySet<BookId> = new Set([
  "industry",
  "politics",
  "diplomacy",
  "intelligence",
]);

/** Выделение на карте — источник контент-панели справа (docs/plans/12_UI_REDESIGN.md §1). */
export type Selection = { type: "region"; regionId: number } | { type: "country"; countryId: string };
