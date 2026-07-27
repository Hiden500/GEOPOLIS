/**
 * Контракт примитива воздействия (docs/PRIMITIVES.md §1).
 *
 * Форма — `{ verb, target, params? }`, где:
 *   verb   — «буква» закрытого алфавита;
 *   target — на кого действует (страна / регион / демо-группа);
 *   params — КАЧЕСТВЕННЫЕ мета-параметры (направление, характер).
 *
 * `params` намеренно не содержит ни одного числового поля: величину эффекта
 * считает движок из состояния (docs/PRIMITIVES.md §1 — «LLM не задаёт
 * величины»). Это не соглашение в комментарии, а свойство типа и Zod-схемы,
 * проверяемое тестом.
 *
 * Тестовый v0 среза — пять глаголов из ~18 полного алфавита.
 */

import { type ImpactMemoryField } from "@shared/types/politics/Demographics";
import { type PrimitiveRejection } from "./rejections";

export const PRIMITIVE_VERBS = [
  "incite_unrest",
  "repress",
  "grant_autonomy",
  "enact_reform",
  "spawn_incident",
] as const;

export type PrimitiveVerb = (typeof PRIMITIVE_VERBS)[number];

/**
 * Два класса примитивов (docs/PRIMITIVES.md §1): мягкие — сдвиги состояния,
 * свободно комбинируются; структурные — меняют устройство сущности, максимум
 * 1 на ответ, валидируются и коммитятся последними.
 */
export const STRUCTURAL_VERBS: readonly PrimitiveVerb[] = ["enact_reform"];

export function isStructural(verb: PrimitiveVerb): boolean {
  return STRUCTURAL_VERBS.includes(verb);
}

/**
 * Качественный хинт силы. Число из него делает движок, не LLM. Словарь живёт в
 * `shared/src/types/politics/PrimitiveIntensity.ts`, потому что им типизирован
 * `PRIMITIVE_INTENSITY_POSITION` в `shared/src/defines/discontent.ts`; здесь —
 * реэкспорт, чтобы потребители движка импортировали всё из одного места.
 */
export {
  PRIMITIVE_INTENSITIES,
  type PrimitiveIntensity,
} from "@shared/types/politics/PrimitiveIntensity";

/** Направление реформы по экономической оси. */
export const REFORM_ECONOMIC_DIRECTIONS = ["left", "right"] as const;
export type ReformEconomicDirection = (typeof REFORM_ECONOMIC_DIRECTIONS)[number];

/** Направление реформы по политической оси. */
export const REFORM_POLITICAL_DIRECTIONS = ["authoritarian", "democratic"] as const;
export type ReformPoliticalDirection = (typeof REFORM_POLITICAL_DIRECTIONS)[number];

