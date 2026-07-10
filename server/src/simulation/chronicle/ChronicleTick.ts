import { type GameState } from "@shared/types/GameState";

/**
 * Сколько последних заголовков завершившегося года попадает в одну
 * строку-summary летописи — тот же принцип "cheap window", что
 * getRecentTitlesLine/getRecentEventsInfo в LLMService.ts (.slice(-N)), не
 * новая эвристика. "3-5 строк на год" из плана — трактовка: до 5
 * заголовков, склеенных через "; " в одну строку промта, не 5 физических
 * строк.
 */
const CHRONICLE_TITLES_PER_YEAR = 5;

/**
 * Раз в год (январский тик, SimulationEngine.ts) склеивает заголовки
 * eventHistory завершившегося года в одну запись летописи —
 * docs/plans/02_LLM_CONTRACT.md, Шаг 3. Вызывается уже ПОСЛЕ того как
 * game.currentDate продвинута на январь нового года — "только что
 * закончившийся год" вычисляется как currentYear - 1.
 *
 * Детерминированная конкатенация, без вызова LLM (docs/DECISIONS.md,
 * 2026-07-05: сначала дешёвый дефолт, LLM-сжатие — только если окажется
 * недостаточным на практике).
 */
export function chronicleTick(game: GameState): void {
  const currentYear = Number(game.currentDate.split("-")[0]);
  const endedYear = currentYear - 1;
  const yearPrefix = `${endedYear}-`;

  const yearEvents = game.eventHistory.filter(e => e.date.startsWith(yearPrefix));
  if (yearEvents.length === 0) return; // пустой год (LLM не отвечала весь год) — не засорять летопись

  const summary = yearEvents
    .slice(-CHRONICLE_TITLES_PER_YEAR)
    .map(e => e.title)
    .join("; ");

  game.chronicle.push({ year: endedYear, summary });
}
