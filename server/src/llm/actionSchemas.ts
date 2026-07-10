import { z } from "zod";
import { EquipmentType } from "@shared/types/military/EquipmentType";
import { type LLMAction as SharedLLMAction } from "@shared/types/GameState";
import {
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RELATION_CHANGE,
  MAX_INFLUENCE_CHANGE,
  MAX_RESEARCH_SHARE,
  MAX_PRODUCTION_SHARE,
} from "@shared/defines/llmActionCaps";

/**
 * Zod-контракт LLM-действий (docs/plans/02_LLM_CONTRACT.md, MASTER_PROMPT.md
 * правило 6). Структурная и магнитудная валидация живёт здесь — семантическая
 * применимость к текущему состоянию игры (страна существует, война идёт и
 * т.п.) остаётся в server/src/llm/LLMResponseValidator.ts::validateActionApplicability,
 * которая знает о конкретной партии, а не только о форме данных.
 */

/** Дублирует shared/src/types/DiplomacyState.ts::SanctionType — тот голый TS
 * union, не as-const объект (как EquipmentType), z.enum() не может вывести
 * литералы из него рантаймово. Синхронизация — компайл-тайм проверка внизу
 * файла, не ручная сверка. */
const SANCTION_TYPES = [
  "trade_embargo",
  "economic_sanctions",
  "military_sanctions",
  "diplomatic_sanctions",
] as const;

const EQUIPMENT_TYPES = Object.values(EquipmentType) as [EquipmentType, ...EquipmentType[]];

/**
 * source===target — это форма запроса, не игровое состояние: не требует
 * game.countries, поэтому проверяется здесь (схема), не в applicability.
 */
function noSelfTarget<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).refine((a: any) => a.sourceCountryId !== a.targetCountryId, {
    message: "Source and target country are the same",
    path: ["targetCountryId"],
  });
}

const DiplomacyAction = noSelfTarget({
  type: z.literal("diplomacy"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
  data: z.object({
    relationChange: z.number().min(-MAX_RELATION_CHANGE).max(MAX_RELATION_CHANGE),
  }),
});

const WarAction = noSelfTarget({
  type: z.literal("war"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
  data: z.object({ warGoal: z.string().optional() }).optional(),
});

const PeaceAction = noSelfTarget({
  type: z.literal("peace"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
});

// Контракт типизирует annex/puppet (реальная присоединяющая механика — не
// в этом плане, apply остаётся no-op, см. docs/plans/02_LLM_CONTRACT.md
// "Явно не в этом заходе").
const AnnexAction = noSelfTarget({
  type: z.literal("annex"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
});

const PuppetAction = noSelfTarget({
  type: z.literal("puppet"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
});

const SanctionAction = noSelfTarget({
  type: z.literal("sanction"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
  data: z
    .object({
      sanctionType: z.enum(SANCTION_TYPES).optional(),
    })
    .optional(),
});

const GuaranteeAction = noSelfTarget({
  type: z.literal("guarantee"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
});

const InfluenceAction = noSelfTarget({
  type: z.literal("influence"),
  sourceCountryId: z.string().min(1),
  targetCountryId: z.string().min(1),
  data: z
    .object({
      influenceChange: z.number().min(-MAX_INFLUENCE_CHANGE).max(MAX_INFLUENCE_CHANGE).optional(),
    })
    .optional(),
});

// research_shift/production_shift — самодействие (self-action), нет
// targetCountryId вообще (LLMResponseValidator.ts, текущий validateAction,
// список типов, требующих target, их не включает).

const ResearchShiftAction = z.object({
  type: z.literal("research_shift"),
  sourceCountryId: z.string().min(1),
  // domain — НЕ enum: домены не фиксированный код-каталог, а данные по
  // era/стране (country.technology.domains) — принадлежность конкретной
  // стране остаётся в validateActionApplicability. share здесь — только
  // статический потолок; военно-скорректированный (getResearchShareCap)
  // не выражается в схеме, вне контекста конкретной партии.
  data: z.object({
    domain: z.string().min(1),
    share: z.number().min(0).max(MAX_RESEARCH_SHARE),
  }),
});

const ProductionShiftAction = z.object({
  type: z.literal("production_shift"),
  sourceCountryId: z.string().min(1),
  data: z.object({
    equipmentType: z.enum(EQUIPMENT_TYPES),
    share: z.number().min(0).max(MAX_PRODUCTION_SHARE),
  }),
});

export const LLMActionSchema = z.discriminatedUnion("type", [
  DiplomacyAction,
  WarAction,
  PeaceAction,
  AnnexAction,
  PuppetAction,
  SanctionAction,
  GuaranteeAction,
  InfluenceAction,
  ResearchShiftAction,
  ProductionShiftAction,
]);

/**
 * Транспортный конверт ответа LLM — только форма верхнего уровня
 * (title/descriptions/actions[]). Провал здесь бракует ответ целиком
 * (JSON битый/нет descriptions/actions не массив/слишком много действий).
 * Каждый элемент actions парсится LLMActionSchema ПО ОТДЕЛЬНОСТИ в
 * LLMService.processResponse — один невалидный элемент не должен ронять
 * остальные валидные (правило 6 fitness-функции: "за-каповое — с причиной",
 * не обвал всего ответа).
 */
export const LLMResponseEnvelopeSchema = z.object({
  title: z.string().optional(),
  descriptions: z.string().min(1, "Missing descriptions field"),
  actions: z
    .array(z.unknown(), "Missing or invalid actions field")
    .max(MAX_ACTIONS_PER_RESPONSE, `Too many actions (max ${MAX_ACTIONS_PER_RESPONSE})`),
});

/**
 * Схема ТОЛЬКО для генерации Gemini responseSchema (GeminiProvider.ts) —
 * строгая (title required, actions — полный LLMActionSchema, не
 * z.unknown()[]), т.к. её роль — направлять генерацию модели заранее, не
 * разбирать чужой произвольный ответ. Поля объявлены в порядке
 * title→descriptions→actions — z.toJSONSchema() эмитит required в порядке
 * объявления, порядок важен для совпадения с ожиданиями Gemini structured
 * output (GeminiProvider.test.ts).
 */
export const GeminiResponseSchema = z.object({
  title: z.string(),
  descriptions: z.string(),
  actions: z.array(LLMActionSchema).max(MAX_ACTIONS_PER_RESPONSE),
});

// Компайл-тайм проверка: z.infer<LLMActionSchema> обязан структурно
// совпадать с shared LLMAction (GameState.ts). Расхождение ловит
// `tsc --noEmit`, а не рантайм-тест — правка одного файла без другого не
// проходит компиляцию.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type InferredLLMAction = z.infer<typeof LLMActionSchema>;
type _AssertSchemaMatchesSharedType = Equals<InferredLLMAction, SharedLLMAction> extends true
  ? true
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typecheck: _AssertSchemaMatchesSharedType = true;
