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
 * Книги без реального контента (честная заглушка вместо выдуманных данных,
 * docs/plans/12_UI_REDESIGN.md §2). Срез 3в наполнил industry/politics/
 * diplomacy реальными данными — "intelligence" остаётся: в игре нет
 * механики разведки (подтверждено, не просто "руки не дошли" — тот же
 * статус, что в самом эталонном мокапе: "Система разведки — в разработке").
 */
export const BOOKS_WITHOUT_CONTENT: ReadonlySet<BookId> = new Set(["intelligence"]);

/** Выделение на карте — источник контент-панели справа (docs/plans/12_UI_REDESIGN.md §1). */
export type Selection = { type: "region"; regionId: number } | { type: "country"; countryId: string };
