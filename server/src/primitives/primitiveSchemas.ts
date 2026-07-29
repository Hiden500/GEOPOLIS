import { z } from "zod";
import {
  PRIMITIVE_VERBS,
  PRIMITIVE_INTENSITIES,
  REFORM_ECONOMIC_DIRECTIONS,
  REFORM_POLITICAL_DIRECTIONS,
  INCIDENT_KINDS,
  RELATION_DIRECTIONS,
  type PrimitiveVerb,
} from "./types";
import {
  MAX_SOFT_PRIMITIVES_PER_TURN,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PRIMITIVE_ID_LENGTH,
} from "@shared/defines/discontent";
import { MAX_WAR_GOAL_LENGTH } from "@shared/defines/diplomacy";
import { SANCTION_TYPES } from "@shared/types/DiplomacyState";

/**
 * Структурная форма примитива — ОДИН источник истины (docs/PRIMITIVES.md §1).
 *
 * Схема здесь первична, а тип `Primitive` выводится из неё (`z.infer`). До
 * Милстоуна 1 было наоборот: тип объявлялся руками, схема писалась рядом, а
 * компайл-тайм `AssertAssignable` ловил расхождение постфактум. Расхождение он
 * ловил, но не ловил ГЛАВНОГО: форма была ОДНА на все глаголы —
 * `target {countryId?, regionId?, groupId?}` и `params {intensity?,
 * economicDirection?, politicalDirection?, incidentKind?}`, все поля
 * необязательные. Поэтому `repress` с `params.incidentKind` и
 * `target.countryId` проходил валидацию целиком, а обработчик молча игнорировал
 * лишнее: модель получала «применено» на примитив, половину которого движок
 * не читал. При пяти глаголах это редкость, при восемнадцати — систематический
 * источник ошибок провайдера, выглядящих валидными.
 *
 * Теперь форма объявляется ПО ГЛАГОЛУ, и `z.discriminatedUnion` по `verb`
 * означает три вещи сразу:
 *   - чужое поле — ошибка схемы, а не молчание (`.strict()` в каждой ветке);
 *   - обязательное поле глагола нельзя не прислать (`incite_unrest` без
 *     `groupId` больше не доезжает до движка);
 *   - отказ схемы ЗНАЕТ ГЛАГОЛ (см. `parsePrimitives`) — до этого примитив,
 *     провалившийся структурно, не нёс глагола вовсе, и отличить
 *     провалившийся `enact_reform` от провалившегося `repress` было нечем.
 *
 * Добавление глагола = одна запись в `PRIMITIVE_SCHEMAS`. Реестр типизирован
 * `Record<PrimitiveVerb, …>`, поэтому глагол, добавленный в алфавит и забытый
 * здесь, не компилируется.
 *
 * СТЫК ДЛЯ LLM-ПУТИ: `primitiveSchema` — единственное, что уходит в structured
 * output провайдера (`toProviderSchema`). Второй, «схемы для генерации», не
 * существует: он разъехался бы с валидацией на первой же правке.
 */

/**
 * Идентификатор внутри примитива: непустой и ОГРАНИЧЕННЫЙ СВЕРХУ.
 *
 * Верхняя граница здесь не про «влезет ли в поле», а про то, куда строка
 * уезжает дальше. Несуществующий идентификатор отклоняет фаза validate движка,
 * и её причина несёт исходную строку; причина уходит диагностическим фактом в
 * следующий промт. Без `.max()` тело запроса попадало в промт целиком — замер
 * ревью 2026-07-26: 50 приказов с `groupId` из 500 символов давали секцию
 * отказов на 28 144 символа (`MAX_PRIMITIVE_ID_LENGTH`).
 */
const primitiveIdSchema = z.string().min(1).max(MAX_PRIMITIVE_ID_LENGTH);

const regionIdSchema = z.number().int().positive();

// --------------------------------------------------------------------------
// Цели — по глаголу, а не одна на всех
// --------------------------------------------------------------------------

