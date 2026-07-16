import { type Country } from "../types/Country";
import { type Region } from "./map/Region";
import { type Event } from "../types/Event";
import { type EraDefinition } from "../types/research/EraDefinition";
import { type MapFeature } from "./map/MapFeature";
import { type Locale } from "./i18n/LocalizedText";
import { type War } from "./War";
import { type Modifier } from "./Modifier";
import { type SanctionType } from "./DiplomacyState";
import { type EquipmentType } from "./military/EquipmentType";
import { type ResourceType } from "./resources/ResourcesType";

export interface GameState {
  currentDate: string;

  playerCountryId: string;

  countries: Country[];

  era: EraDefinition;

  regions: Region[];

  // Seeded RNG (docs/plans/01_PERSISTENCE_STATE.md, shared/src/utils/rng.ts) —
  // сериализуемое состояние генератора. Один seed → бит-в-бит одинаковая
  // кампания. Правило на будущее: вся случайность симуляции — только через
  // это поле, не Math.random.
  rngState: number;

  // Счётчик для детерминированных id Map Features (docs/plans/01_PERSISTENCE_STATE.md,
  // MapFeatureService.generateId()) — заменяет Math.random/Date.now, которые
  // ломали детерминизм и JSON-round-trip не мог быть источником истины для id.
  nextFeatureId: number;

  // Язык генерируемого LLM текста (title/descriptions), зафиксирован при
  // создании игры (docs/DECISIONS.md, 2026-07-05) — не переключается на
  // лету. Не влияет на язык статичной UI-обвязки (остаётся русской) и не
  // влияет на имена стран/регионов в промте (те используют LLM_LOCALE).
  locale: Locale;

  // Намерение игрока на текущий ход свободным текстом (docs/DECISIONS.md,
  // 2026-07-04) — уходит в LLM-промт, LLM интерпретирует его в LLMAction[].
  // Одноразовое: очищается после успешного processResponse, не история.
  playerIntent: string;

  eventHistory: Event[];

  // Летопись кампании по годам (docs/plans/02_LLM_CONTRACT.md, Шаг 3) —
  // дешёвая детерминированная память поверх eventHistory: раз в год
  // (январский тик, ChronicleTick.ts) движок склеивает заголовки событий
  // завершившегося года в одну строку-summary. Не заменяет eventHistory
  // (история остаётся полной) и не окно "## Recent Events" (то — последние
  // 5 событий глобально, для операционного контекста) — Chronicle решает
  // другую проблему: "почему Франция ненавидит нас с 1953?" после ~24
  // ходов Spotlight-ротации. LLM-сжатие (вместо конкатенации заголовков) —
  // не реализовано, отложено до подтверждённой на практике недостаточности
  // дешёвого варианта (docs/DECISIONS.md, 2026-07-05).
  chronicle: { year: number; summary: string }[];

  mapFeatures: MapFeature[];

  // Активные и завершённые войны (docs/WAR.md, Phase 1) — состояние живёт
  // здесь, не в отдельной подсистеме (AI_RULES.md принцип: числа у движка).
  wars: War[];

  // Временные и постоянные эффекты (docs/plans/03_MODIFIERS_COMMANDS.md,
  // Шаг 2; MASTER_PROMPT.md правило 3) — тики читают не сырое поле, а
  // effectiveValue() (shared/src/utils/modifiers.ts). id — тот же счётчик,
  // что Map Features (nextFeatureId), другой префикс, без нового поля
  // счётчика. Очистка истёкших — server/src/commands/modifiers.ts,
  // вызывается из Cleanup-фазы SimulationEngine.ts.
  modifiers: Modifier[];

  // Детерминированные факты для следующего промта (независимый гейм-дизайн
  // разбор, 2026-07-06) — движок обнаруживает значимое событие (сейчас:
  // пересечение тира домена технологий, SimulationEngine.ts), LLM получает
  // его как гарантированный факт для нарратива вместо того, чтобы полагаться
  // на добрую волю LLM каждый цикл. Одноразовое: очищается сразу после
  // рендера в LLMService.generatePrompt(), не история (для истории — Event
  // в eventHistory, который сама LLM пишет по итогам хода).
  pendingWorldFacts: { countryId: string; text: string }[];

  // Сколько раз каждая историческая развилка (docs/tasks/HISTORICAL_HINGE_POINTS_1946.md,
  // реализовано 2026-07-06) уже попадала в промт как подсказка — ключ id
  // развилки. Не мягкий гейт/рельсы: только счётчик показов, чтобы подсказка
  // не повторялась вечно (см. shared/src/utils/hingePoints.ts,
  // MAX_HINGE_POINT_SHOWS). Инкрементируется в LLMService.generatePrompt().
  hingePointShowCount: Record<string, number>;

