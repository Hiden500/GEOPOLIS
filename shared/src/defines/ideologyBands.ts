import { IDEOLOGY_AXIS_MAX, IDEOLOGY_AXIS_MIN } from "../types/politics/Ideology";

/**
 * Ступени шкал идеологии — разбиение каждой оси на именованные отрезки
 * (`docs/CONCEPT.md` §4.2, каталог зон 2026-07-27).
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ НИ ОДНОЙ ЧЕЛОВЕКОЧИТАЕМОЙ СТРОКИ. Множество ступеней
 * задаёт движок и только он: их ровно семь на ось в любом сценарии, потому что
 * это разбиение шкалы, а не содержание эпохи. Строка, множество которой
 * фиксировано движком, живёт в словарях интерфейса (`react-i18next`), а не в
 * данных партии — иначе четырнадцать одинаковых строк дублировались бы в
 * каждом сценарии, а третий язык требовал бы правки сценарных данных.
 * Обратный случай — именованные якоря (`IdeologyAnchor`): их множество
 * приносит СЦЕНАРИЙ («Перонизм» осмыслен в 1946 и бессмыслен в 1836), поэтому
 * они несут `LocalizedText` в данных. Критерий разделения — кто определяет
 * множество строк, а не то, в каком файле оно лежит (`docs/LOCALIZATION.md`).
 *
 * Отрезки полуоткрытые: `from <= value < to`, последний включает верхнюю
 * границу оси. Тест удерживает три свойства: покрытие всей шкалы без дыр,
 * отсутствие перекрытий и совпадение соседних границ.
 */
export interface IdeologyBand {
  /**
   * Ключ строки в словаре интерфейса (`client/src/i18n/locales/<locale>/ideology.json`,
   * секция `bands`). Не отображаемый текст и не идентификатор сущности мира.
   */
  readonly key: string;
  /** Нижняя граница, включительно. */
  readonly from: number;
  /** Верхняя граница, исключительно — кроме последней ступени оси. */
  readonly to: number;
}

/**
 * Роль государства в экономике: от полного плана до невмешательства.
 *
 * Ступени неравномерны по ширине намеренно. Равномерное деление посадило бы
 * половину мира 1946 года в один отрезок: колониальные администрации
 * сгруппированы около `0.2…0.35`, поэтому середина шкалы дробится мельче краёв.
 */
export const ECONOMIC_BANDS: readonly IdeologyBand[] = [
  { key: "command", from: IDEOLOGY_AXIS_MIN, to: -0.75 },
  { key: "planned", from: -0.75, to: -0.45 },
  { key: "stateDirected", from: -0.45, to: -0.15 },
  { key: "mixed", from: -0.15, to: 0.15 },
  { key: "regulatedMarket", from: 0.15, to: 0.4 },
  { key: "market", from: 0.4, to: 0.65 },
  { key: "freeMarket", from: 0.65, to: IDEOLOGY_AXIS_MAX },
] as const;

/** Способ формирования власти: от несменяемой до конкурентной процедуры. */
export const POLITICAL_BANDS: readonly IdeologyBand[] = [
  { key: "closedDictatorship", from: IDEOLOGY_AXIS_MIN, to: -0.8 },
  { key: "authoritarian", from: -0.8, to: -0.5 },
  { key: "restrictedRule", from: -0.5, to: -0.2 },
  { key: "managedCompetition", from: -0.2, to: 0.2 },
  { key: "limitedDemocracy", from: 0.2, to: 0.5 },
  { key: "competitiveDemocracy", from: 0.5, to: 0.8 },
  { key: "representativeDemocracy", from: 0.8, to: IDEOLOGY_AXIS_MAX },
] as const;

/**
 * Ступень, в которую попадает координата. Значения вне шкалы прижимаются к
 * краю: координата приходит из валидированных данных и из клампованного
 * сдвига, поэтому выход за границы означает дефект вызывающего кода, а не
 * входные данные — но молча вернуть `undefined` и показать игроку пустоту
 * хуже, чем показать крайнюю ступень.
 */
export function bandFor(bands: readonly IdeologyBand[], value: number): IdeologyBand {
  const found = bands.find(band => value >= band.from && value < band.to);
  if (found) return found;
  return value < bands[0]!.from ? bands[0]! : bands[bands.length - 1]!;
}
