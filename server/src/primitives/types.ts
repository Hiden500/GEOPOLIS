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

import { type PrimitiveIntensity } from "@shared/types/politics/PrimitiveIntensity";

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

export interface PrimitiveParams {
  intensity?: PrimitiveIntensity | undefined;
  economicDirection?: ReformEconomicDirection | undefined;
  politicalDirection?: ReformPoliticalDirection | undefined;
  incidentKind?: IncidentKind | undefined;
}

export interface PrimitiveTarget {
  countryId?: string | undefined;
  regionId?: number | undefined;
  groupId?: string | undefined;
}

export interface Primitive {
  verb: PrimitiveVerb;
  /** Кто действует. Для действий власти над своей территорией — она же контролёр региона. */
  sourceCountryId: string;
  target: PrimitiveTarget;
  params?: PrimitiveParams | undefined;
}

/** Факт применения — материал для нарратива, который пишется ТОЛЬКО после commit. */
export interface AppliedPrimitive {
  verb: PrimitiveVerb;
  /** Итоговая величина, посчитанная движком (для правдивых чисел в нарративе). */
  magnitude: number;
  /** Что фактически изменилось, человеческим языком (en — язык промта). */
  summary: string;
  regionId?: number | undefined;
  countryId?: string | undefined;
}

/** Отклонение целиком — с диагностической причиной (docs/PRIMITIVES.md §3). */
export interface RejectedPrimitive {
  verb: PrimitiveVerb;
  sourceCountryId: string;
  reason: string;
}

export interface PrimitiveBatchResult {
  applied: AppliedPrimitive[];
  rejected: RejectedPrimitive[];
}

/** Результат фазы validate: либо pass, либо причина отказа. */
export type PreconditionResult = { valid: true } | { valid: false; reason: string };