/** Характер инцидента — определяет тип объекта на карте, не его силу. */
export const INCIDENT_KINDS = ["protest", "uprising", "border_dispute"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/**
 * Форма примитива живёт в `primitiveSchemas.ts` и выводится из Zod-схемы:
 * у каждого глагола своя цель и свои параметры (discriminated union по `verb`).
 * Здесь — только реэкспорт, чтобы потребители движка по-прежнему брали и вход,
 * и результат из одного места.
 *
 * Реэкспорт ТОЛЬКО типов (`export type`): он стирается компиляцией, поэтому
 * взаимный импорт `types ↔ primitiveSchemas` не образует рантайм-цикла —
 * значения (`PRIMITIVE_VERBS` и прочие enum'ы) ходят строго в одну сторону,
 * отсюда в схемы.
 */
export type { Primitive, PrimitiveOf } from "./primitiveSchemas";

// --------------------------------------------------------------------------
// Факт применения — материал для нарратива, который пишется ТОЛЬКО после commit
// --------------------------------------------------------------------------

/**
 * Одно ФАКТИЧЕСКОЕ изменение поля памяти воздействий: у кого, что, было → стало.
 *
 * `before`/`after`/`delta` вместе, а не одна дельта: нарратив должен уметь
 * сказать и «выросло на 0.14», и «дошло до потолка», не заглядывая в состояние
 * (docs/PRIMITIVES.md §4 — «движок возвращает LLM фактические величины»).
 *
 * `delta === 0` — законная запись, а не мусор: «примитив попытался, но не легло
 * ничего» тоже факт, и замалчивать его нельзя, иначе резюме снова начнёт
 * утверждать эффект, которого не было.
 */
export interface GroupImpactEffect {
  regionId: number;
  groupId: string;
  field: ImpactMemoryField;
  before: number;
  after: number;
  delta: number;
}

/** Ось координат идеологии, которую двигала реформа. */
export type IdeologyAxis = "economic" | "political";

/** Фактический сдвиг одной оси координат идеологии страны. */
export interface IdeologyShiftEffect {
  countryId: string;
  axis: IdeologyAxis;
  /** Качественное направление, которое запросил примитив. */
  direction: ReformEconomicDirection | ReformPoliticalDirection;
  before: number;
  after: number;
  delta: number;
}

/** Фактически уплаченная политическая цена (`governmentSupport`, шкала 0..100). */
export interface PoliticalCostEffect {
  countryId: string;
  field: "governmentSupport";
  before: number;
  after: number;
  /** Отрицательная: цена именно списывается. */
  delta: number;
}

/**
 * Общая часть факта применения.
 *
 * `summary` — человеческое резюме, а НЕ источник истины: оно обязано выводиться
 * из полей эффектов конкретного варианта ниже. До 2026-07-26 результат был
 * одним скаляром `magnitude` плюс заранее заготовленная строка, и строка врала:
 * `grant_autonomy` с нулевым откликом соседей всё равно сообщал, что соседние
 * общины «took heart», а реформа у края спектра — что «politics shifted
 * authoritarian», не сдвинув координату. Теперь по результату можно построить
 * правдивое описание, не заглядывая в состояние; резюме — производное от него.
 */
interface AppliedPrimitiveBase {
  sourceCountryId: string;
  summary: string;
}

export interface AppliedInciteUnrest extends AppliedPrimitiveBase {
  verb: "incite_unrest";
  regionId: number;
  groupId: string;
  targetEffects: GroupImpactEffect[];
}

export interface AppliedRepress extends AppliedPrimitiveBase {
  verb: "repress";
  regionId: number;
  targetEffects: GroupImpactEffect[];
}

export interface AppliedGrantAutonomy extends AppliedPrimitiveBase {
  verb: "grant_autonomy";
  regionId: number;
  targetEffects: GroupImpactEffect[];
  /**
   * Отклик той же группы в СОСЕДНИХ регионах — отдельным полем, а не в общей
   * куче: это цена уступки, и нарратив обязан отличать её от самой уступки.
   * Пустой массив означает буквально «соседи не сдвинулись».
   */
  neighbourEffects: GroupImpactEffect[];
}

export interface AppliedEnactReform extends AppliedPrimitiveBase {
  verb: "enact_reform";
  countryId: string;
  /** Только те оси, которые реформа просила двигать; все они реально сдвинулись. */
  ideologyShifts: IdeologyShiftEffect[];
  politicalCost: PoliticalCostEffect;
}

export interface AppliedSpawnIncident extends AppliedPrimitiveBase {
  verb: "spawn_incident";
  regionId: number;
  incidentKind: IncidentKind;
  /** id созданного объекта карты — чтобы нарратив ссылался на него, а не искал. */
  mapFeatureId: string;
  /** Страна по ту сторону спорной границы; только у `border_dispute`. */
  disputedWithCountryId?: string | undefined;
  targetEffects: GroupImpactEffect[];
}

/**
 * Discriminated union по глаголу: у каждого verb своя форма фактов, и лишнего
 * поля в ней нет. Общего скаляра «магнитуда» тут намеренно нет — один усреднённый
 * канал не описывает примитив, у которого их несколько (repress пишет и
 * подавление, и отчуждение), и именно на нём строилась ложь прежнего API.
 */
export type AppliedPrimitive =
  | AppliedInciteUnrest
  | AppliedRepress
  | AppliedGrantAutonomy
  | AppliedEnactReform
  | AppliedSpawnIncident;

/**
 * Все следы примитива в памяти воздействий одним списком — и прямые, и побочные.
 *
 * Используется бюджетом накопления следа и как ЧАСТЬ общей сверки отчёта с
 * состоянием (`reconciliation.ts`), которая с Милстоуна 1 покрывает не только
 * память воздействий, но и координаты идеологии, поддержку правительства и
 * созданные объекты карты. Функция здесь, а не по месту, чтобы новый verb с
 * новым каналом памяти нельзя было забыть подключить — `switch` без ветки не
 * компилируется.
 */
export function impactEffectsOf(applied: AppliedPrimitive): GroupImpactEffect[] {
  switch (applied.verb) {
    case "grant_autonomy":
      return [...applied.targetEffects, ...applied.neighbourEffects];
    case "enact_reform":
      return [];
    case "incite_unrest":
    case "repress":
    case "spawn_incident":
      return applied.targetEffects;
  }
}

/**
 * Отклонение целиком — со СТРУКТУРНОЙ причиной (docs/PRIMITIVES.md §3).
 *
 * `rejection` — код + типизированные параметры (`rejections.ts`), а не строка:
 * причина уходит игроку по-русски и в промт по-английски, и одна строка не
 * может быть обеими сразу. Готового текста здесь нет вовсе, чтобы ни один
 * потребитель не мог случайно показать чужой.
 *
 * `verb` и `sourceCountryId` необязательны: запись, отклонённая структурной
 * схемой, может не нести ни того, ни другого. Движок заполняет оба всегда —
 * до него доезжает только разобранный примитив.
 */
export interface RejectedPrimitive {
  verb?: PrimitiveVerb | undefined;
  sourceCountryId?: string | undefined;
  rejection: PrimitiveRejection;
}

export interface PrimitiveBatchResult {
  applied: AppliedPrimitive[];
  rejected: RejectedPrimitive[];
}

/** Результат фазы validate: либо pass, либо структурная причина отказа. */
export type PreconditionResult = { valid: true } | { valid: false; rejection: PrimitiveRejection };
