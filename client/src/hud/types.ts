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

/** Книги без реального контента в Срезе 2 (см. docs/plans/12_UI_REDESIGN.md, Срез 2 — честная заглушка вместо выдуманных данных; наполнение — Срез 3). */
export const BOOKS_WITHOUT_CONTENT: ReadonlySet<BookId> = new Set([
  "industry",
  "population",
  "politics",
  "diplomacy",
  "intelligence",
]);
