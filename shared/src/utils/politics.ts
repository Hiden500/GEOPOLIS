import { type IdeologyCoordinates } from "../types/politics/Ideology";
import { type PowerStructure } from "../types/politics/Government";
import { COUNTRY_POLITICS_SCALE_MAX } from "../defines/discontent";
import {
  POWER_STRUCTURE_CORRUPTION_BASE,
  POWER_STRUCTURE_LEGITIMACY_MANDATE,
  CORRUPTION_EQUILIBRIUM_DEFAULT,
  LEGITIMACY_SPECTRUM_BASE,
  LEGITIMACY_DEMOCRATIC_MANDATE_WEIGHT,
  LEGITIMACY_CONSOLIDATION_WEIGHT,
} from "../defines/politics";

/**
 * Структурные базисы политики — чистые функции над позицией режима
 * (docs/POLITICS.md).
 *
 * Живут в `shared/`, а не рядом с тиком, по той же причине, что и вывод
 * недовольства: клиент вправе показать то же число теми же правилами, не
 * дублируя формулу. Числа — в `shared/src/defines/politics.ts` (fitness-правило
 * 4 запрещает литералы баланса в `server/src/simulation/**`).
 *
 * ЧТО ЗДЕСЬ ПОМЕНЯЛОСЬ 2026-07-30. Обе базы читались по строковому ярлыку
 * `politics.ideology`: таблицы знали 10 ключей, в данных 1946 встречались 3, и
 * 78 стран из 157 получали дефолт — то есть Испания Франко, Саудовская Аравия и
 * британская Индия были для движка одним и тем же режимом. Теперь коррупция
 * читается по форме власти, легитимность — по координатам спектра с поправкой
 * на происхождение власти, и в дефолт не падает никто.
 */

function clampToPoliticsScale(value: number): number {
  return Math.max(0, Math.min(COUNTRY_POLITICS_SCALE_MAX, value));
}

/**
 * Структурное равновесие коррупции по механизму удержания власти.
 *
 * `undefined` — не «страна без коррупции», а «форма власти не размечена»
 * (сценарии без слоя `government.json`): такая страна получает фолбэк.
 */
export function corruptionBase(powerStructure: PowerStructure | undefined): number {
  if (!powerStructure) return CORRUPTION_EQUILIBRIUM_DEFAULT;
  return POWER_STRUCTURE_CORRUPTION_BASE[powerStructure];
}

/**
 * База легитимности: положение на политической оси плюс поправка на
 * происхождение власти.
 *
 * Кривая по оси U-образная (консолидированный полюс имеет источник мандата,
 * гибрид — ни одного) с наклоном в пользу демократии; экономическая ось не
 * участвует. Разбор обоих решений — у констант в `defines/politics.ts`.
 *
 * `powerStructure === undefined` даёт нулевую поправку, а не штраф: неизвестная
 * форма власти — это «не размечено», а не «власть ниоткуда».
 */
export function legitimacyBase(
  coordinates: IdeologyCoordinates,
  powerStructure: PowerStructure | undefined
): number {
  const spectrum =
    LEGITIMACY_SPECTRUM_BASE +
    LEGITIMACY_DEMOCRATIC_MANDATE_WEIGHT * coordinates.political +
    LEGITIMACY_CONSOLIDATION_WEIGHT * Math.abs(coordinates.political);

  const mandate = powerStructure ? POWER_STRUCTURE_LEGITIMACY_MANDATE[powerStructure] : 0;

  return clampToPoliticsScale(spectrum + mandate);
}