/** Подстрекательство адресуется КОНКРЕТНОЙ группе: «разжечь вообще» бессмысленно. */
const inciteTargetSchema = z.object({
  regionId: regionIdSchema,
  groupId: primitiveIdSchema,
}).strict();

/**
 * Репрессия и уступка адресуются либо группе, либо региону целиком, и разница
 * для игрока существенная: приказ по региону бьёт по ВСЕМ его группам.
 */
const regionOrGroupTargetSchema = z.object({
  regionId: regionIdSchema,
  groupId: primitiveIdSchema.optional(),
}).strict();

/** Инцидент ставится в регион; кого он подогреет, решает движок по составу. */
const regionTargetSchema = z.object({
  regionId: regionIdSchema,
}).strict();

/**
 * Реформа адресуется стране, и страну надо НАЗВАТЬ.
 *
 * До Милстоуна 1 поле было необязательным и подразумевало источник. Умолчание
 * стоило дороже, чем экономило: движок всё равно отклоняет реформу, чья цель не
 * равна источнику (внутриполитический акт платит сам за себя), поэтому
 * умолчание лишь скрывало намерение модели — «забыла назвать» и «назвала себя»
 * становились неотличимы.
 */
const countryTargetSchema = z.object({
  countryId: primitiveIdSchema,
}).strict();

// --------------------------------------------------------------------------
// Параметры — качественные, ни одного числового поля ни в одной ветке
// --------------------------------------------------------------------------

const intensitySchema = z.enum(PRIMITIVE_INTENSITIES);

/**
 * `.strict()` здесь и есть машинная формулировка правила «LLM не задаёт
 * величины»: посторонний ключ = ошибка схемы, а не молча отброшенное поле.
 * Числовое поле («сила: 0.8») не просто игнорируется — оно валит примитив.
 */
const intensityOnlyParamsSchema = z.object({
  intensity: intensitySchema.optional(),
}).strict();

const reformParamsSchema = z.object({
  intensity: intensitySchema.optional(),
  economicDirection: z.enum(REFORM_ECONOMIC_DIRECTIONS).optional(),
  politicalDirection: z.enum(REFORM_POLITICAL_DIRECTIONS).optional(),
}).strict();

const incidentParamsSchema = z.object({
  intensity: intensitySchema.optional(),
  incidentKind: z.enum(INCIDENT_KINDS).optional(),
}).strict();

/**
 * Санкция: вид — качественный выбор модели, а не величина. Необязателен;
 * умолчание задаёт движок.
 */
const sanctionParamsSchema = z.object({
  sanctionType: z.enum(SANCTION_TYPES).optional(),
}).strict();

/**
 * Дипломатический жест: направление плюс интенсивность.
 *
 * Направление обязательно ПО СМЫСЛУ, но объявлено необязательным здесь и
 * проверяется предпосылкой движка (`diplomacyNoDirection`) — ровно по той же
 * причине и тем же способом, что «хотя бы одно направление» у реформы: сделать
 * `params` обязательными означало бы завести вторую форму записи реестра ради
 * одного глагола, а `.refine()` ломает `z.discriminatedUnion` и схему
 * провайдера.
 */
const diplomacyParamsSchema = z.object({
  intensity: intensitySchema.optional(),
  direction: z.enum(RELATION_DIRECTIONS).optional(),
}).strict();

/**
 * Объявление войны: цель войны свободным текстом и ничего больше.
 *
 * `intensity` здесь ОТСУТСТВУЕТ, и это заявление, а не упущение: у структурного
 * глагола величины нет — война либо объявлена, либо нет. Приславший
 * `params.intensity` получит ошибку схемы вместо молча проигнорированного поля.
 */
const warParamsSchema = z.object({
  warGoal: z.string().min(1).max(MAX_WAR_GOAL_LENGTH).optional(),
}).strict();

/** Мир параметров не имеет вовсе — по той же причине, что и война. */
const noParamsSchema = z.object({}).strict();

