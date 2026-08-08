import { createHash } from "node:crypto";
import { type GameState } from "@shared/types/GameState";
import {
  type PromptConsumption,
  type WorldFact,
} from "@shared/types/GameState";
import {
  emptyResponseReceipt,
  type ResponseReceipt,
} from "@shared/types/ResponseReceipt";
import { type Country } from "@shared/types/Country";
import { type PrimitiveOutcomeRecord } from "@shared/types/politics/PrimitiveOutcome";
import { type PrimitiveRejectionRecord } from "@shared/types/politics/PrimitiveRejection";
import { stripCodeFence } from "../llm/stripCodeFence";
import { type Locale, getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import {
  type AppliedPrimitive,
  type RejectedPrimitive,
  isStructural,
  PRIMITIVE_VERBS,
} from "../primitives/types";
import { countryNames } from "../primitives/entityNames";
import {
  rejectionPromptText,
  rejectionRecord,
  type PrimitiveRejection,
} from "../primitives/rejections";
import { findStateViolations } from "../primitives/invariants";
import {
  activeCrises,
  renderCrisis,
  renderHiddenCrises,
  type ActiveCrisis,
} from "../llm/crisisDigest";
import { regionDiscontent } from "@shared/utils/discontent";
import { type Region } from "@shared/types/map/Region";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { MAX_EXTRACTION_LEVEL } from "@shared/defines/resources";
import {
  MAX_PROMPT_CRISES,
  MAX_PROMPT_REGIONS_PER_COUNTRY,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
} from "@shared/defines/discontent";
import { PRIMITIVE_CONTRACT, PRIMITIVE_PLAYER_AGENCY_NOTE } from "../llm/primitiveContract";
import { parsePrimitives } from "../primitives/primitiveSchemas";
import { parseDatedEvents, MAX_DATED_EVENTS } from "../llm/datedEvents";
import { pushRejectionFact, rejectionFactText, restore } from "../primitives/PrimitiveEngine";
import {
  applyPrimitiveTurn,
  isDuplicatePrimitiveBatch,
  rememberResponseBatchKey,
} from "../primitives/turnBatch";
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
import { deriveEventFactuality } from "../llm/eventFactuality";
import { LLMResponseEnvelopeSchema } from "../llm/responseSchemas";

/**
 * Страж полноты `switch` по глаголу для веток, заканчивающихся `break`.
 * Параметр типа `never` не принимает неразобранный глагол — компиляция падает
 * там, где иначе новый глагол молча выпал бы из результата.
 */
function assertPrimitiveHandled(primitive: never): never {
  throw new Error(`Primitive verb is not handled by the receipt: ${JSON.stringify(primitive)}`);
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
  /**
   * Текст модели — ТОЛЬКО если он стал каноном (событие записано).
   *
   * Поля пустые при полном отказе, и это не экономия, а граница
   * (docs/CONCEPT.md §7.2 — «Нарратив пишется только после commit и по
   * фактически применённому результату»). Пока они возвращались всегда,
   * потребитель не мог отличить «так и произошло» от «модель это предложила, а
   * движок отказал»: интерфейс рисовал заголовок «Восстание подавлено» ровно
   * так же, как настоящий. Отсутствие поля делает эту ошибку невозможной,
   * вместо того чтобы полагаться на дисциплину читающего.
   *
   * Сырой ответ модели при этом не теряется — он лежит в `game.llmResponse`,
   * то есть остаётся доступен для диагностики, но не как канон.
   */
  title?: string;
  descriptions?: string;
  /**
   * Стал ли текст этого ответа каноном (записан ли `Event`).
   *
   * Отдельный флаг, а не вывод из пустого `title`: «модель не прислала
   * заголовок» и «заголовок не стал каноном» — разные вещи, и интерфейсу нужно
   * различать их, чтобы во втором случае показать человеку, что режиссёр
   * предложил невозможное, а не молча ничего.
   */
  narrativeCanonized: boolean;
  /**
   * ЧТО НА САМОМ ДЕЛЕ произошло — та же квитанция, что легла в событие
   * (`shared/types/ResponseReceipt.ts`).
   *
   * До Милстоуна 1 здесь лежали пять параллельных полей — степень
   * подтверждённости, применённые действия, отклонённые действия, отклик
   * примитивов, отказы примитивов, — и интерфейс собирал из них картину сам,
   * второй раз после того, как её собрало событие. Теперь источник один, и
   * ответ ручки, событие, летопись и память страны читают одно и то же.
   */
  receipt: ResponseReceipt;
}

/**
 * `PromptConsumption` (список показанного промтом) объявлен в
 * `shared/types/GameState.ts`: он лежит в состоянии партии и переживает
 * сохранение, потому что ручной цикл разносит выдачу промта и ответ на
 * неопределённое время.
 *
 * Зачем список вообще. Рендер промта потребляет одноразовые данные:
 * диагностику отказов (docs/PRIMITIVES.md §3 — «в следующий промт, чтобы не
 * долбилась в невозможное»), пометку «кризис новый в этом месяце» и счётчик
 * показов исторических развилок. До Милстоуна 1 он списывал их ПРЯМО ПРИ
 * РЕНДЕРЕ, и это давало две разные беды:
 *
 *   - в РУЧНОМ цикле `GET /llm/prompt` списывал их в момент выдачи текста;
 *     игрок, закрывший вкладку и не вставивший ответ, терял диагностику
 *     навсегда — модель её не видела, а в состоянии её уже не было;
 *   - в АВТОМАТИЧЕСКОМ цикле сбой провайдера лечился откатом снимка, и этот
 *     откат приходилось делать слиянием: состояние живёт и во время ожидания,
 *     приказ игрока дописывает туда свою диагностику, а безусловная запись
 *     доциклового снимка стирала её (классический lost update).
 *
 * Теперь рендер ЧИСТЫЙ: он ничего не списывает, а возвращает список того, что
 * показал. Списание — отдельный шаг (`commitPromptConsumption`), и происходит
 * оно там, где известно, что промт до модели ДОЕХАЛ: при обработке ответа.
 * Поэтому снимков, слияния и признака «чужое или наше» больше не нужно вовсе —
 * ничего не отнималось, значит нечего и возвращать.
 *
 * Цена названа прямо: два параллельных автоцикла перетирают намерение друг
 * друга, и факты проигравшего останутся в состоянии — то есть будут показаны
 * ещё раз. Это строго лучше прежнего поведения, где проигравший ТЕРЯЛ чужую
 * диагностику насовсем.
 */

/**
 * Равенство фактов ПО ЗНАЧЕНИЮ — для списания показанного промтом.
 *
 * По значению, а не по ссылке, потому что список показанного переживает
 * сохранение и загрузку: между `GET /llm/prompt` и `POST /llm/response` игрок
 * вправе сохраниться. Идентичность объектов этого не переживает, содержимое
 * переживает.
 */
function sameWorldFact(a: WorldFact, b: WorldFact): boolean {
  return (
    a.countryId === b.countryId &&
    a.text === b.text &&
    a.kind === b.kind &&
    a.regionId === b.regionId &&
    a.source === b.source
  );
}

/**
 * Сервис для работы с LLM симуляцией.
 * Управляет генерацией промтов, применением ответов LLM и валидацией действий.
 */

/**
 * Дата хода в ЧИТАЕМОМ виде — «февраль 1946 года» / «February 1946».
 *
 * ЗАЧЕМ. Промт отдавал модели только ISO (`1946-02-01`), а раздел «Narrative
 * Style» запрещает тащить в прозу технические идентификаторы — и модель, честно
 * выполняя оба указания, переставала называть время вообще: заголовки выходили
 * вида «Зима, когда мир держится на ниточке» вместо «Февраль 1946».
 * Замер живого прогона 2026-08-01: ни в одном из 24 заголовков за два года
 * период не назван.
 *
 * Приём взят из промтов Open-Historia (`.reference/`, разбор 2026-07-30): у них
 * дата подаётся ДВАЖДЫ — машинной строкой и «грамматической» формой, которую
 * модель вставляет в текст как есть. Идея дешёвая и снимает выбор между
 * «нарушить запрет» и «промолчать».
 */
const MONTHS: Record<Locale, string[]> = {
  // Именительный падеж: строка называет ПЕРИОД («февраль 1946 года»), а не дату
  // события («12 февраля»), поэтому родительный здесь был бы ошибкой.
  ru: ["январь", "февраль", "март", "апрель", "май", "июнь",
       "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  en: ["January", "February", "March", "April", "May", "June",
       "July", "August", "September", "October", "November", "December"],
};

export function readableDate(isoDate: string, locale: Locale): string {
  const [year, month] = isoDate.split("-");
  const index = Number.parseInt(month ?? "1", 10) - 1;
  const name = MONTHS[locale]?.[index] ?? MONTHS.en[index] ?? month ?? "";
  return locale === "ru" ? `${name} ${year} года` : `${name} ${year}`;
}

export class LLMService {
  private game: GameState;

  constructor(game: GameState) {
    this.game = game;
  }

  /**
   * Полный автоматизированный проход: промт → провайдер → применение.
   *
   * Здесь, а не в роуте, из-за одноразовых данных промта. Рендер сам ничего не
   * списывает (см. `PromptConsumption`), но НАМЕРЕНИЕ списать записывается в
   * состояние сразу: иначе сбой провайдера пришлось бы отличать от успеха
   * где-то ещё. Списывает их обработка ответа — то есть ровно тогда, когда
   * известно, что промт до модели доехал.
   *
   * Сбой ПРОВАЙДЕРА отменяет намерение. Битый или невалидный ответ модели — это
   * ответ: промт до неё доехал, диагностику она видела, и показывать те же
   * отказы второй раз незачем.
   */
  async runAutoCycle(askProvider: (prompt: string) => Promise<string>): Promise<LlmCycleResult> {
    const { prompt, consumption } = this.generatePrompt();
    this.savePrompt(prompt);
    this.game.pendingPromptConsumption = consumption;

    let rawResponse: string;
    try {
      rawResponse = await askProvider(prompt);
    } catch (error) {
      delete this.game.pendingPromptConsumption;
      throw error;
    }

    return this.processResponse(rawResponse);
  }

  /**
   * Списывает то, что показал промт, доехавший до модели.
   *
   * Удаление факта — ПО ЗНАЧЕНИЮ, а не по ссылке: между выдачей промта и
   * ответом партию могли сохранить и загрузить, а идентичность объектов этого
   * не переживает. Ищется первое вхождение, поэтому два побайтно равных факта
   * списываются по одному за раз, а не оба сразу.
   *
   * Факт, дописанный ПОСЛЕ рендера (приказ игрока, пока модель думала), в
   * списке показанного отсутствует и потому остаётся жить — он и должен уйти в
   * следующий промт. Это то же требование, ради которого прежняя реализация
   * держала два снимка и сливала их; теперь оно выполняется само, потому что
   * ничего не отнималось.
   */
  private commitPromptConsumption(): void {
    const pending = this.game.pendingPromptConsumption;
    if (!pending) return;
    delete this.game.pendingPromptConsumption;

    const remaining = [...this.game.pendingWorldFacts];
    for (const consumed of pending.facts) {
      const index = remaining.findIndex(fact => sameWorldFact(fact, consumed));
      if (index >= 0) remaining.splice(index, 1);
    }
    this.game.pendingWorldFacts = remaining;

    for (const id of pending.hingePointIds) {
      this.game.hingePointShowCount[id] = (this.game.hingePointShowCount[id] ?? 0) + 1;
    }
  }

  /**
   * Полный проход цикла по сырому ответу LLM — ОДНОЙ ТРАНЗАКЦИЕЙ
   * (docs/CONCEPT.md §7.2: `plan → validate → apply → post-invariants → commit`).
   *
   * Что здесь изменилось в Милстоуне 1 и почему.
   *
   * **Канал ответа теперь ОДИН** (2026-08-02). Старого канала `actions` не
   * существует: его последние четыре типа стали глаголами алфавита, и мир
   * меняется только через `applyPrimitiveBatch`. Транзакция от этого не
   * упростилась — она по-прежнему идёт на клоне и коммитится целиком, — но
   * причина у неё стала другой: раньше клон был нужен, чтобы два канала не
   * оставили «полусобытие» из половины каждого; теперь — чтобы отказ
   * структурного примитива уносил весь ответ.
   *
   * **Idempotency — на весь ответ.** Ключ выводится из содержания ответа и
   * игровой даты и проверяется ДО первого изменения. Раньше он прикрывал
   * только массив `primitives`: повторно вставленный ответ не применял
   * примитивы дважды, но `applyLlmActions` отрабатывал второй раз и двигал
   * отношения ещё раз — молча.
   *
   * **Ключ ЗАПОМИНАЕТСЯ на любом исходе** (исправлено 2026-07-27 по
   * независимому ревью). Проверять ключ и не записывать его — не защита: до
   * правки его писал только движок примитивов, на клоне и только когда его
   * позвали, поэтому ответ БЕЗ примитивов (законный — поле необязательное) не
   * запоминался вовсе, а откаченный терял ключ вместе с клоном. Оба случая
   * ловились повтором: в первом отношения двигались второй раз, во втором
   * второй раз писалась диагностика и рос счётчик хода модели. Теперь ключ
   * переписывается в боевое состояние после решения commit/rollback
   * (`rememberResponseBatchKey`), в кольцо по факту изменения МИРА обоими
   * каналами.
   *
   * **Пост-инварианты — отдельная фаза.** Мир после применения проверяется
   * целиком (`findStateViolations`): бюджет хода, диапазоны памяти воздействий,
   * координаты и поддержка, висячие ссылки объектов карты. Нарушение
   * откатывает ВЕСЬ ответ — то есть последний рубеж срабатывает даже там, где
   * его пробил бы новый глагол, забывший собственную проверку.
   *
   * Дата в ключе, а не номер хода: `processResponse` сам инкрементирует
   * `llmTurn`, поэтому повторный POST того же ответа получил бы другой номер и
   * защита не сработала бы. Дата же между двумя ответами одного месяца не
   * меняется — повтор ловится, — а тот же текст в другом месяце законен.
   */
  processResponse(rawResponse: string): LlmCycleResult {
    // Промт ДОЕХАЛ — раз есть ответ, каким бы он ни был. Списывается показанное
    // здесь, до разбора: битый JSON и повтор ответа тоже означают, что модель
    // диагностику видела, и показывать те же отказы второй раз значило бы
    // упрекать её за то, что уже сказано.
    this.commitPromptConsumption();

    let raw: unknown;
    try {
      // Забор ```json снимается ДО разбора: он ломает `JSON.parse`, хотя внутри
      // лежит целый корректный ответ (замер — `stripCodeFence.ts`). Точка одна
      // на оба цикла: автоматический и ручной, где игрок вставляет текст из
      // чужого интерфейса — там забор ещё вероятнее.
      raw = JSON.parse(stripCodeFence(rawResponse));
    } catch {
      return this.rejectedResponse("Invalid JSON format");
    }

    const envelope = LLMResponseEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      // Envelope-схема несёт самоописательные сообщения ("Missing descriptions
      // field" и т.п.) — без префикса пути поля.
      return this.rejectedResponse(
        envelope.error.issues[0]?.message ?? "Invalid response format"
      );
    }

    const { title, descriptions, actions, primitives, events } = envelope.data;

    const digest = createHash("sha256").update(rawResponse).digest("hex").slice(0, 16);
    const idempotencyKey = `llm:${this.game.currentDate}:${digest}`;

    // Повтор ловится ДО любого изменения состояния и до записи диагностики:
    // иначе второй POST того же ответа ничего бы не применил (это ловит ключ
    // внутри границы хода), но второй раз наплодил бы факты об одних и тех же
    // отказах, и следующий промт получил бы их дважды.
    if (isDuplicatePrimitiveBatch(this.game, idempotencyKey)) {
      return {
        success: true,
        narrativeCanonized: false,
        receipt: {
          ...emptyResponseReceipt(this.game.currentDate),
          duplicate: true,
          primitives: {
            applied: [],
            rejected: [rejectionRecord({ code: "duplicateResponse" })],
          },
        },
      };
    }

    // --- ФАЗА PLAN + VALIDATE + APPLY: всё на клоне, боевое состояние цело ---
    const working: GameState = structuredClone(this.game);

    const primitiveResult = this.applyResponsePrimitives(working, primitives, idempotencyKey);

    // Отказы примитивов хранятся СЫРЫМИ (`RejectedPrimitive` — код + параметры)
    // и в запись игрока превращаются здесь. Причина: на пути отката тот же
    // отказ надо отрендерить ещё и по-английски для промта, а из записи игрока
    // этого уже не сделать — union кода к тому моменту смаплен, и в промт
    // уходил голый `record.code` («reformNotDomestic» вместо объяснения
    // правила). Найдено независимым ревью 2026-07-27.
    const rejectedPrimitiveRecords: PrimitiveRejectionRecord[] = primitiveResult.rejected.map(
      entry => rejectionRecord(entry.rejection, entry.verb)
    );

    // Ответ, пришедший с массивом `actions`, получает ОТКАЗ, а не молчание.
    // Канала больше нет ни в схеме генерации, ни в промте, но локальная модель
    // может выдумать его по памяти о старом контракте — и молча съеденный
    // массив вернул бы ровно тот дефект, ради которого канал сносился: модель
    // считает применённым то, чего движок не читал. Отказ уходит и игроку
    // (кодом), и в следующий промт (объяснением, что канала нет).
    const legacyActions = actions?.length ?? 0;
    if (legacyActions > 0) {
      rejectedPrimitiveRecords.push(
        rejectionRecord({ code: "legacyActionsChannel", count: legacyActions })
      );
      this.pushLegacyChannelFact(working, legacyActions);
    }

    // --- ФАЗА POST-INVARIANTS ---
    const violations = findStateViolations(working);

    // Отказ структурного примитива отклоняет ВЕСЬ ОТВЕТ (docs/PRIMITIVES.md §3).
    // Движок откатывает мягкие примитивы сам; транзакция на клоне остаётся
    // нужна ради пост-инвариантов, которые проверяют мир целиком уже ПОСЛЕ
    // применения.
    //
    // Отказ ГРАНИЦЫ АГЕНТНОСТИ сюда намеренно не входит: он говорит «это не
    // твоё решение», а не «так не бывает», и стирать вместе с ним давление,
    // которое режиссёр законно создал, значило бы стирать сам предлагаемый
    // игроку выбор (JSDoc `splitByAgency`).
    const rolledBackByStructural = primitiveResult.structuralRejected;

    // --- ФАЗА COMMIT ---
    const committed = violations.length === 0 && !rolledBackByStructural;
    if (committed) {
      restore(this.game, working);
    }

    // Мир изменился — значит ключ дорогой (кольцо применённых): его вытеснение
    // означало бы, что сетевой ретрай применится вторым приказом.
    const appliedChange = committed && primitiveResult.outcomes.length > 0;

    // Ключ пишется в БОЕВОЕ состояние и на любом исходе — иначе проверка выше
    // (`isDuplicatePrimitiveBatch`) держалась бы на записи, которой при ответе
    // без примитивов не делает никто, а при откате уносит клон.
    rememberResponseBatchKey(this.game, idempotencyKey, appliedChange);

    // Бухгалтерия цикла живёт ВНЕ мировой транзакции и намеренно: ответ модели
    // состоялся независимо от того, принял ли мир его содержимое. Оставить
    // `llmRespondedThisTurn` false при откате значило бы запереть партию —
    // ход не продвигается без ответа (docs/LLM_RULES.md).
    this.saveResponse(rawResponse);
    this.incrementLlmTurn();
    this.advanceSpotlightCursor();
    this.game.playerIntent = "";
    this.game.llmRespondedThisTurn = true;

    if (rolledBackByStructural && violations.length === 0) {
      this.rewriteRolledBackDiagnostics(primitiveResult.rejected, legacyActions);
      return {
        success: true,
        narrativeCanonized: false,
        receipt: {
          ...emptyResponseReceipt(this.game.currentDate),
          factuality: "partial",
          primitives: { applied: [], rejected: rejectedPrimitiveRecords },
        },
      };
    }

    if (violations.length > 0) {
      // Диагностика отката пишется в БОЕВОЕ состояние: та, что движок написал
      // на клоне, ушла вместе с клоном, и без этой записи откат был бы
      // невидим и для игрока, и для модели.
      const rolledBack: PrimitiveRejectionRecord = rejectionRecord({
        code: "postInvariantViolated",
        details: violations,
      });
      this.rewriteRolledBackDiagnostics(primitiveResult.rejected, legacyActions);
      pushRejectionFact(
        this.game,
        "primitive_rejected",
        {
          countryId: this.game.playerCountryId,
          text: rejectionFactText({
            rejection: { code: "postInvariantViolated", details: violations },
          }),
        },
        "director"
      );
      return {
        success: true,
        narrativeCanonized: false,
        receipt: {
          ...emptyResponseReceipt(this.game.currentDate),
          factuality: "partial",
          primitives: { applied: [], rejected: [...rejectedPrimitiveRecords, rolledBack] },
        },
      };
    }

    /**
     * Степень подтверждённости текста — из ЧИСЕЛ применённого и отклонённого,
     * а не из смысла текста (docs/PRIMITIVES.md §3, решение пользователя
     * 2026-07-27). Три состояния: `confirmed` (всё предложенное применено),
     * `partial` (часть отклонена — текст вправе описывать именно её),
     * `unconfirmed` (ответ не предлагал движку ничего — чистый нарратив,
     * фоновый слой §4).
     *
     * Число ОТКЛОНЁННЫХ берётся из записей квитанции, а не из результата
     * движка: отказ по несуществующему каналу `actions` живёт только там, и
     * ответ, попросивший движок о старом канале, обязан считаться частично
     * подтверждённым, а не полностью.
     */
    const factuality = deriveEventFactuality({
      proposedPrimitives: primitives?.length ?? 0,
      appliedPrimitives: primitiveResult.outcomes.length,
      rejectedPrimitives: rejectedPrimitiveRecords.length,
      proposedLegacyActions: actions?.length ?? 0,
    });

    /**
     * Датированные события разбираются ПОСЛЕ вывода `factuality` и в его счёт
     * намеренно не входят.
     *
     * Причина не в аккуратности, а в смысле: `factuality` аттестует, сколько из
     * ПРЕДЛОЖЕННОГО ДВИЖКУ он применил. Датированное событие движку ничего не
     * предлагает — это текст. Считай мы его отказы вместе с примитивами, ответ
     * без единого примитива, но с одной кривой датой, перестал бы быть
     * `unconfirmed` и, по правилу канонизации ниже, потерял бы вместе с
     * событием ещё и всю прозу. Отказ по тексту не должен стирать текст.
     */
    const knownCountries = new Set(this.game.countries.map(country => country.id));
    const datedEvents = parseDatedEvents(events, this.game.currentDate, id =>
      knownCountries.has(id)
    );
    // Причина уходит и игроку (кодом в квитанции), и модели (фактом в промт) —
    // тем же способом, что у канала `actions`: отброшенное молча модель считает
    // записанным.
    for (const rejection of datedEvents.rejections) {
      rejectedPrimitiveRecords.push(rejectionRecord(rejection));
      pushRejectionFact(
        this.game,
        "action_rejected",
        {
          countryId: this.game.playerCountryId,
          text: rejectionPromptText(rejection),
        },
        "director"
      );
    }

    const receipt: ResponseReceipt = {
      date: this.game.currentDate,
      duplicate: false,
      factuality,
      ...this.touchedByResponse(primitiveResult.applied),
      primitives: {
        applied: primitiveResult.outcomes,
        rejected: rejectedPrimitiveRecords,
      },
    };

    /**
     * Канон пишется ТОЛЬКО после commit (docs/CONCEPT.md §7.2, исправлено
     * 2026-07-26 по внешнему аудиту).
     *
     * Сценарий, который это закрывает: модель пишет «Восстание подавлено» и
     * предлагает `repress` от имени страны игрока; граница агентности примитив
     * правильно отклоняет; мир не меняется — а заголовок всё равно уходил в
     * `eventHistory`, оттуда в «память страны», в летопись и в следующий промт.
     * Это и есть боль Pax Historia «событие осталось, а мир не изменился», ради
     * лечения которой строился весь редизайн.
     *
     * Условие выражено через `factuality`, а не через второй счёт
     * предложенного: `unconfirmed` — это ровно и только «модель ничего не
     * предлагала». Двух независимых определений одной границы быть не должно,
     * иначе они разъедутся.
     */
    const canonized = factuality === "unconfirmed" || appliedChange;

    if (!canonized) {
      return { success: true, narrativeCanonized: false, receipt };
    }

    const eventTitle = title?.trim() || `Мировые события (LLM, ход ${this.game.llmTurn})`;

    const responseEventId = `llm-turn-${this.game.llmTurn}`;

    this.game.eventHistory.push({
      kind: "response",
      id: responseEventId,
      date: this.game.currentDate,
      title: eventTitle,
      description: descriptions,
      // Квитанция едет ВМЕСТЕ с текстом: `Event` не несёт чисел предложенного,
      // поэтому по самому событию отличить «применилось всё» от «применилось
      // частично» задним числом уже нельзя.
      receipt,
    });

    /**
     * Датированные события пишутся ТОЛЬКО здесь, за той же границей
     * канонизации, что и проза: ответ, не применивший ничего, не оставляет ни
     * того, ни другого (docs/PRIMITIVES.md §3). Квитанции у них нет — есть
     * ссылка на запись ответа, по которой подтверждённость и разрешается.
     */
    datedEvents.drafts.forEach((draft, index) => {
      this.game.eventHistory.push({
        kind: "dated",
        id: `${responseEventId}-event-${index + 1}`,
        date: draft.date,
        title: draft.title,
        description: draft.description,
        responseEventId,
        claimedCountries: draft.claimedCountries,
      });
    });

    return {
      success: true,
      title: eventTitle,
      descriptions,
      narrativeCanonized: true,
      receipt,
    };
  }

  /**
   * Переписывает диагностику отката в БОЕВОЕ состояние.
   *
   * Всё, что написано во время применения, лежит на клоне и уходит вместе с
   * ним. Без этой перезаписи откат невидим: модель не узнаёт, ПОЧЕМУ ответ не
   * прошёл, и повторяет ту же попытку — ровно против чего диагностика и
   * заведена (docs/PRIMITIVES.md §3).
   *
   * Текст рендерится из СЫРОГО отказа (`rejectionFactText`), а не из записи
   * игрока: последняя несёт код без объяснения правила.
   */
  private rewriteRolledBackDiagnostics(
    rejectedPrimitives: readonly RejectedPrimitive[],
    legacyActions: number
  ): void {
    for (const entry of rejectedPrimitives) {
      pushRejectionFact(
        this.game,
        "primitive_rejected",
        {
          countryId: entry.sourceCountryId ?? this.game.playerCountryId,
          text: rejectionFactText(entry),
        },
        "director"
      );
    }
    // Отказ по несуществующему каналу переписывается вместе с остальными: он
    // тоже был написан на клоне и ушёл бы с ним. Без этого модель, приславшая
    // `actions` в ответе, который затем откатили, не узнала бы о канале ничего
    // и прислала бы его снова.
    if (legacyActions > 0) this.pushLegacyChannelFact(this.game, legacyActions);
  }

  /**
   * Диагностика по каналу, которого больше нет, — одной функцией, потому что
   * писать её приходится в два разных состояния: на клон (обычный путь,
   * коммитится вместе с ним) и в боевое (путь отката, где клон выбрасывается).
   *
   * Приписывается стране ИГРОКА: источники внутри записей старого канала не
   * разбираются вовсе — канал не читается, — и приписывать факт названной там
   * стране значило бы доверять полю, которое движок не валидировал.
   */
  private pushLegacyChannelFact(target: GameState, count: number): void {
    pushRejectionFact(
      target,
      "action_rejected",
      {
        countryId: target.playerCountryId,
        text: rejectionPromptText({ code: "legacyActionsChannel", count }),
      },
      "director"
    );
  }

  /** Ответ, отвергнутый до транзакции: состояние не тронуто ничем. */
  private rejectedResponse(error: string): LlmCycleResult {
    return {
      success: false,
      error,
      narrativeCanonized: false,
      receipt: emptyResponseReceipt(this.game.currentDate),
    };
  }

  /**
   * Страны и регионы, которых ответ реально коснулся, — из ФАКТИЧЕСКИ
   * применённого.
   *
   * Владелец региона берётся через `effectiveController`, а не через
   * `ownerCountryId`: примитив действует над регионом там же, где движок
   * проверял право на него, и при оккупации это разные страны.
   *
   * Регионы добавлены Милстоуном 1: квитанция обязана отвечать не только «кого
   * это касается», но и «где это произошло», иначе потребитель истории места
   * снова считал бы это сам.
   */
  private touchedByResponse(
    appliedPrimitives: readonly AppliedPrimitive[]
  ): { countries: string[]; regions: number[] } {
    const countries = new Set<string>();
    const regions = new Set<number>();

    const addRegion = (regionId: number): void => {
      regions.add(regionId);
      const region = this.game.regions.find(r => r.id === regionId);
      if (region) countries.add(effectiveController(region));
    };

    for (const primitive of appliedPrimitives) {
      countries.add(primitive.sourceCountryId);

      switch (primitive.verb) {
        case "enact_reform":
          countries.add(primitive.countryId);
          break;
        case "grant_autonomy":
          addRegion(primitive.regionId);
          // Соседи — не «побочный шум»: уступка отозвалась в их регионах, и
          // событие касается их владельцев так же фактически.
          for (const effect of primitive.neighbourEffects) addRegion(effect.regionId);
          break;
        case "spawn_incident":
          addRegion(primitive.regionId);
          if (primitive.disputedWithCountryId !== undefined) {
            countries.add(primitive.disputedWithCountryId);
          }
          break;
        case "incite_unrest":
        case "repress":
          addRegion(primitive.regionId);
          break;
        case "split_country":
          // Раскол касается и метрополии, и каждого осколка, и каждого
          // отделившегося региона: «память страны» осколка обязана начинаться
          // с собственного рождения.
          countries.add(primitive.countryId);
          for (const shard of primitive.shards) {
            countries.add(shard.countryId);
            for (const regionId of shard.regionIds) addRegion(regionId);
          }
          break;
        case "diplomacy":
        case "sanction":
        // Помощь, осуждение и патронаж — тоже акты между двумя государствами:
        // места у них нет, а не «не найдено».
        case "send_aid":
        case "condemn":
        case "support_proxy":
          countries.add(primitive.targetCountryId);
          break;
        case "capital_flight":
          // Отток капитала происходит В РЕГИОНЕ, и `addRegion` сам добавит его
          // фактического контролёра — ту страну, чья казна и пострадала.
          addRegion(primitive.regionId);
          break;
        case "war":
          // Война касается не пары, а ВСЕХ сторон: коалиции втянуты договорами,
          // и их «память страны» обязана начинаться с того, что их втянули.
          for (const id of [...primitive.attackers, ...primitive.defenders]) countries.add(id);
          break;
        case "peace":
          countries.add(primitive.targetCountryId);
          // Регионы, сменившие владельца по договору: событие фактически
          // произошло и с ними, а их новые контролёры попадают через `addRegion`.
          for (const regionId of primitive.annexedRegionIds) addRegion(regionId);
          break;
        case "puppet":
          // Подчинение касается ровно двух государств и ни одного места: земля
          // остаётся у субъекта, меняется его положение.
          countries.add(primitive.targetCountryId);
          break;
        case "annex":
          countries.add(primitive.targetCountryId);
          // Аннексированные регионы — то же, что у мира с условиями: событие
          // произошло и с ними, а новый владелец попадает через `addRegion`.
          for (const regionId of primitive.annexedRegionIds) addRegion(regionId);
          break;
        case "create_country":
          // Новое государство и его регионы: «память страны» новорождённого
          // обязана начинаться с собственного рождения — то же требование, что
          // у осколков раскола.
          countries.add(primitive.createdCountryId);
          for (const regionId of primitive.regionIds) addRegion(regionId);
          break;
        case "merge_countries":
          // Поглощённой страны в состоянии уже нет, но событие касается её
          // буквально: её идентификатор остаётся в квитанции как запись о
          // прошлом — ровно тот случай, который `countryRefs.ts` выводит из
          // реестра ссылок («история не переписывается»).
          countries.add(primitive.absorbedCountryId);
          for (const regionId of primitive.absorbedRegionIds) addRegion(regionId);
          break;
        case "guarantee":
          // Гарантия касается ровно двух государств: обязательство берут перед
          // страной, а не перед её землёй.
          countries.add(primitive.targetCountryId);
          break;
        case "research_shift":
        case "production_shift":
          // Сдвиг фокуса касается ОДНОЙ страны — той, чей бюджет двинули. Она
          // же источник: предпосылка глагола требует совпадения, и второй
          // записи здесь взяться неоткуда.
          countries.add(primitive.countryId);
          break;
        case "build_extraction":
          // Стройка происходит В РЕГИОНЕ; `addRegion` сам добавит его
          // фактического контролёра — ту страну, чья казна и заплатила.
          addRegion(primitive.regionId);
          break;
        default:
          // Явная проверка на недостижимость: ветки здесь заканчиваются
          // `break`, а не `return`, и без неё TypeScript полноту `switch` не
          // проверяет — новый глагол молча выпадал бы из квитанции, то есть из
          // «памяти страны» и истории места (найдено ревью 2026-07-27).
          assertPrimitiveHandled(primitive);
      }
    }

    return { countries: [...countries], regions: [...regions] };
  }

  /**
   * Применяет примитивы из ответа модели через границу хода.
   *
   * Три слоя отказа, в порядке применения:
   *   1. структурная схема (`parsePrimitives`) — форма по глаголу, закрытые
   *      enum'ы, отсутствие числовых полей в `params`;
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
   * **Правило «отказ структурного отклоняет весь батч» теперь действует и на
   * слое СХЕМЫ** (Милстоун 1). Раньше это было невозможно не по решению, а по
   * отсутствию данных: примитив, провалившийся структурно, глагола не нёс.
   * Per-verb discriminated union его несёт, поэтому битый `enact_reform` до
   * движка не доезжает — и уносит с собой мягкие примитивы того же ответа
   * ровно так же, как это делает отказ движка.
   *
   * На слой 2 правило по-прежнему НЕ распространяется, и это решение, а не
   * недосмотр: отказ агентности говорит «это не твоё решение», а не «так не
   * бывает». Обоснование целиком — в JSDoc `splitByAgency`
   * (`llm/primitiveAgency.ts`) и в docs/PRIMITIVES.md §3.
   */
  private applyResponsePrimitives(
    game: GameState,
    raw: unknown,
    idempotencyKey: string
  ): {
    applied: AppliedPrimitive[];
    outcomes: PrimitiveOutcomeRecord[];
    /**
     * Отказы СЫРЫМИ — код плюс типизированные параметры. Запись игрока
     * (`rejectionRecord`) и английский текст промта (`rejectionFactText`)
     * строятся из них у вызывающего: обратного пути от записи к union нет.
     */
    rejected: RejectedPrimitive[];
    /**
     * Структурный примитив отказал на схеме или в движке — весь ответ
     * откатывается, включая старый канал `actions` (docs/PRIMITIVES.md §3).
     * Отказ границы агентности сюда не входит: он другой природы.
     */
    structuralRejected: boolean;
  } {
    // Поля `primitives` нет — движок не зовём: `parsePrimitives(undefined)`
    // отчитался бы «payload is not an array», то есть выдумал бы отказ там, где
    // модель ничего не предлагала. Idempotency-ключ этот ранний выход НЕ
    // теряет: он принадлежит уровню ответа (`processResponse`) и пишется после
    // commit/rollback. До 2026-07-27 писал его только движок — и ровно поэтому
    // повтор такого ответа применял старый канал второй раз.
    if (raw === undefined) {
      return { applied: [], outcomes: [], rejected: [], structuralRejected: false };
    }

    const { primitives, invalid } = parsePrimitives(raw);
    const playerName = countryNames(game, game.playerCountryId);
    const { allowed, refused } = splitByAgency(primitives, game.playerCountryId, playerName);

    const rejected: RejectedPrimitive[] = [
      ...invalid.map(entry => ({
        ...(entry.verb === undefined ? {} : { verb: entry.verb }),
        rejection:
          entry.index >= 0
            ? ({ code: "schemaInvalid", position: entry.index + 1, detail: entry.reason } as const)
            : ({ code: "malformedBatch", detail: entry.reason } as const),
      })),
      ...refused,
    ];

    // Структурный, не доехавший до движка ПО СХЕМЕ, отклоняет весь ответ — то
    // же правило класса, что и внутри движка (docs/PRIMITIVES.md §3). Отказ
    // границы агентности в это условие намеренно не входит.
    const brokenStructural = invalid.find(
      entry => entry.verb !== undefined && isStructural(entry.verb)
    );
    const allowedAfterStructural = brokenStructural
      ? []
      : allowed;
    if (brokenStructural?.verb !== undefined) {
      for (const primitive of allowed) {
        rejected.push({
          verb: primitive.verb,
          sourceCountryId: primitive.sourceCountryId,
          rejection: { code: "structuralRollback", structuralVerb: brokenStructural.verb },
        });
      }
    }

    // Через ту же функцию, что и отказы движка: кап на число подробных записей
    // обязан считать все слои отказа этого канала вместе, иначе его снимал бы
    // любой второй слой. Источник назван явно (`"director"`) — у режиссёра своя
    // квота подробных записей, которую приказы игрока не расходуют
    // (docs/PRIMITIVES.md §3).
    for (const entry of rejected) {
      pushRejectionFact(
        game,
        "primitive_rejected",
        {
          countryId: entry.sourceCountryId ?? game.playerCountryId,
          text: rejectionFactText(entry),
        },
        "director"
      );
    }

    const outcome = applyPrimitiveTurn(game, allowedAfterStructural, idempotencyKey, "director");

    return {
      applied: outcome.applied,
      outcomes: outcome.outcomes,
      rejected: [...rejected, ...outcome.rejected],
      structuralRejected:
        brokenStructural !== undefined ||
        outcome.rejected.some(entry => entry.verb !== undefined && isStructural(entry.verb)),
    };
  }

  /**
   * Генерирует промт для LLM — ЧИСТО: состояние партии не меняется ни на байт.
   *
   * Одноразовые данные, которые промт показывает, возвращаются отдельным
   * списком (`PromptConsumption`), а списываются позже — когда известно, что
   * промт до модели доехал. До Милстоуна 1 три секции ниже мутировали
   * состояние прямо при рендере, и порядок их вычисления был частью
   * контракта: секция, которой нужны факты, обязана была считаться раньше той,
   * что их вычищает. Теперь порядок значения не имеет — вычищать нечего, —
   * но секции по-прежнему вынесены в константы, потому что каждая ДОПИСЫВАЕТ
   * в общий список показанного, и видеть этот список одним местом полезнее,
   * чем искать его по шаблонному литералу.
   */
  generatePrompt(): { prompt: string; consumption: PromptConsumption } {
    const consumption: PromptConsumption = { facts: [], hingePointIds: [] };

    const crises = this.getRegionalCrisesInfo(consumption);
    const rejectedAttempts = this.getRejectedAttemptsInfo(consumption);
    const notableDevelopments = this.getNotableDevelopmentsInfo(consumption);
    const hingePoints = this.getHingePointHintsInfo(consumption);

    const prompt = `
# Geopolis - World Simulation

## Current Date
${this.game.currentDate} — ${readableDate(this.game.currentDate, this.game.locale)}

This response covers exactly this one month. Name it in the prose the way it is
written above after the dash: the chronicle of a period always says which period
it describes. The ISO form is for the engine, never for the text.

## Language
Write "title", "descriptions", and any other free-text narrative you generate
in ${LANGUAGE_NAMES[this.game.locale]}. This applies only to the prose you write —
country ids, region ids, and other identifiers elsewhere in this prompt are
never translated, copy them verbatim.

## Narrative Style
Write the prose as a fragment of a historical chronicle of the period. Three
things are forbidden, because each one breaks the fiction from inside:
- quoting exact figures or sums taken from the data above — write "the largest
  economy in the world", never "$118.69B". The engine owns numbers; the
  chronicle owns meaning;
- carrying technical identifiers into the prose — write the country's name
  alone, never the name followed by its id in brackets. Ids belong in the
  structured fields, where they are read by the engine;
- mentioning the simulation, the campaign, the game, the turn, or "the data" —
  inside this world none of them exist.
Ground the narrative in the real events, people, and decisions of the period.

## Player Country
This country is played by a human. You never act for it: its state policy is the
player's own decision, and any primitive you send with it as the source will be
refused before it reaches the engine. Write about it in the narrative, react to
what it does — but decide for everyone else.
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

## Regions You Can Address
Region ids for the verbs that take a region (incite_unrest, spawn_incident,
repress, grant_autonomy, build_extraction). Copy an id verbatim from here — a
region that is not listed is not addressable this cycle, and a guessed number
is refused. "discontent" is the same 0..1 index as in Regional Crises: high
means the ground is ready, low means unrest there would need a cause first.
"can expand" lists the resources whose extraction in that region is still below
its ceiling, with the level it stands at. build_extraction with direction
"expand" works ONLY on a resource named there — and a region without that part
of the line has nothing left to expand, either because the ground holds nothing
or because its works are already built out to the ceiling. Silence there is an
answer, not an omission: in a world whose extraction is fully built, no region
carries the line at all. Dismantling has no such condition.
${this.getAddressableRegionsInfo()}

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
- Avoid a direct "war" primitive between two nuclear-armed Major Powers unless
  strongly, explicitly grounded in real historical events — prefer narrating
  proxy support (a patron backing a client state's own conflict) over direct
  war between such powers.
- You may direct the research focus of ANY country listed above — a Major Power
  or a Spotlight Country alike — with a "research_shift" primitive, and its
  military production focus with a "production_shift" primitive. Neither is
  reserved for the great powers: a Spotlight Country decides where its own
  laboratories and factories go exactly as a Major Power does.
  The research domains that exist are exactly these, and nothing else is a
  domain no matter how natural the name sounds:
  ${this.getResearchDomainsLine()}.
  A name that is not on that list is rejected even when it names a real field of
  research — "military", "land_forces", "aeronautics" are not domains here. A
  broad goal is pursued through whichever listed domains carry it.
- Alongside the prose, fill "events" with the datable turning points you have
  ALREADY written about in "descriptions" — at most ${MAX_DATED_EVENTS}, newest last. This is
  not a second story: an entry that the prose does not carry does not belong
  there, and the list is meant to make what you already said addressable, not
  longer. Each entry needs the exact day inside this month on which it happened;
  a development you cannot pin to a day stays in the prose and out of the list,
  and a month without a datable turning point legitimately returns an empty
  list. Unlike the prose, "date" is a structured field — the ISO form belongs
  there and only there. "countries" holds the ids of the countries the entry is
  about, copied verbatim from ## Country IDs.
- A country's research "tier" is just accumulated investment — there is no fixed
  catalog of named technologies. When a domain tier crosses a meaningful new
  threshold, narrate what this represents in concrete terms (what got invented or
  achieved): you invent the specific breakthrough, the engine only tracks the
  number. The same goes for equipment quality, which is decorative.

${PRIMITIVE_CONTRACT}
${PRIMITIVE_PLAYER_AGENCY_NOTE}

Return your response in JSON format with the following structure:
{
  "title": "Short one-line headline for this cycle's single most important development",
  "descriptions": "Narrative description of world events",
  "primitives": [
    {
      "verb": "${PRIMITIVE_VERBS.join("|")}",
      "sourceCountryId": "country_id",
      "target": { "countryId": "country_id" },
      "params": { "intensity": "mild|moderate|severe" }
    }
  ],
  "events": [
    {
      "date": "${this.game.currentDate}",
      "title": "Short headline of one dated development from the prose above",
      "description": "One or two sentences: what happened on that day and what follows from it",
      "countries": ["country_id"]
    }
  ]
}

There is NO "actions" array any more, and nothing lives outside "primitives".
Everything a response can do to the world — relations, sanctions, war, peace,
aid, condemnation, proxy support, guarantees, research and production focus,
extraction capacity — is a verb of the alphabet above. An "actions" array in your
response is not a shortcut: the engine ignores its contents and reports the whole
array back to you as a refusal.

Hard limits:
- sourceCountryId and every id inside "target" MUST be copied verbatim from the
  ## Country IDs section. Never invent, abbreviate, or guess an id from a
  country's name (e.g. do not turn "Soviet Union" into "SOV" or "USSR",
  or "Romania" into "ROM" — look up the real id in ## Country IDs).
- A primitive's "target" is always an OBJECT, never a bare string:
  { "countryId": "SUN" } or { "regionId": 300 }. A region id is a NUMBER —
  write { "regionId": 300 }, never { "regionId": "300" }. A primitive whose
  target has the wrong shape is refused before the engine sees it, and the
  refusal cannot tell you which field was wrong.
`;
    return { prompt, consumption };
  }

  // ВЕСЬ СТАРЫЙ КАНАЛ УДАЛЁН (2026-08-02). `applyLlmActions` и четыре
  // `apply*Action` вместе с ним: последние воздействия канала — `guarantee`,
  // `research_shift`, `production_shift`, `build_extraction` — стали глаголами
  // алфавита (`PrimitiveEngine`). Там их правила выражены структурными кодами
  // отказа, величины считает коридор от состояния, а результат команды
  // ПРОВЕРЯЕТСЯ: здесь он выбрасывался, и действие «уже на потолке» доезжало
  // до летописи применённым (`docs/TODO.md`, оба пункта закрыты переносом).
  //
  // Ранее тем же способом ушли `diplomacy`/`war`/`peace`/`sanction` (Милстоун 1,
  // дипломатический блок) и `influence` (сессия мягких глаголов). Сопутствующие
  // сдвиги отношений перенесены в обработчики глаголов БЕЗ изменения значений,
  // чтобы перевод не оказался ещё и тихой рекалибровкой.

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
   * ПОЛНЫЙ перечень имён доменов, которые примет валидатор, — одной строкой на
   * весь промт.
   *
   * Собирается объединением по странам, названным в `## Country IDs`, а не из
   * списка эры: предпосылка глагола сверяет домен с `technology.domains`
   * КОНКРЕТНОЙ страны (`PrimitiveEngine`, до 2026-08-02 —
   * `LLMResponseValidator`), и авторские данные вправе дать
   * стране домен сверх эры. Список эры совпал бы сегодня и разошёлся бы молча
   * при первом же таком наполнении — а разойтись он может только в сторону
   * «промт обещал меньше, чем движок принимает».
   *
   * Зачем вообще: `getTechTierSummary` печатает у страны только домены с тиром
   * больше нуля, поэтому полного словаря модель не видела нигде. Замер
   * (`.agent/runs/director-prompt-domains-2026-08-02`, 6 прогонов по 24 хода):
   * выдуманные имена `military`/`land_forces` — 8 ходов из 72 до правки и 0
   * после, Fisher p = 0,0064; заодно `research_shift` прошёл 154 раза против
   * ОДНОГО за те же 72 хода. Схема их не удерживает и не может —
   * `research_shift.domain` в контракте свободная строка
   * (`.agent/runs/gemini-prompt-modes-2026-08-01`, 140 вызовов).
   */
  private getResearchDomainsLine(): string {
    const domains = new Set<string>();
    for (const id of this.getReferencedCountries().keys()) {
      const country = this.game.countries.find(c => c.id === id);
      if (!country) continue;
      for (const domain of Object.keys(country.technology.domains)) domains.add(domain);
    }
    if (domains.size === 0) return 'none';
    return [...domains].sort().join(', ');
  }

  /**
   * Компактная сводка тиров доменов технологий (docs/DECISIONS.md,
   * 2026-07-06) — только домены с тиром > 0, чтобы не перечислять все ~14
   * доменов эры каждый цикл. Тир — не именная технология, декоративное имя
   * прорыва при пересечении порога придумывает сам LLM в нарративе.
   * Полный словарь допустимых имён даёт `getResearchDomainsLine`: здесь
   * показано, ГДЕ страна продвинулась, а не что ей разрешено.
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
    // Только записи ОТВЕТОВ: у датированного события нет квитанции, а его
    // список стран — заявление модели, не факт применения. Пустить их сюда
    // значило бы молча изменить вес месяца в памяти страны — месяц с четырьмя
    // событиями вытеснил бы из показа три предыдущих.
    const relevant = this.game.eventHistory.filter(
      e => e.kind === "response" && e.receipt.countries.includes(countryId)
    );
    if (relevant.length === 0) return '';

    const recent = relevant.slice(-limit).reverse();
    const formatted = recent
      .map(e => `${e.title} (${readableDate(e.date, this.game.locale)})`)
      .join('; ');
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
   * Позиция курсора в ТЕКУЩЕМ пуле: индекс страны, следующей за последней
   * показанной.
   *
   * Курсор хранится идентификатором, а не индексом (Милстоун 1, сессия
   * жизненного цикла): пул пересобирается из состава стран каждый цикл, и
   * индекс молча указывал бы на другую страну после любого раскола или
   * объединения. Страна, которой в пуле больше нет (распалась либо выросла до
   * major), даёт начало пула — это честное «продолжить с начала», а не
   * попадание в случайную позицию.
   */
  private spotlightStart(pool: readonly Country[]): number {
    const last = this.game.llmSpotlightCountryId;
    if (last === undefined) return 0;
    const index = pool.findIndex(c => c.id === last);
    return index < 0 ? 0 : (index + 1) % pool.length;
  }

  /**
   * Следующие LLM_SPOTLIGHT_COUNT стран пула, начиная за последней показанной
   * (round-robin с оборачиванием). Не двигает курсор — генерация промта должна
   * быть идемпотентной; курсор двигает только advanceSpotlightCursor
   * (вызывается из processResponse при успешном проходе цикла).
   */
  private getSpotlightCountries(): Country[] {
    const pool = this.getSpotlightPool();
    if (pool.length === 0) return [];

    const start = this.spotlightStart(pool);
    const count = Math.min(LLM_SPOTLIGHT_COUNT, pool.length);
    return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]!);
  }

  /** Запоминает последнюю показанную страну цикла — с неё продолжится счёт. */
  private advanceSpotlightCursor(): void {
    const shown = this.getSpotlightCountries();
    const last = shown[shown.length - 1];
    if (last) this.game.llmSpotlightCountryId = last.id;
  }

  /**
   * Карточка страны в ротации.
   *
   * Промт ТРЕБУЕТ дать минимум двум таким странам конкретный сюжетный ход, а
   * до 2026-08-02 давал о них три числа: ВВП, стабильность и два последних
   * заголовка. Из ВВП сюжета не выходит — выходит «экономика продолжает
   * восстанавливаться». Добавлены поля, которые УЖЕ ЕСТЬ в состоянии и из
   * которых сюжет выходит: с кем страна в союзе и вражде (это готовый
   * конфликт), воюет ли прямо сейчас, и сходится ли у неё бюджет.
   *
   * Бюджет — ЗНАКОМ, а не величиной, и это не экономия места: величины из
   * промта модель цитирует в прозе, а стиль это запрещает («движку числа,
   * хронике смысл»). Знак несёт ровно то, что нужно сюжету, — «казна трещит»
   * против «есть на что тратить».
   *
   * Регионы страны здесь НЕ дублируются: они уже перечислены отдельной секцией
   * `## Regions You Can Address` вместе с недовольством, и второй раз тот же
   * список стоил бы токенов, не добавив ни одного факта.
   */
  private getSpotlightInfo(): string {
    const spotlight = this.getSpotlightCountries();
    if (spotlight.length === 0) return 'No spotlight countries this cycle';

    const nameOf = (id: string): string => {
      const country = this.game.countries.find(c => c.id === id);
      return country ? `${getText(country.name, LLM_LOCALE)} (${id})` : id;
    };

    return spotlight.map(c => {
      const facts: string[] = [
        `GDP $${(c.economy.gdp / 1e9).toFixed(2)}B`,
        `stability ${Math.round(c.politics.stability)}`,
        c.economy.budgetBalance < 0 ? 'budget in deficit' : 'budget balanced or in surplus',
        String(c.politics.ideology),
      ];

      // Статус суверенитета — самое сюжетное поле карточки на данных 1946: из
      // 147 стран ротации 87 кому-то подчинены (32 колонии, 22 протектората,
      // 10 оккупационных зон, мандаты, кондоминиумы). Союзы и вражда, которые
      // просились сюда первыми, на старте пусты У ВСЕХ 147 — они наживаются
      // партией; колониальный статус есть сразу и сам по себе конфликт.
      const overlords = (c.politics.overlordIds ?? []).filter(id =>
        this.game.countries.some(x => x.id === id)
      );
      if (c.politics.sovereigntyStatus && c.politics.sovereigntyStatus !== 'sovereign') {
        const under = overlords.length > 0 ? ` under ${overlords.map(nameOf).join(', ')}` : '';
        facts.push(`${String(c.politics.sovereigntyStatus).replace(/_/g, ' ')}${under}`);
      }

      const allies = c.diplomacy.allies.filter(id => this.game.countries.some(x => x.id === id));
      const rivals = c.diplomacy.rivals.filter(id => this.game.countries.some(x => x.id === id));
      if (allies.length > 0) facts.push(`allied with ${allies.map(nameOf).join(', ')}`);
      if (rivals.length > 0) facts.push(`rival of ${rivals.map(nameOf).join(', ')}`);

      const war = this.game.wars.find(
        w => w.active !== false && (w.attackers.includes(c.id) || w.defenders.includes(c.id))
      );
      if (war) {
        const enemies = war.attackers.includes(c.id) ? war.defenders : war.attackers;
        facts.push(`AT WAR with ${enemies.map(nameOf).join(', ')}`);
      }

      return (
        `- ${getText(c.name, LLM_LOCALE)} (${c.tier}): ${facts.join(', ')}` +
        this.getRecentTitlesLine(c.id, SPOTLIGHT_RECENT_TITLES_COUNT)
      );
    }).join('\n');
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
    // Держатели ПОКАЗАННЫХ кризисов. Без них промт сам себе противоречил:
    // секция кризисов разворачивала регион страны, которой нет в этом списке, а
    // «Narrative requirements» запрещают о такой стране и говорить, и
    // действовать («it does not exist in this simulation right now»). Замер
    // 2026-08-02: 4 из 5 показанных кризисов были в странах вне списка (VNM,
    // IDN, PSE, MWI) — то есть горело там, куда модели ходить запрещено.
    for (const crisis of this.shownCrises()) add(effectiveController(crisis.region));

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
  private getRegionalCrisesInfo(consumption: PromptConsumption): string {
    const crisisFacts = this.game.pendingWorldFacts.filter(f => f.kind === "region_crisis");
    const newThisMonth = new Set(
      crisisFacts.filter(f => f.regionId !== undefined).map(f => f.regionId as number)
    );
    consumption.facts.push(...crisisFacts);

    const active = activeCrises(this.game);
    if (active.length === 0) return "No region is above the crisis threshold";

    const lines = this.shownCrises().map(crisis =>
      renderCrisis(this.game, crisis, { isNew: newThisMonth.has(crisis.region.id) })
    );

    const hidden = active.slice(MAX_PROMPT_CRISES);
    if (hidden.length > 0) lines.push(renderHiddenCrises(hidden));

    return lines.join("\n");
  }

  /**
   * Кризисы, попадающие в промт РАЗВЁРНУТО, — один срез для всех потребителей.
   *
   * Отдельный метод, потому что срез нужен дважды и обязан совпадать: его
   * рендерит `getRegionalCrisesInfo`, и по нему же `getReferencedCountries`
   * добавляет страны-держатели в `## Country IDs`. Два независимых вызова
   * `activeCrises().slice(...)` разошлись бы на первом же изменении капа, и
   * разойтись они могли бы только одним способом — промт снова показал бы
   * кризис в стране, о которой запрещено говорить.
   */
  private shownCrises(): ActiveCrisis[] {
    return activeCrises(this.game).slice(0, MAX_PROMPT_CRISES);
  }

  /**
   * Регионы, которые режиссёр вправе назвать целью, — с их id.
   *
   * ЗАЧЕМ. Региональные глаголы (`incite_unrest`, `spawn_incident`, `repress`,
   * `grant_autonomy`, `build_extraction`) адресуют регион числовым id, а промт
   * не давал ни одного: секция кризисов появляется лишь со второго хода и
   * показывает пять регионов МИРА, чаще всего в странах, которых нет в
   * `## Country IDs`. Замер 2026-08-02 (6 прогонов, 72 хода): `incite_unrest`
   * не применён ни разу, затронуто 2–3 региона за два года.
   *
   * КАКИЕ СТРАНЫ. Игрок (мир действует на него — ради этого режиссёра и зовут),
   * страны ротации (им и так положен нарративный beat) и держатели показанных
   * кризисов (иначе горящее снова окажется недоступным). Мир целиком сюда не
   * идёт: 1399 регионов не поместятся ни в какой бюджет промта, и правило
   * «избегай отправки полного состояния в LLM» (`AGENTS.md`) — про это.
   *
   * ПОРЯДОК ВНУТРИ СТРАНЫ — по недовольству: выбор цели делается именно по
   * нему, а алфавит или id ничего не сообщают. Кап — на страну
   * (`MAX_PROMPT_REGIONS_PER_COUNTRY`), причина там же.
   */
  private getAddressableRegionsInfo(): string {
    /**
     * Месторождения региона строкой — предпосылка `build_extraction`, которую
     * модель до 2026-08-08 не видела ВООБЩЕ.
     *
     * Замер, ради которого строка появилась: перечисление ресурсов в контракте
     * подняло число попыток глагола с 1 до 7 за 72 хода, но применённых
     * осталось 0 — все семь ушли в отказы `extractionAtMaximum` (5) и
     * `noDepositInRegion` (2). То есть словарь научил модель НАЗЫВАТЬ ресурс, а
     * промахивалась она по тому, чего в промте нет: где залежь есть и где
     * мощность ещё не на потолке.
     *
     * Показывается уровень и потолок, а не «можно/нельзя»: «coal 2/10» — это
     * свойство мира, из которого модель делает вывод сама, а готовый вердикт
     * пришлось бы держать в согласии с предпосылками движка в двух местах.
     */
    const extractionLine = (region: Region): string => {
      const expandable = Object.entries(region.deposits)
        .filter(([resource, size]) => {
          if ((size ?? 0) <= 0) return false;
          return (region.extraction[resource as ResourceType] ?? 0) < MAX_EXTRACTION_LEVEL;
        })
        .map(
          ([resource]) =>
            `${resource} ${region.extraction[resource as ResourceType] ?? 0}/${MAX_EXTRACTION_LEVEL}`
        );
      return expandable.length > 0 ? `, can expand: ${expandable.join(", ")}` : "";
    };

    const wanted = new Map<string, Country>();
    const add = (id: string | undefined): void => {
      if (!id || wanted.has(id)) return;
      const country = this.game.countries.find(c => c.id === id);
      if (country) wanted.set(id, country);
    };

    add(this.game.playerCountryId);
    for (const crisis of this.shownCrises()) add(effectiveController(crisis.region));
    for (const country of this.getSpotlightCountries()) add(country.id);

    const byCountry = new Map<string, { region: Region; discontent: number }[]>();
    for (const region of this.game.regions) {
      const owner = effectiveController(region);
      if (!owner || !wanted.has(owner)) continue;
      const list = byCountry.get(owner) ?? [];
      list.push({ region, discontent: regionDiscontent(this.game, region) ?? 0 });
      byCountry.set(owner, list);
    }

    const blocks: string[] = [];
    for (const [id, country] of wanted) {
      const regions = byCountry.get(id);
      if (!regions || regions.length === 0) continue;

      // id вторым ключом: при равном недовольстве порядок обязан быть
      // воспроизводим, иначе один и тот же мир давал бы разные промты.
      regions.sort((a, b) => b.discontent - a.discontent || a.region.id - b.region.id);
      const shown = regions.slice(0, MAX_PROMPT_REGIONS_PER_COUNTRY);
      const lines = shown.map(
        ({ region, discontent }) =>
          `  - ${region.id} ${getText(region.names, LLM_LOCALE)} — discontent ${discontent.toFixed(2)}` +
          extractionLine(region)
      );
      const rest = regions.length - shown.length;
      if (rest > 0) {
        lines.push(`  - (${rest} more region(s), all calmer than the ones above)`);
      }
      blocks.push(`- ${getText(country.name, LLM_LOCALE)} (${id}):\n${lines.join("\n")}`);
    }

    if (blocks.length === 0) return "No regions available to address this cycle";
    return blocks.join("\n");
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
  private getRejectedAttemptsInfo(consumption: PromptConsumption): string {
    // ОБА канала: примитивы и старые `actions` (docs/TODO.md, закрыто
    // Милстоуном 1). Раньше отказ действия уходил только игроку, и отучить
    // модель от заведомо отклоняемого действия можно было исключительно
    // инструкцией промта.
    const rejected = this.game.pendingWorldFacts.filter(
      f => f.kind === "primitive_rejected" || f.kind === "action_rejected"
    );
    consumption.facts.push(...rejected);

    if (rejected.length === 0) return "Nothing was rejected last cycle";
    return rejected.map(f => `- ${f.text}`).join("\n");
  }

  private getNotableDevelopmentsInfo(consumption: PromptConsumption): string {
    const visibleIds = this.getReferencedCountries();
    // Потребляются ВСЕ оставшиеся факты, а рендерятся только видимые: факт
    // одноразовый по определению, и невидимая в этом цикле страна не должна
    // копить свои факты до бесконечности. Секции выше свои факты уже
    // отметили, поэтому здесь их не осталось.
    const remaining = this.game.pendingWorldFacts.filter(
      fact => !consumption.facts.includes(fact)
    );
    consumption.facts.push(...remaining);

    const visibleFacts = remaining.filter(f => visibleIds.has(f.countryId));
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
  private getHingePointHintsInfo(consumption: PromptConsumption): string {
    const eligible = getEligibleHingePoints(this.game, HISTORICAL_HINGE_POINTS_1946);
    if (eligible.length === 0) return 'No historical hinge points active this period';

    consumption.hingePointIds.push(...eligible.map(hp => hp.id));

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
    // Записи ОТВЕТОВ, а не всё подряд: пять последних записей после появления
    // датированных событий были бы одним-двумя месяцами вместо пяти, и модель
    // потеряла бы горизонт. Показывать датированные события отдельной секцией —
    // отдельная правка промта со своим замером.
    const recentEvents = this.game.eventHistory.filter(e => e.kind === "response").slice(-5);
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

  // `savePendingActions`/`getPendingActions`/`clearPendingActions` УДАЛЕНЫ
  // (2026-08-02) вместе с полем `GameState.pendingLlmActions`. Механика была
  // подтверждённой мёртвой scaffolding: ни один прод-путь её не звал, только
  // собственный тест. «Ожидающих применения действий» не существует и по
  // устройству цикла — ответ модели применяется одной транзакцией в
  // `processResponse` либо не применяется вовсе.
}
