import { z } from "zod";
import {
  PRIMITIVE_VERBS,
  PRIMITIVE_INTENSITIES,
  REFORM_ECONOMIC_DIRECTIONS,
  REFORM_POLITICAL_DIRECTIONS,
  INCIDENT_KINDS,
  type Primitive,
} from "./types";
import {
  MAX_SOFT_PRIMITIVES_PER_TURN,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PRIMITIVE_ID_LENGTH,
} from "@shared/defines/discontent";

/**
 * Структурная валидация примитива (тот же слой, что actionSchemas.ts для
 * старых 11 действий: docs/plans/02_LLM_CONTRACT.md). Семантическая
 * применимость — фаза validate движка (PrimitiveEngine.ts), она знает про
 * конкретную партию, чего схема знать не может.
 *
 * СТЫК ДЛЯ LLM-ПУТИ: это единственное, что нужно подключить к structured
 * output. Схема `.strict()` по params — любое числовое поле, которое модель
 * попробует дописать («сила: 0.8»), не просто игнорируется, а валит примитив:
 * величины считает движок и только движок (docs/PRIMITIVES.md §1).
 */

/**
 * Идентификатор внутри примитива: непустой и ОГРАНИЧЕННЫЙ СВЕРХУ.
 *
 * Верхняя граница здесь не про «влезет ли в поле», а про то, куда строка
 * уезжает дальше. Несуществующий идентификатор отклоняет фаза validate движка,
 * и её причина несёт исходную строку дословно («`Unknown ethnic group: <id>`»);
 * причина уходит диагностическим фактом в следующий промт. Без `.max()` тело
 * запроса попадало в промт целиком — замер ревью 2026-07-26: 50 приказов с
 * `groupId` из 500 символов давали секцию отказов на 28 144 символа
 * (`MAX_PRIMITIVE_ID_LENGTH`).
 */
const primitiveIdSchema = z.string().min(1).max(MAX_PRIMITIVE_ID_LENGTH);

export const primitiveTargetSchema = z.object({
  countryId: primitiveIdSchema.optional(),
  regionId: z.number().int().positive().optional(),
  groupId: primitiveIdSchema.optional(),
}).strict();

/**
 * Качественные параметры — закрытые перечисления, ни одного числового поля.
 * `.strict()` здесь и есть машинная формулировка правила «LLM не задаёт
 * величины»: посторонний ключ = ошибка схемы, а не молча отброшенное поле.
 */
export const primitiveParamsSchema = z.object({
  intensity: z.enum(PRIMITIVE_INTENSITIES).optional(),
  economicDirection: z.enum(REFORM_ECONOMIC_DIRECTIONS).optional(),
  politicalDirection: z.enum(REFORM_POLITICAL_DIRECTIONS).optional(),
  incidentKind: z.enum(INCIDENT_KINDS).optional(),
}).strict();

export const primitiveSchema = z.object({
  verb: z.enum(PRIMITIVE_VERBS),
  sourceCountryId: primitiveIdSchema,
  target: primitiveTargetSchema,
  params: primitiveParamsSchema.optional(),
}).strict();

/**
 * Кап длины ОДНОГО ЗАПРОСА — сумма мягкого и структурного лимитов хода
 * (docs/PRIMITIVES.md §4).
 *
 * Здесь «за батч» осознанно: это transport-граница массива в теле запроса, а не
 * бюджет хода. Больше, чем ход вообще способен потратить, в одном запросе слать
 * незачем — но и меньше нельзя, иначе законный полный ход не влез бы в один
 * вызов. Сам расход считает движок по `GameState.primitiveTurnBudget`, и через
 * несколько запросов эту сумму всё равно не превысить.
 */
export const MAX_PRIMITIVES_PER_BATCH =
  MAX_SOFT_PRIMITIVES_PER_TURN + MAX_STRUCTURAL_PRIMITIVES_PER_TURN;

export const primitiveBatchSchema = z.array(primitiveSchema).max(MAX_PRIMITIVES_PER_BATCH);

/**
 * Компайл-тайм проверка, что схема и тип не разъехались (тот же приём, что в
 * actionSchemas.ts). Если поле добавили в Primitive и забыли в схеме — здесь
 * будет ошибка типов, а не тихо непринимаемый примитив в рантайме.
 */
type SchemaPrimitive = z.infer<typeof primitiveSchema>;
type AssertAssignable<A extends B, B> = true;
export type _SchemaMatchesType = AssertAssignable<SchemaPrimitive, Primitive>;

/**
 * Разбирает сырой массив примитивов, разделяя структурно валидные и битые.
 * Возвращает причины по каждому отклонению — их вызывающий кладёт в
 * диагностику, а не глотает.
 */
export function parsePrimitives(raw: unknown): {
  primitives: Primitive[];
  invalid: { index: number; reason: string }[];
} {
  const primitives: Primitive[] = [];
  const invalid: { index: number; reason: string }[] = [];

  if (!Array.isArray(raw)) {
    return { primitives, invalid: [{ index: -1, reason: "Primitives payload is not an array" }] };
  }
  if (raw.length > MAX_PRIMITIVES_PER_BATCH) {
    invalid.push({
      index: -1,
      reason: `Batch of ${raw.length} exceeds the cap of ${MAX_PRIMITIVES_PER_BATCH}`,
    });
  }

  raw.slice(0, MAX_PRIMITIVES_PER_BATCH).forEach((entry, index) => {
    const parsed = primitiveSchema.safeParse(entry);
    if (parsed.success) primitives.push(parsed.data);
    else invalid.push({ index, reason: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") });
  });

  return { primitives, invalid };
}