/**
 * «Хотя бы одно направление» у реформы намеренно НЕ здесь, а предпосылкой
 * движка. Причина техническая и названа явно: `.refine()` превращает ветку в
 * `ZodEffects`, а `z.discriminatedUnion` и `z.toJSONSchema` (схема провайдера)
 * работают с объектными ветками. Требование от этого не теряется — движок
 * отклоняет такую реформу кодом `reformNoDirection`, — но проверяется на слой
 * позже, и это единственное правило формы, живущее вне схемы.
 */

// --------------------------------------------------------------------------
// Реестр: глагол → его форма
// --------------------------------------------------------------------------

function primitiveOf<V extends PrimitiveVerb, T extends z.ZodTypeAny, P extends z.ZodTypeAny>(
  verb: V,
  target: T,
  params: P
) {
  return z.object({
    verb: z.literal(verb),
    /** Кто действует. Для действий власти над своей территорией — она же контролёр региона. */
    sourceCountryId: primitiveIdSchema,
    target,
    params: params.optional(),
  }).strict();
}

export const PRIMITIVE_SCHEMAS = {
  incite_unrest: primitiveOf("incite_unrest", inciteTargetSchema, intensityOnlyParamsSchema),
  repress: primitiveOf("repress", regionOrGroupTargetSchema, intensityOnlyParamsSchema),
  grant_autonomy: primitiveOf("grant_autonomy", regionOrGroupTargetSchema, intensityOnlyParamsSchema),
  enact_reform: primitiveOf("enact_reform", countryTargetSchema, reformParamsSchema),
  spawn_incident: primitiveOf("spawn_incident", regionTargetSchema, incidentParamsSchema),
  split_country: primitiveOf("split_country", countryTargetSchema, intensityOnlyParamsSchema),
  // Дипломатический блок: цель — ДРУГАЯ страна. Равенство цели источнику
  // проверяет предпосылка движка (`bilateralSelfTarget`), а не схема: это
  // свойство ПАРЫ, и правило класса «отказ структурного отклоняет весь ответ»
  // требует, чтобы отказ нёс глагол, — что схема даёт только объектным веткам.
  diplomacy: primitiveOf("diplomacy", countryTargetSchema, diplomacyParamsSchema),
  sanction: primitiveOf("sanction", countryTargetSchema, sanctionParamsSchema),
  war: primitiveOf("war", countryTargetSchema, warParamsSchema),
  peace: primitiveOf("peace", countryTargetSchema, noParamsSchema),
  // Мягкие воздействия Милстоуна 1. Три адресуются стране, `capital_flight` —
  // региону: отток капитала бьёт по производству, а производство живёт в
  // регионе (`docs/ECONOMY.md`).
  send_aid: primitiveOf("send_aid", countryTargetSchema, intensityOnlyParamsSchema),
  capital_flight: primitiveOf("capital_flight", regionTargetSchema, intensityOnlyParamsSchema),
  condemn: primitiveOf("condemn", countryTargetSchema, intensityOnlyParamsSchema),
  support_proxy: primitiveOf("support_proxy", countryTargetSchema, intensityOnlyParamsSchema),
  // Подчинение и поглощение параметров не имеют ВОВСЕ — по той же причине, что
  // `war` и `peace`: у структурного глагола величины нет. Государство либо
  // подчинено, либо нет; земля либо перешла, либо не перешла. `intensity` здесь
  // нечему двигать даже как порог — какие именно регионы переходят, решает
  // фактический контроль, а не хинт, и приславший `params.intensity` получит
  // ошибку схемы вместо молча проигнорированного поля.
  puppet: primitiveOf("puppet", countryTargetSchema, noParamsSchema),
  annex: primitiveOf("annex", countryTargetSchema, noParamsSchema),
  // Объединение: цель — ПОГЛОЩАЕМОЕ государство, источник — поглотитель.
  // Параметров нет по той же причине: страна либо вошла в состав другой, либо
  // нет, промежуточной величины у этого не бывает.
  merge_countries: primitiveOf("merge_countries", countryTargetSchema, noParamsSchema),
  // Рождение государства адресуется РЕГИОНУ, а не стране: он и есть то, что
  // отпускают. Какая именно территория уйдёт, решает демография (все регионы
  // источника с тем же большинством) — тот же принцип, что у раскола: модель
  // называет событие, карту рисует движок.
  create_country: primitiveOf("create_country", regionTargetSchema, noParamsSchema),
} as const satisfies Record<PrimitiveVerb, z.ZodTypeAny>;