  // LLM Simulation fields
  llmContext?: string; // контекст для LLM (промт)
  llmResponse?: string; // последний ответ LLM
  llmTurn?: number; // номер хода для LLM симуляции
  pendingLlmActions?: LLMAction[]; // действия от LLM ожидающие применения
  // Индекс ротации "Spotlight Countries" (детерминированный round-robin по
  // не-major странам, id-sort) — расширение круга стран, реально ощущающих
  // LLM (docs/DECISIONS.md, 2026-07-04, вопрос 11). Двигается только при
  // успешном processResponse, не при простом generatePrompt.
  llmSpotlightCursor?: number;

  // Гейт хода (docs/DECISIONS.md, 2026-07-06): true после успешного
  // processResponse текущего цикла, сбрасывается в false при каждом
  // успешном advanceMonth. GameService.advanceMonth() отказывает, если
  // false — ход не продвигается без ответа LLM ("LLM — главный двигатель",
  // docs/LLM_RULES.md).
  llmRespondedThisTurn: boolean;

  // Позиция игрока в мире (docs/OBJECTIVES.md, план 11 категория B) —
  // пересчитывается каждый ход движком (SimulationEngine после агрегации) по
  // индексу национальной силы (shared/src/utils/nationalPower.ts). Обратная
  // связь «насколько я силён / расту ли»: сила, ранг (1 — сильнейший), всего
  // стран. Производное состояние, но хранится ради дешёвого доступа UI/промта
  // без пересчёта рейтинга 128 стран на каждый рендер.
  playerStanding: PlayerStanding;

  // Компактный детерминированный итог последнего успешно завершённого хода.
  // Поле опционально для совместимости со старыми save-файлами; это не
  // event log и не накапливаемая история (docs/OBJECTIVES.md).
  lastTurnReport?: LastTurnReport;
}

/** Позиция страны игрока в мировом рейтинге силы (docs/OBJECTIVES.md). */
export interface PlayerStanding {
  power: number;
  rank: number;
  total: number;
}

export type TurnReportMetric =
  | "power"
  | "rank"
  | "gdp"
  | "treasury"
  | "population"
  | "stability"
  | "legitimacy"
  | "regions";

export interface TurnMetricChange {
  metric: TurnReportMetric;
  before: number;
  after: number;
}

export interface LastTurnReport {
  fromDate: string;
  toDate: string;
  months: number;
  changes: TurnMetricChange[];
  completedGoalIds: string[];
}

/**
 * Действие, применяемое LLM к игровому состоянию (docs/plans/02_LLM_CONTRACT.md).
 * Дискриминированный union по `type` — `data: any` не существует, каждый
 * вариант несёт ровно те поля, которые реально читает соответствующий
 * applyXAction в server/src/services/LLMService.ts. Структурная и
 * магнитудная валидация ответа LLM — server/src/llm/actionSchemas.ts (Zod,
 * должен структурно совпадать с этим типом — компайл-тайм проверка там же);
 * семантическая применимость (страна существует, война идёт и т.п.) —
 * server/src/llm/LLMResponseValidator.ts.
 */
// Опциональные поля пишутся как `?: X | undefined`, не просто `?: X` — под
// exactOptionalPropertyTypes (server/tsconfig.json) это разные типы, а
// z.infer<...> (actionSchemas.ts) для .optional() всегда выводит `X | undefined`
// явно. Без этого компайл-тайм проверка эквивалентности в actionSchemas.ts
// не проходит на пустом месте — не убирать `| undefined` при правке.
export type LLMAction =
  | { type: "diplomacy"; sourceCountryId: string; targetCountryId: string; data: { relationChange: number } }
  | { type: "war"; sourceCountryId: string; targetCountryId: string; data?: { warGoal?: string | undefined } | undefined }
  | { type: "peace"; sourceCountryId: string; targetCountryId: string }
  | { type: "annex"; sourceCountryId: string; targetCountryId: string }
  | { type: "puppet"; sourceCountryId: string; targetCountryId: string }
  | { type: "sanction"; sourceCountryId: string; targetCountryId: string; data?: { sanctionType?: SanctionType | undefined } | undefined }
  | { type: "guarantee"; sourceCountryId: string; targetCountryId: string }
  | { type: "influence"; sourceCountryId: string; targetCountryId: string; data?: { influenceChange?: number | undefined } | undefined }
  | { type: "research_shift"; sourceCountryId: string; data: { domain: string; share: number } }
  | { type: "production_shift"; sourceCountryId: string; data: { equipmentType: EquipmentType; share: number } }
  | { type: "build_extraction"; sourceCountryId: string; data: { regionId: number; resource: ResourceType; delta: 1 | -1 } };
