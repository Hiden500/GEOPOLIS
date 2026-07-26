import { createHash } from "node:crypto";
import { type z } from "zod";
import { type GameState } from "@shared/types/GameState";
import { type LLMAction } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type PrimitiveOutcomeRecord } from "@shared/types/politics/PrimitiveOutcome";
import { type Locale, getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { activeCrises, renderCrisis, renderHiddenCrises } from "../llm/crisisDigest";
import { MAX_PROMPT_CRISES, REGION_CRISIS_DISCONTENT_THRESHOLD } from "@shared/defines/discontent";
import { PRIMITIVE_CONTRACT, PRIMITIVE_PLAYER_AGENCY_NOTE } from "../llm/primitiveContract";
import { parsePrimitives } from "../primitives/primitiveSchemas";
import { applyPrimitiveTurn, isDuplicatePrimitiveBatch } from "../primitives/turnBatch";
import { splitByAgency } from "../llm/primitiveAgency";
import * as diplomacyCommands from "../commands/diplomacy";
import * as warCommands from "../commands/war";
import * as economyCommands from "../commands/economy";
import * as resourceCommands from "../commands/resources";
import { getDomainTier } from "@shared/utils/technology";
import { getGdpPerCapita, getLivingStandardIndex } from "@shared/utils/countryMetrics";
import { getEligibleHingePoints } from "@shared/utils/hingePoints";
import { HISTORICAL_HINGE_POINTS_1946 } from "@shared/data/historicalHingePoints1946";
import { computeWarScore, warScoreLabel, sumSideCasualties } from "../simulation/war/warScore";
import { LLMResponseValidator } from "../llm/LLMResponseValidator";
import { LLMActionSchema, LLMResponseEnvelopeSchema } from "../llm/actionSchemas";
import {
  MAX_ACTIONS_PER_RESPONSE,
  MAX_RELATION_CHANGE,
  MAX_INFLUENCE_CHANGE,
  MAX_RESEARCH_SHARE,
  MAX_PRODUCTION_SHARE,
} from "@shared/defines/llmActionCaps";

/**
 * Форматирует ZodError в человекочитаемую строку одной причины — путь поля
 * (если есть) + сообщение. Несколько issues склеиваются через "; " (обычно
 * их одна на действие, но не гарантировано).
 */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * Сколько не-major стран попадают в "## Spotlight Countries" за один цикл.
 * Тюнингуемая константа (как THREAT-пороги в AiBehaviorTick) — балансировать
 * на симуляции. При ~117 не-major странах (10 major/25 regional из
 * TierTick.ts, остальное minor) и этом значении полный оборот ротации —
 * ~24 месяца (см. docs/DECISIONS.md, 2026-07-04, вопрос 11).
 */
const LLM_SPOTLIGHT_COUNT = 5;

/**
 * Полные имена языков для секции "## Language" промта — сама инструкция
 * промта всегда на английском, меняется только язык генерируемого текста
 * LLM (docs/DECISIONS.md, 2026-07-05: язык фиксируется на старте игры).
 */
const LANGUAGE_NAMES: Record<Locale, string> = {
  ru: "Russian",
  en: "English",
};

/**
 * Окно "памяти страны" между вызовами LLM (docs/DECISIONS.md, 2026-07-05,
 * вопрос 7): движок берёт последние N заголовков (Event.title) из уже
 * существующего eventHistory по стране — LLM ничего дополнительно не пишет
 * (title она и так производит каждый цикл), только форматирование. Решает
 * проблему Spotlight-ротации (страна выпадает из промта на ~24 хода и теряет
 * контекст) без лишних выходных токенов. Размер окна по тиру — тот же
 * принцип тюнинга, что LLM_SPOTLIGHT_COUNT.
 */
const PLAYER_RECENT_TITLES_COUNT = 5;
const MAJOR_RECENT_TITLES_COUNT = 3;
const SPOTLIGHT_RECENT_TITLES_COUNT = 2;

/**
 * Итог одного прохода LLM-цикла: что применено, что отклонено и почему.
 */
export interface LlmCycleResult {
  success: boolean;
  error?: string;
  title?: string;
  descriptions?: string;
  appliedActions: LLMAction[];
  // action: unknown, не LLMAction — точечно отклонённый элемент не
  // гарантированно валиден (мог провалиться ровно на структурной проверке).
  rejectedActions: { action: unknown; reason: string }[];
  /**
   * Локализуемый отклик по каждому применённому примитиву (docs/PRIMITIVES.md
   * §4) — материал для интерфейса, построенный из ФАКТИЧЕСКИХ дельт движка.
   */
  primitiveOutcomes: PrimitiveOutcomeRecord[];
  /**
   * Отклонённые примитивы одним списком, независимо от того, где отказали:
   * структурная схема (`verb` неизвестен — поля нет), граница агентности или
   * предпосылки движка. Потребителю слой отказа не важен, важна причина.
   */
  rejectedPrimitives: { verb?: string; reason: string }[];
}

/**
 * Одноразовые данные, которые потребляет рендер промта: их нужно уметь вернуть
 * в состояние, если промт так никому и не достался (см. `runAutoCycle`).
 */
interface PromptConsumables {
  pendingWorldFacts: GameState["pendingWorldFacts"];
  hingePointShowCount: GameState["hingePointShowCount"];
  llmContext: string | undefined;
}

/**
 * Сервис для работы с LLM симуляцией.
 * Управляет генерацией промтов, применением ответов LLM и валидацией действий.
 */
export class LLMService {
  private game: GameState;

  constructor(game: GameState) {
    this.game = game;
  }

  /**
   * Полный автоматизированный проход: промт → провайдер → применение.
   *
   * Здесь, а не в роуте, ровно из-за отката. `generatePrompt()` ПОТРЕБЛЯЕТ
   * одноразовые данные: диагностику отклонённых примитивов (docs/PRIMITIVES.md
   * §3 — «в следующий промт, чтобы не долбилась в невозможное»), пометку
   * «кризис новый в этом месяце» и счётчик показов исторических развилок. Если
   * провайдер упал ПОСЛЕ генерации, эти данные исчезали навсегда: до модели они
   * не доехали, а в состоянии их уже нет. Проверено исполнением — повторный
   * `generatePrompt` в том же месяце шёл уже без отказов.
   *
   * Откат сделан ровно на сбой ПРОВАЙДЕРА, а не на любую неудачу. Битый или
   * невалидный ответ модели — это ответ: промт до неё доехал, диагностику она
   * видела, и возвращать её обратно значило бы показать те же отказы дважды.
   */
  async runAutoCycle(askProvider: (prompt: string) => Promise<string>): Promise<LlmCycleResult> {
    const consumed = this.snapshotPromptConsumables();
    const prompt = this.generatePrompt();
    this.savePrompt(prompt);

    let rawResponse: string;
    try {
      rawResponse = await askProvider(prompt);
    } catch (error) {
      this.restorePromptConsumables(consumed);
      throw error;
    }

    return this.processResponse(rawResponse);
  }

  /**
   * Снимок всего, что `generatePrompt()` потребляет или инкрементирует.
   *
   * Клонируется, а не копируется ссылкой: секции подменяют `pendingWorldFacts`
   * целым новым массивом, но полагаться на это как на гарантию нельзя — стоит
   * одной секции начать править факт на месте, и «снимок» стал бы тем же
   * объектом. `llmContext` тоже здесь: промт, который никто не увидел, не
   * должен остаться в состоянии и показать те же одноразовые данные второй раз
   * уже из сохранённого текста.
   */
  private snapshotPromptConsumables(): PromptConsumables {
    return {
      pendingWorldFacts: structuredClone(this.game.pendingWorldFacts),
      hingePointShowCount: { ...this.game.hingePointShowCount },
      llmContext: this.game.llmContext,
    };
  }

  private restorePromptConsumables(snapshot: PromptConsumables): void {
    this.game.pendingWorldFacts = snapshot.pendingWorldFacts;
    this.game.hingePointShowCount = snapshot.hingePointShowCount;
    // Промта до сбоя могло не быть вовсе — тогда поле УДАЛЯЕТСЯ, а не
    // выставляется в `undefined`: сейв обязан вернуться к прежней форме.
    if (snapshot.llmContext === undefined) delete this.game.llmContext;
    else this.game.llmContext = snapshot.llmContext;
  }

  /**
   * Полный проход цикла по сырому ответу LLM: envelope-схема (форма верхнего
   * уровня) → per-action Zod-схема (структура/магнитуда) → семантическая
   * применимость → применение → журнал в eventHistory. Невалидный JSON или
   * envelope отклоняет ответ целиком (ничего не применяется); невалидное или
   * неприменимое отдельное действие отклоняется точечно с причиной — не
   * ронять весь батч из-за одного действия (docs/plans/02_LLM_CONTRACT.md,
   * правило 6 конституции).
   */
  processResponse(rawResponse: string): LlmCycleResult {
    let raw: unknown;
    try {
      raw = JSON.parse(rawResponse);
    } catch {
      return {
        success: false,
        error: "Invalid JSON format",
        appliedActions: [],
        rejectedActions: [],
        primitiveOutcomes: [],
        rejectedPrimitives: [],
      };
    }

    const envelope = LLMResponseEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      // Envelope-схема несёт самоописательные сообщения ("Missing descriptions
      // field" и т.п.) — без префикса пути поля, в отличие от per-action ошибок
      // ниже (formatZodError), где путь действительно нужен для навигации.
      return {
        success: false,
        error: envelope.error.issues[0]?.message ?? "Invalid response format",
        appliedActions: [],
        rejectedActions: [],
        primitiveOutcomes: [],
        rejectedPrimitives: [],
      };
    }

    const { title, descriptions, actions, primitives } = envelope.data;
    const validator = new LLMResponseValidator(this.game);
    const appliedActions: LLMAction[] = [];
    const rejectedActions: { action: unknown; reason: string }[] = [];

    for (const rawAction of actions) {
      const parsedAction = LLMActionSchema.safeParse(rawAction);
      if (!parsedAction.success) {
        rejectedActions.push({ action: rawAction, reason: formatZodError(parsedAction.error) });
        continue;
      }

      const applicability = validator.validateActionApplicability(parsedAction.data);
      if (!applicability.valid) {
        rejectedActions.push({ action: parsedAction.data, reason: applicability.error ?? "Not applicable" });
        continue;
      }

      appliedActions.push(parsedAction.data);
    }

    this.applyLlmActions(appliedActions);

    // Примитивы применяются ПОСЛЕ старых действий и отдельным контрактом:
    // движок примитивов возвращает фактические величины и сам откатывает
    // неудавшееся, тогда как `applyLlmActions` игнорирует `CommandResult`
    // (предсуществующий дефект, docs/TODO.md). Смешивать их нельзя — новый
    // канал не должен унаследовать этот разрыв.
    const primitiveResult = this.applyResponsePrimitives(rawResponse, primitives);

    this.saveResponse(rawResponse);
    this.incrementLlmTurn();
    this.advanceSpotlightCursor();
    this.game.playerIntent = "";
    this.game.llmRespondedThisTurn = true;

    const eventTitle = title?.trim() || `Мировые события (LLM, ход ${this.game.llmTurn})`;

    this.game.eventHistory.push({
      id: `llm-turn-${this.game.llmTurn}`,
      date: this.game.currentDate,
      title: eventTitle,
      description: descriptions,
      countries: [
        ...new Set(
          appliedActions.flatMap(a =>
            'targetCountryId' in a ? [a.sourceCountryId, a.targetCountryId] : [a.sourceCountryId]
          )
        ),
      ],
    });

    return {
      success: true,
      title: eventTitle,
      descriptions,
      appliedActions,
      rejectedActions,
      primitiveOutcomes: primitiveResult.outcomes,
      rejectedPrimitives: primitiveResult.rejected,
    };
  }

  /**
   * Применяет примитивы из ответа модели через границу хода.
   *
   * Три слоя отказа, в порядке применения:
   *   1. структурная схема (`parsePrimitives`) — форма, закрытые enum'ы,
   *      отсутствие числовых полей в `params`;
   *   2. граница агентности (`splitByAgency`) — режиссёр не принимает решений
   *      государственной политики за игрока (docs/CONCEPT.md §7.2);
   *   3. предпосылки движка (`applyPrimitiveTurn` → `applyPrimitiveBatch`).
   *
   * Отказы первых двух слоёв движок не увидит, поэтому диагностические факты по
   * ним пишутся здесь — в том же виде (`kind: "primitive_rejected"`), в каком их
   * пишет движок: следующий промт рендерит их одной секцией и не должен знать,
   * на каком слое отказали (docs/PRIMITIVES.md §3 — «чтобы не долбилась в
   * невозможное»).
   *
   * Idempotency-ключ выводится из СОДЕРЖАНИЯ ответа и текущей игровой даты
   * (docs/CONCEPT.md §7.2). Дата в ключе, а не номер хода: `processResponse` сам
   * инкрементирует `llmTurn`, поэтому повторный POST того же ответа получил бы
   * другой номер и защита не сработала бы. Дата же между двумя ответами одного
   * месяца не меняется — повтор ловится, — а тот же текст в другом месяце
   * законен и проходит.
   */
  private applyResponsePrimitives(
    rawResponse: string,
    raw: unknown
  ): { outcomes: PrimitiveOutcomeRecord[]; rejected: { verb?: string; reason: string }[] } {
    if (raw === undefined) return { outcomes: [], rejected: [] };

    const digest = createHash("sha256").update(rawResponse).digest("hex").slice(0, 16);
    const idempotencyKey = `llm:${this.game.currentDate}:${digest}`;

    // Проверка дубля стоит ДО записи диагностики: иначе повторный POST того же
    // ответа не применил бы примитивы (это ловит ключ), но второй раз наплодил
    // бы факты об одних и тех же отказах — и следующий промт получил бы их
    // дважды.
    if (isDuplicatePrimitiveBatch(this.game, idempotencyKey)) {
      return {
        outcomes: [],
        rejected: [
          {
            // Формулировка названа точно, а не обнадёживающе: ключ прикрывает
            // ТОЛЬКО массив `primitives`. Старый канал `actions` при повторной
            // подаче того же ответа отработает второй раз, как и раньше
            // (осознанный хвост, docs/TODO.md). «This response was already
            // applied» создавало впечатление полной защиты ответа.
            reason:
              "The primitives of this response were already applied this month and were not " +
              "re-applied (the legacy actions channel is not covered by this key)",
          },
        ],
      };
    }

    const { primitives, invalid } = parsePrimitives(raw);
    const { allowed, refused } = splitByAgency(primitives, this.game.playerCountryId);

    const rejected: { verb?: string; reason: string }[] = [
      ...invalid.map(i => ({
        reason: i.index >= 0 ? `primitive #${i.index + 1}: ${i.reason}` : i.reason,
      })),
      ...refused.map(r => ({ verb: r.verb, reason: r.reason })),
    ];

    for (const entry of rejected) {
      this.game.pendingWorldFacts.push({
        countryId: this.game.playerCountryId,
        kind: "primitive_rejected",
        text: `Attempt rejected (${entry.verb ?? "malformed primitive"}): ${entry.reason}`,
      });
    }

    const outcome = applyPrimitiveTurn(this.game, allowed, idempotencyKey);

    return {
      outcomes: outcome.outcomes,
      rejected: [...rejected, ...outcome.rejected.map(r => ({ verb: r.verb, reason: r.reason }))],
    };
  }

  /**
   * Генерирует промт для LLM на основе текущего состояния игры.
   */
  generatePrompt(): string {
    // Три секции ниже МУТИРУЮТ состояние: потребляют одноразовые факты
    // (кризисы, отказы) или считают показы подсказок. Порядок вычисления
    // шаблонного литерала — порядок текста, поэтому секция, которой нужны
    // факты, обязана считаться раньше той, что их вычищает
    // (`getNotableDevelopmentsInfo` очищает `pendingWorldFacts` целиком).
    // Вынесены в константы, чтобы этот порядок был виден и не зависел от того,
    // куда в тексте промта попадёт новая секция.
    const crises = this.getRegionalCrisesInfo();
    const rejectedAttempts = this.getRejectedAttemptsInfo();
    const notableDevelopments = this.getNotableDevelopmentsInfo();
    const hingePoints = this.getHingePointHintsInfo();

    const prompt = `
# Geopolis - World Simulation

## Current Date
${this.game.currentDate}

## Language
Write "title", "descriptions", and any other free-text narrative you generate
in ${LANGUAGE_NAMES[this.game.locale]}. This applies only to the prose you write —
country ids, region ids, and other identifiers elsewhere in this prompt are
never translated, copy them verbatim.

## Player Country
${this.getPlayerCountryInfo()}

## Major Powers
${this.getMajorPowersInfo()}

## Spotlight Countries
Not major powers, but on stage this cycle. You MUST give at least 2 of them a
concrete narrative beat in "descriptions" this cycle (a development, decision,
or event specific to that country) — not just a passing mention.
${this.getSpotlightInfo()}

## Active Wars
${this.getActiveWarsInfo()}

## Notable Developments This Month
${notableDevelopments}

## Regional Crises
Regions whose discontent the engine has measured above the crisis threshold of
${REGION_CRISIS_DISCONTENT_THRESHOLD.toFixed(2)}. At most ${MAX_PROMPT_CRISES} are shown in full, most acute first; the rest
smoulder in the background and surface here later if they become more acute.
The discontent index is a population-share-weighted 0..1 index over the
region's groups (ideological distance from the authorities, economic lag,
memory of past repression and concessions) — it is NOT a headcount of
protesters, do not narrate it as a percentage of people.
${crises}

## Rejected Attempts Last Cycle
Primitives you proposed that the engine refused, with the reason. Do not
propose them again unchanged — the precondition has to change first.
${rejectedAttempts}

## Historical Context
Background continuity for this period, not mandatory scripted events —
reflect a hint in the narrative only if the world hasn't already diverged
from what would make it implausible. You may narrate the hinted development,
a plausible variation, or ignore it if the story has moved elsewhere.
${hingePoints}

## Chronicle
Year-by-year memory of this campaign so far, oldest first — use it to keep
causality consistent across a long game (e.g. why a rivalry that started
years ago still matters), not as a script to follow.
${this.getChronicleInfo()}

## Recent Events
${this.getRecentEventsInfo()}

## Diplomatic Situation
${this.getDiplomaticSituation()}

## Player Intent
${this.getPlayerIntentInfo()}

## Country IDs
Every country mentioned above by name, mapped to its real id. Country names
are for readability only — actions are matched by id, not by name or guess.
${this.getCountryIdsSection()}

## Instructions
Simulate the world for the next month. Consider:
- All countries continue their development
- Diplomatic relationships evolve naturally
- Economic changes affect international relations
- Military movements and tensions
- Historical context of the current year

Narrative requirements (strict):
- "descriptions" MUST be at least 3 distinct paragraphs: (1) what happened
  this month among the Major Powers, (2) what happened in at least 2 of the
  Spotlight Countries specifically (name them, give each a concrete beat —
  not a vague aggregate sentence), (3) a forward-looking read of where
  tensions/opportunities are heading next month.
- You MUST NOT mention, narrate about, or take action for any country that
  is not listed in the "## Country IDs" section above. If a country is not
  in that list, it does not exist in this simulation right now — do not
  invent events for it.
- Where applicable, ground the narrative in concrete real historical events
  of this specific month/year rather than generic statements (e.g. prefer a
  real, dated development over a vague "tensions continue to rise").
  Deviations from real history caused by earlier player/LLM actions take
  priority over this — follow the world's own logic, don't force events back
  to the historical outcome.
- If the player's stated intent is fundamentally incompatible with
  real-world history (a deliberately speculative/fantastical claim), you
  MUST accept it as canon and build the world consistently around it from
  this point forward — do not silently ignore, downplay, or normalize it
  back to plausible history. Historical grounding remains the default; an
  explicit player intent overrides it for everything that follows.
- Avoid a direct "war" action between two nuclear-armed Major Powers unless
  strongly, explicitly grounded in real historical events — prefer narrating
  proxy support (a patron backing a client state's own conflict) over direct
  war between such powers.
- You may direct a Major Power's research focus via a "research_shift" action
  (data.domain, data.share) — there is no fixed catalog of named technologies;
  a domain's "tier" is just accumulated investment. When a country's domain
  tier crosses a meaningful new threshold, narrate what this represents in
  concrete terms (what got invented/achieved) — you invent the specific
  breakthrough, the engine only tracks the number.
- You may direct a Major Power's military production focus via a
  "production_shift" action (data.equipmentType, data.share) — fixed
  categories (rifles/trucks/tanks/artillery/fighters/bombers/destroyers/
  submarines), no named unit models; quality is decorative, invent it the
  same way you invent research breakthroughs.
- You may direct a country to build up or scale down resource extraction
  capacity in a region it controls via a "build_extraction" action
  (data.regionId, data.resource, data.delta: 1 or -1) — one level per turn,
  the engine computes actual output from richness × capacity, you never
  set a production number directly.

${PRIMITIVE_CONTRACT}
${PRIMITIVE_PLAYER_AGENCY_NOTE}

Return your response in JSON format with the following structure:
{
  "title": "Short one-line headline for this cycle's single most important development",
  "descriptions": "Narrative description of world events",
  "actions": [
    {
      "type": "diplomacy|war|peace|annex|puppet|sanction|guarantee|influence|research_shift|production_shift|build_extraction",
      "sourceCountryId": "country_id",
      "targetCountryId": "country_id",
      "data": {}
    }
  ],
  "primitives": [
    {
      "verb": "incite_unrest|repress|grant_autonomy|enact_reform|spawn_incident",
      "sourceCountryId": "country_id",
      "target": { "countryId": "...", "regionId": 0, "groupId": "..." },
      "params": { "intensity": "mild|moderate|severe" }
    }
  ]
}

Hard limits (actions violating them are rejected):
- Max ${MAX_ACTIONS_PER_RESPONSE} actions per response.
- data.relationChange: number within ±${MAX_RELATION_CHANGE}.
- data.influenceChange: number within ±${MAX_INFLUENCE_CHANGE}.
- research_shift: data.domain must be a real domain of the source country
  (see its Technology line); data.share within 0-${MAX_RESEARCH_SHARE}.
- production_shift: data.equipmentType must be one of rifles/trucks/tanks/
  artillery/fighters/bombers/destroyers/submarines; data.share within
  0-${MAX_PRODUCTION_SHARE}.
- build_extraction: data.delta must be exactly 1 or -1; the source country
  must control data.regionId and (for delta=1) the region must have a
  deposit of data.resource.
- sourceCountryId and targetCountryId MUST be ids copied verbatim from the
  ## Country IDs section. Never invent, abbreviate, or guess an id from a
  country's name (e.g. do not turn "Soviet Union" into "SOV" or "USSR",
  or "Romania" into "ROM" — look up the real id in ## Country IDs).
- sourceCountryId and targetCountryId must differ.
`;
    return prompt;
  }

  /**
   * Применяет действия от LLM к игровому состоянию.
   */
  applyLlmActions(actions: LLMAction[]): void {
    for (const action of actions) {
      switch (action.type) {
        case 'diplomacy':
          this.applyDiplomacyAction(action);
          break;
        case 'war':
          this.applyWarAction(action);
          break;
        case 'peace':
          this.applyPeaceAction(action);
          break;
        case 'sanction':
          this.applySanctionAction(action);
          break;
        case 'guarantee':
          this.applyGuaranteeAction(action);
          break;
        case 'influence':
          this.applyInfluenceAction(action);
          break;
        case 'research_shift':
          this.applyResearchShiftAction(action);
          break;
        case 'production_shift':
          this.applyProductionShiftAction(action);
          break;
        case 'build_extraction':
          this.applyBuildExtractionAction(action);
          break;
        case 'annex':
        case 'puppet':
          // Эти действия требуют дополнительной логики
          console.log(`Action ${action.type} not yet implemented`);
          break;
      }
    }
  }

  /**
   * Применяет дипломатическое действие.
   */
  private applyDiplomacyAction(action: Extract<LLMAction, { type: "diplomacy" }>): void {
    diplomacyCommands.setRelation(
      this.game,
      action.sourceCountryId,
      action.targetCountryId,
      action.data.relationChange
    );
  }

  /**
   * Применяет действие войны.
   */
  private applyWarAction(action: Extract<LLMAction, { type: "war" }>): void {
    warCommands.declareWar(this.game, action.sourceCountryId, action.targetCountryId, action.data?.warGoal);

    // Ухудшаем отношения
    diplomacyCommands.setRelation(this.game, action.sourceCountryId, action.targetCountryId, -100);
  }

  /**
   * Применяет действие мира.
   */
  private applyPeaceAction(action: Extract<LLMAction, { type: "peace" }>): void {
    warCommands.makePeaceBetween(this.game, action.sourceCountryId, action.targetCountryId);

    // Улучшаем отношения
    diplomacyCommands.setRelation(this.game, action.sourceCountryId, action.targetCountryId, 50);
  }

  /**
   * Применяет действие санкций.
   */
  private applySanctionAction(action: Extract<LLMAction, { type: "sanction" }>): void {
    const sanctionType = action.data?.sanctionType || 'economic_sanctions';
    diplomacyCommands.applySanction(this.game, action.sourceCountryId, action.targetCountryId, sanctionType);
  }

  /**
   * Применяет действие гарантии.
   */
  private applyGuaranteeAction(action: Extract<LLMAction, { type: "guarantee" }>): void {
    diplomacyCommands.setGuarantee(this.game, action.sourceCountryId, action.targetCountryId);
  }

  /**
   * Применяет действие влияния.
   */
  private applyInfluenceAction(action: Extract<LLMAction, { type: "influence" }>): void {
    const influenceChange = action.data?.influenceChange || 10;
    diplomacyCommands.setInfluence(this.game, action.sourceCountryId, action.targetCountryId, influenceChange);
  }

  /**
   * Применяет сдвиг фокуса исследований (docs/DECISIONS.md, 2026-07-06) —
   * без каталога именных технологий, только доля researchSpending на домен.
   * Доступно и игроку, и топ-державам через LLM (sourceCountryId — любая
   * страна ростера, тот же паттерн, что объявление войны).
   */
  private applyResearchShiftAction(action: Extract<LLMAction, { type: "research_shift" }>): void {
    economyCommands.setResearchAllocation(this.game, action.sourceCountryId, action.data.domain, action.data.share);
  }

  /**
   * Применяет сдвиг фокуса производства техники (War Phase 2, независимый
   * гейм-дизайн разбор, 2026-07-06) — доля militarySpending на категорию
   * техники (EquipmentType), без именных единиц. Доступно и игроку, и
   * топ-державам через LLM (sourceCountryId — любая страна ростера, тот же
   * паттерн, что research_shift/война).
   */
  private applyProductionShiftAction(action: Extract<LLMAction, { type: "production_shift" }>): void {
    economyCommands.setProductionAllocation(
      this.game,
      action.sourceCountryId,
      action.data.equipmentType,
      action.data.share
    );
  }

  /**
   * Применяет наращивание/сворачивание добывающих мощностей региона
   * (docs/plans/04_RESOURCES.md) — ±1 уровень за ход, кап в Zod-схеме
   * (actionSchemas.ts), контроль над регионом и наличие депозита —
   * LLMResponseValidator перед вызовом, сама мутация — commands/resources.ts.
   */
  private applyBuildExtractionAction(action: Extract<LLMAction, { type: "build_extraction" }>): void {
    resourceCommands.buildExtraction(
      this.game,
      action.sourceCountryId,
      action.data.regionId,
      action.data.resource,
      action.data.delta
    );
  }

  /**
   * Получает информацию о стране игрока.
   */
  private getPlayerCountryInfo(): string {
    const player = this.game.countries.find(c => c.id === this.game.playerCountryId);
    if (!player) return 'Unknown';

    return `
- Name: ${getText(player.name, LLM_LOCALE)}
- GDP: $${(player.economy.gdp / 1e9).toFixed(2)}B (per capita: $${Math.round(getGdpPerCapita(player)).toLocaleString()})
- Population: ${(player.population / 1e6).toFixed(2)}M
- Living standard index: ${Math.round(getLivingStandardIndex(player, this.game.regions))}/100
- Military: ${player.military.manpower.toLocaleString()}
- Technology: ${this.getTechTierSummary(player)}
- Allies: ${player.diplomacy.allies.join(', ') || 'None'}
- Rivals: ${player.diplomacy.rivals.join(', ') || 'None'}${this.getRecentTitlesLine(player.id, PLAYER_RECENT_TITLES_COUNT)}
`;
  }

  /**
   * Компактная сводка тиров доменов технологий (docs/DECISIONS.md,
   * 2026-07-06) — только домены с тиром > 0, чтобы не перечислять все ~14
   * доменов эры каждый цикл. Тир — не именная технология, декоративное имя
   * прорыва при пересечении порога придумывает сам LLM в нарративе.
   */
  private getTechTierSummary(country: Country): string {
    const entries = Object.entries(country.technology.domains)
      .map(([domain, progress]) => [domain, getDomainTier(progress)] as const)
      .filter(([, tier]) => tier > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return 'no notable tech progress yet';
    return entries.map(([domain, tier]) => `${domain} T${tier}`).join(', ');
  }

  /**
   * "Память страны" без записи от LLM: последние `limit` заголовков её
   * событий из eventHistory, самые свежие первыми. Пустая строка, если по
   * стране ещё не было событий (не засорять промт для новой партии).
   */
  private getRecentTitlesLine(countryId: string, limit: number): string {
    const relevant = this.game.eventHistory.filter(e => e.countries.includes(countryId));
    if (relevant.length === 0) return '';

    const recent = relevant.slice(-limit).reverse();
    const formatted = recent.map(e => `${e.title} (${e.date})`).join('; ');
    return `\n  Recent: ${formatted}`;
  }

  /**
   * Страны с tier === 'major' (TierTick.ts — 10 стран, пересчитывается раз в
   * год по составному скору ВВП/военной/влияния). До 2026-07-04 здесь был
   * top-5 по ВВП — ad-hoc метрика, не знавшая о существующем поле `tier`; см.
   * docs/DECISIONS.md, вопрос 11. Отсортировано по ВВП только для порядка
   * отображения — на выбор набора не влияет.
   */
  private getMajorPowers(): Country[] {
    return this.game.countries
      .filter(c => c.tier === 'major')
      .sort((a, b) => b.economy.gdp - a.economy.gdp);
  }

  /**
   * Получает информацию о крупных державах.
   */
  private getMajorPowersInfo(): string {
    const majors = this.getMajorPowers();
    if (majors.length === 0) return 'No major powers';
    return majors.map(c =>
      `- ${getText(c.name, LLM_LOCALE)}: GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, Military ${c.military.manpower.toLocaleString()}, Tech: ${this.getTechTierSummary(c)}` +
      this.getRecentTitlesLine(c.id, MAJOR_RECENT_TITLES_COUNT)
    ).join('\n');
  }

  /**
   * Пул кандидатов на ротацию — все не-major страны, отсортированные по id.
   * Сортировка по id (не по ВВП/скору) намеренно: эти поля меняются каждый
   * тик и сдвигали бы порядок ротации непредсказуемо — id страны стабилен
   * всю партию, гарантируя, что полный оборот действительно проходит по
   * всем странам без пропусков/повторов.
   */
  private getSpotlightPool(): Country[] {
    return [...this.game.countries]
      .filter(c => c.tier !== 'major')
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Следующие LLM_SPOTLIGHT_COUNT стран пула начиная с llmSpotlightCursor
   * (round-robin с оборачиванием). Не двигает курсор — генерация промта
   * должна быть идемпотентной; курсор двигает только advanceSpotlightCursor
   * (вызывается из processResponse при успешном проходе цикла).
   */
  private getSpotlightCountries(): Country[] {
    const pool = this.getSpotlightPool();
    if (pool.length === 0) return [];

    const cursor = (this.game.llmSpotlightCursor ?? 0) % pool.length;
    const count = Math.min(LLM_SPOTLIGHT_COUNT, pool.length);
    return Array.from({ length: count }, (_, i) => pool[(cursor + i) % pool.length]!);
  }

  /** Продвигает курсор ротации на LLM_SPOTLIGHT_COUNT, с оборачиванием. */
  private advanceSpotlightCursor(): void {
    const pool = this.getSpotlightPool();
    if (pool.length === 0) return;

    const cursor = (this.game.llmSpotlightCursor ?? 0) % pool.length;
    this.game.llmSpotlightCursor = (cursor + LLM_SPOTLIGHT_COUNT) % pool.length;
  }

  /**
   * Получает информацию о странах в ротации ("Spotlight Countries").
   */
  private getSpotlightInfo(): string {
    const spotlight = this.getSpotlightCountries();
    if (spotlight.length === 0) return 'No spotlight countries this cycle';
    return spotlight.map(c =>
      `- ${getText(c.name, LLM_LOCALE)} (${c.tier}): GDP $${(c.economy.gdp / 1e9).toFixed(2)}B, stability ${Math.round(c.politics.stability)}` +
      this.getRecentTitlesLine(c.id, SPOTLIGHT_RECENT_TITLES_COUNT)
    ).join('\n');
  }

  /**
   * Собирает id→name всех стран, упомянутых по имени где-либо в промте
   * (игрок, крупные державы, ротация, стороны напряжённостей, союзники/
   * соперники игрока). LLM должна использовать эти id как есть — никогда не
   * угадывать код из имени (регрессия 2026-07-04: ChatGPT вернул "SOV"/"ROM"
   * вместо реальных "SUN"/"ROU", потому что промт до этого фикса не давал id
   * вообще).
   */
  private getReferencedCountries(): Map<string, string> {
    const referenced = new Map<string, string>();
    const add = (id: string | undefined) => {
      if (!id) return;
      const country = this.game.countries.find(c => c.id === id);
      if (country) referenced.set(country.id, getText(country.name, LLM_LOCALE));
    };

    add(this.game.playerCountryId);
    for (const c of this.getMajorPowers()) add(c.id);
    for (const c of this.getSpotlightCountries()) add(c.id);

    const player = this.game.countries.find(c => c.id === this.game.playerCountryId);
    if (player) {
      for (const id of player.diplomacy.allies) add(id);
      for (const id of player.diplomacy.rivals) add(id);
    }

    for (const country of this.game.countries) {
      for (const rivalId of country.diplomacy.rivals) {
        if (this.game.countries.some(c => c.id === rivalId)) {
          add(country.id);
          add(rivalId);
        }
      }
    }

    return referenced;
  }

  /**
   * Форматирует секцию "## Country IDs" — id стран, отсортированные для
   * детерминированности промта (не порядок обхода Map).
   */
  private getCountryIdsSection(): string {
    const referenced = this.getReferencedCountries();
    if (referenced.size === 0) return 'No countries referenced';

    return [...referenced.entries()]
      .sort(([idA], [idB]) => idA.localeCompare(idB))
      .map(([id, name]) => `- ${id}: ${name}`)
      .join('\n');
  }

  /**
   * Получает информацию об активных войнах.
   */
  private getActiveWarsInfo(): string {
    const activeWars = this.game.wars.filter(w => w.active);
    if (activeWars.length === 0) return 'No active wars';

    const nameOf = (id: string) => {
      const country = this.game.countries.find(c => c.id === id);
      return country ? getText(country.name, LLM_LOCALE) : id;
    };

    return activeWars.map(w => {
      const attackerNames = w.attackers.map(nameOf).join(', ');
      const defenderNames = w.defenders.map(nameOf).join(', ');
      const { toAttackers, toDefenders } = w.territoryFlips;
      const front =
        toAttackers > toDefenders ? 'attackers advancing' :
        toDefenders > toAttackers ? 'defenders advancing' :
        'front stable';
      const score = computeWarScore(w);
      const scoreStr = `${score >= 0 ? '+' : ''}${score} (${warScoreLabel(score)})`;
      const attackerCas = sumSideCasualties(w, w.attackers);
      const defenderCas = sumSideCasualties(w, w.defenders);
      const casStr = `casualties ${attackerCas.toLocaleString()} vs ${defenderCas.toLocaleString()}`;
      const goal = w.warGoal ? `, goal: ${w.warGoal}` : '';
      return `- ${attackerNames} vs ${defenderNames}: ${front}, war score ${scoreStr}, ${casStr}${goal}`;
    }).join('\n');
  }

  /**
   * Рендерит и потребляет `pendingWorldFacts` (независимый гейм-дизайн
   * разбор, 2026-07-06) — детерминированные факты, обнаруженные движком
   * этот месяц (сейчас: пересечение тира домена технологий,
   * SimulationEngine.ts), отфильтрованные до стран, уже видимых в этом
   * промте (те же id, что в "## Country IDs" — getReferencedCountries()).
   * Очищает game.pendingWorldFacts сразу после рендера — факт одноразовый,
   * не история (для истории — Event, который сама LLM пишет по итогам хода).
   */
  /**
   * Секция кризисов регионов с кризисным капом (docs/CONCEPT.md §7 — «CRISES —
   * динамический кап, hard-cap ≤ ~5 одновременно; остальное тлеет фоном»).
   *
   * Источник — ЛАТЧ активных кризисов (`game.regionCrisisLatch`), а не
   * одноразовые факты. Разница принципиальная. Факт `region_crisis` движок
   * выдаёт РОВНО ОДИН РАЗ, при пересечении порога; если бы кап отбирал среди
   * фактов, невлезший кризис исчезал бы навсегда — регион остаётся под латчем и
   * второго факта не получит. Хранить очередь невыведенных фактов тоже нельзя:
   * подавленный за это время регион отдал бы в промт кризис, которого уже нет,
   * то есть ложь. Вывод секции из латча решает обе задачи: острота считается
   * заново каждый рендер, поэтому «невлезший» кризис всплывает сам, как только
   * станет острее показанных, а снятый исчезает сам.
   *
   * Стоимость — см. заметку в `crisisDigest.ts`: разложение по группам
   * считается для ВСЕХ регионов в кризисе, а не для показанной пятёрки, и
   * дёшево это сегодня по данным (14 размеченных регионов), а не по
   * конструкции. При полной разметке Милстоуна 2 мерить заново.
   *
   * Одноразовые факты `region_crisis` здесь ПОТРЕБЛЯЮТСЯ — но не как источник
   * текста, а как пометка «этот кризис новый в этом месяце». Иначе их вычистил
   * бы `getNotableDevelopmentsInfo` (он удаляет все факты, оставляя лишь
   * видимые страны) и информация о новизне пропала бы.
   */
  private getRegionalCrisesInfo(): string {
    const newThisMonth = new Set(
      this.game.pendingWorldFacts
        .filter(f => f.kind === "region_crisis" && f.regionId !== undefined)
        .map(f => f.regionId as number)
    );
    this.game.pendingWorldFacts = this.game.pendingWorldFacts.filter(
      f => f.kind !== "region_crisis"
    );

    const active = activeCrises(this.game);
    if (active.length === 0) return "No region is above the crisis threshold";

    const lines = active
      .slice(0, MAX_PROMPT_CRISES)
      .map(crisis => renderCrisis(this.game, crisis, { isNew: newThisMonth.has(crisis.region.id) }));

    const hidden = active.slice(MAX_PROMPT_CRISES);
    if (hidden.length > 0) lines.push(renderHiddenCrises(hidden));

    return lines.join("\n");
  }

  /**
   * Диагностика отказов примитивов для следующего промта (docs/PRIMITIVES.md §3
   * — «Reject → диагностический факт … и в следующий промт LLM, чтобы не
   * долбилась в невозможное»).
   *
   * Отдельной секцией, а не внутри «Notable Developments», по двум причинам:
   * отказ — это сигнал модели о правилах, а не материал нарратива (в события он
   * попасть не должен), и фильтр «Notable Developments» по видимым странам
   * молча выбросил бы отказ, чей источник в этом цикле не попал в промт.
   */
  private getRejectedAttemptsInfo(): string {
    const rejected = this.game.pendingWorldFacts.filter(f => f.kind === "primitive_rejected");
    this.game.pendingWorldFacts = this.game.pendingWorldFacts.filter(
      f => f.kind !== "primitive_rejected"
    );

    if (rejected.length === 0) return "Nothing was rejected last cycle";
    return rejected.map(f => `- ${f.text}`).join("\n");
  }

  private getNotableDevelopmentsInfo(): string {
    const visibleIds = this.getReferencedCountries();
    const visibleFacts = this.game.pendingWorldFacts.filter(f => visibleIds.has(f.countryId));
    this.game.pendingWorldFacts = [];

    if (visibleFacts.length === 0) return 'No notable developments this month';
    return visibleFacts.map(f => `- ${f.text}`).join('\n');
  }

  /**
   * Рендерит доступные исторические развилки (независимый гейм-дизайн
   * разбор, 2026-07-06; docs/tasks/HISTORICAL_HINGE_POINTS_1946.md) —
   * подсказки, не гарантированные факты (в отличие от
   * getNotableDevelopmentsInfo): предусловия выполнены и окно даты открыто,
   * но LLM решает сама, отразить это в нарративе или нет. Инкрементирует
   * счётчик показов каждой попавшей в промт развилки — только 1946
   * (единственный играбельный сценарий сейчас, docs/TODO.md).
   */
  private getHingePointHintsInfo(): string {
    const eligible = getEligibleHingePoints(this.game, HISTORICAL_HINGE_POINTS_1946);
    if (eligible.length === 0) return 'No historical hinge points active this period';

    for (const hp of eligible) {
      this.game.hingePointShowCount[hp.id] = (this.game.hingePointShowCount[hp.id] ?? 0) + 1;
    }

    return eligible
      .map(hp => `- ${hp.title}: ${hp.historicalOutcome} (if diverged: ${hp.divergenceHint})`)
      .join('\n');
  }

  /**
   * Рендерит летопись кампании (docs/plans/02_LLM_CONTRACT.md, Шаг 3,
   * game.chronicle — заполняется ChronicleTick.ts раз в год). В отличие от
   * getNotableDevelopmentsInfo/getHingePointHintsInfo — pure reader, НЕ
   * мутирует game: летопись накопительная память кампании, не одноразовый
   * факт/подсказка текущего цикла, потреблять её при каждом рендере промта
   * было бы неверно.
   */
  private getChronicleInfo(): string {
    if (this.game.chronicle.length === 0) return 'No chronicle yet (first year of the campaign)';
    return this.game.chronicle.map(c => `- ${c.year}: ${c.summary}`).join('\n');
  }

  /**
   * Получает информацию о последних событиях.
   */
  private getRecentEventsInfo(): string {
    const recentEvents = this.game.eventHistory.slice(-5);
    if (recentEvents.length === 0) return 'No recent events';

    return recentEvents.map(e => 
      `- ${e.date}: ${e.title}`
    ).join('\n');
  }

  /**
   * Получает информацию о дипломатической ситуации.
   */
  private getDiplomaticSituation(): string {
    const tensions: string[] = [];

    for (const country of this.game.countries) {
      for (const rivalId of country.diplomacy.rivals) {
        const rival = this.game.countries.find(c => c.id === rivalId);
        if (rival) {
          const relation = country.diplomacy.relations[rivalId] || 0;
          tensions.push(`${getText(country.name, LLM_LOCALE)} - ${getText(rival.name, LLM_LOCALE)}: ${relation}`);
        }
      }
    }

    if (tensions.length === 0) return 'No major diplomatic tensions';

    return tensions.join('\n');
  }

  /**
   * Получает намерение игрока на текущий ход (свободный текст).
   */
  private getPlayerIntentInfo(): string {
    const intent = this.game.playerIntent?.trim();
    if (!intent) return 'No player intent this cycle';
    return intent;
  }

  /**
   * Сохраняет промт в gameState.
   */
  savePrompt(prompt: string): void {
    this.game.llmContext = prompt;
  }

  /**
   * Сохраняет ответ LLM в gameState.
   */
  saveResponse(response: string): void {
    this.game.llmResponse = response;
  }

  /**
   * Увеличивает номер хода LLM.
   */
  incrementLlmTurn(): void {
    this.game.llmTurn = (this.game.llmTurn || 0) + 1;
  }

  /**
   * Сохраняет ожидающие действия от LLM.
   */
  savePendingActions(actions: LLMAction[]): void {
    this.game.pendingLlmActions = actions;
  }

  /**
   * Получает ожидающие действия от LLM.
   */
  getPendingActions(): LLMAction[] {
    return this.game.pendingLlmActions || [];
  }

  /**
   * Очищает ожидающие действия.
   */
  clearPendingActions(): void {
    this.game.pendingLlmActions = [];
  }
}