export const primitiveSchema = z.discriminatedUnion("verb", [
  PRIMITIVE_SCHEMAS.incite_unrest,
  PRIMITIVE_SCHEMAS.repress,
  PRIMITIVE_SCHEMAS.grant_autonomy,
  PRIMITIVE_SCHEMAS.enact_reform,
  PRIMITIVE_SCHEMAS.spawn_incident,
  PRIMITIVE_SCHEMAS.split_country,
  PRIMITIVE_SCHEMAS.diplomacy,
  PRIMITIVE_SCHEMAS.sanction,
  PRIMITIVE_SCHEMAS.war,
  PRIMITIVE_SCHEMAS.peace,
  PRIMITIVE_SCHEMAS.send_aid,
  PRIMITIVE_SCHEMAS.capital_flight,
  PRIMITIVE_SCHEMAS.condemn,
  PRIMITIVE_SCHEMAS.support_proxy,
  PRIMITIVE_SCHEMAS.puppet,
  PRIMITIVE_SCHEMAS.annex,
  PRIMITIVE_SCHEMAS.merge_countries,
  PRIMITIVE_SCHEMAS.create_country,
]);

/**
 * Примитив воздействия — форма, которую выдаёт LLM и принимает движок.
 *
 * Выводится из схемы, а не объявляется рядом с ней: единственный способ
 * гарантировать, что тип и валидация не разъедутся, — не иметь двух объявлений.
 */
export type Primitive = z.infer<typeof primitiveSchema>;

/** Ветка union'а по глаголу — для обработчиков, которым нужна конкретная форма. */
export type PrimitiveOf<V extends PrimitiveVerb> = Extract<Primitive, { verb: V }>;

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

/** Элемент, не прошедший структурную схему. */
export interface InvalidPrimitive {
  /** Позиция в исходном массиве; −1 у отказа, относящегося к массиву целиком. */
  index: number;
  /**
   * Глагол, если он вообще читается из сырой записи и входит в алфавит.
   *
   * Нужен ради правила класса «отказ структурного отклоняет весь ответ»
   * (docs/PRIMITIVES.md §3): до per-verb union'а примитив, провалившийся на
   * схеме, глагола не нёс, и правило на этом слое было неприменимо не по
   * решению, а по отсутствию данных. Остаётся `undefined` там, где данных
   * действительно нет: `verb` отсутствует или не входит в алфавит.
   */
  verb?: PrimitiveVerb | undefined;
  reason: string;
}

/** Глагол сырой записи, если он читается и входит в алфавит. */
function rawVerbOf(entry: unknown): PrimitiveVerb | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const verb = (entry as { verb?: unknown }).verb;
  return PRIMITIVE_VERBS.find(v => v === verb);
}

/**
 * Разбирает сырой массив примитивов, разделяя структурно валидные и битые.
 * Возвращает причины по каждому отклонению — их вызывающий кладёт в
 * диагностику, а не глотает.
 */
export function parsePrimitives(raw: unknown): {
  primitives: Primitive[];
  invalid: InvalidPrimitive[];
} {
  const primitives: Primitive[] = [];
  const invalid: InvalidPrimitive[] = [];

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
    if (parsed.success) {
      primitives.push(parsed.data);
      return;
    }
    const verb = rawVerbOf(entry);
    invalid.push({
      index,
      ...(verb === undefined ? {} : { verb }),
      reason: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
  });

  return { primitives, invalid };
}
