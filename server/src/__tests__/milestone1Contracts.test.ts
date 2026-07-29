import { describe, it, expect, vi } from "vitest";
import { type GameState } from "@shared/types/GameState";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { MAX_PENDING_REJECTION_FACTS_PER_SOURCE } from "@shared/defines/discontent";
import { IMPACT_MEMORY_FIELDS } from "@shared/types/politics/Demographics";
import { IDEOLOGY_AXES } from "@shared/types/politics/Ideology";
import { LLMService } from "../services/LLMService";
import { parsePrimitives, PRIMITIVE_SCHEMAS } from "../primitives/primitiveSchemas";
import { PRIMITIVE_PALETTE, pathMatchesPaletteEntry } from "../primitives/palette";
import { collectChangedPaths } from "../primitives/statePaths";
import { enumerateCells } from "../primitives/reconciliation";
import { findStateViolations } from "../primitives/invariants";
import {
  type PrimitiveRejection,
  rejectionPromptText,
  rejectionRecord,
} from "../primitives/rejections";
import { applyPrimitiveTurn } from "../primitives/turnBatch";
import * as politicsCommands from "../commands/politics";
import { pushRejectionFact } from "../primitives/PrimitiveEngine";
import {
  type PrimitiveVerb, PRIMITIVE_VERBS } from "../primitives/types";
import { toProviderSchema } from "../llm/providers/GeminiProvider";
import { primitiveTranslationSchema } from "../llm/primitiveTranslation";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
} from "../test-utils/discontentFixtures";

/**
 * Контракты ядра, переработанные Милстоуном 1 по итогам внешнего аудита
 * Милстоуна 0 (`.agent/plans/milestone-1-contracts.md`).
 *
 * Каждый блок закрывает ОДИН пункт аудита и проверяет СВОЙСТВО, а не снимок:
 * идентификаторы регионов и групп берутся из фикстуры, пороги — из констант,
 * тексты — из рендеров, а не из хардкода.
 */

/**
 * Наблюдаемый след СТАРОГО канала.
 *
 * До Милстоуна 1 им были отношения: их двигало действие `diplomacy`. Дипломатия
 * переехала в алфавит примитивов, носителем стало `influence`, а с сессией
 * мягких глаголов — `guarantee`, ЕДИНСТВЕННОЕ оставшееся в старом канале
 * двустороннее действие (влияние теперь покупается помощью, коридором от
 * состояния). Проверяемое свойство от смены носителя не изменилось: оба канала
 * лежат в ОДНОЙ транзакции ответа, и откат обязан уносить след старого канала
 * вместе с примитивами.
 *
 * След читается ОТНОШЕНИЯМИ, а не списком гарантий, и это существенно:
 * повторная гарантия в список ничего не добавляет, а сопутствующий сдвиг
 * отношений накапливается — то есть только он отличает «применилось второй раз»
 * от «применилось один раз», ради чего проверка и существует.
 */
function legacyTraceOf(game: GameState, from: string, to: string): number {
  return game.countries.find(c => c.id === from)!.diplomacy.relations[to] ?? 0;
}

function llmResponse(body: Record<string, unknown>): string {
  return JSON.stringify({ title: "t", descriptions: "d", actions: [], ...body });
}

/**
 * Значения, в которые путь палитры разрешается на реальном состоянии.
 *
 * `[*]` — элементы массива, `{*}` — значения словаря, остальное — поле. Пустой
 * результат означает «в этой партии след пути ещё не материализован», а не
 * «пути не существует»: память воздействий разрежена по построению.
 */
function resolveStatePath(state: unknown, path: string): unknown[] {
  let values: unknown[] = [state];

  for (const segment of path.split(".")) {
    const next: unknown[] = [];
    for (const value of values) {
      if (typeof value !== "object" || value === null) continue;
      if (segment === "{*}") {
        next.push(...Object.values(value as Record<string, unknown>));
        continue;
      }
      const isArray = segment.endsWith("[*]");
      const field = (value as Record<string, unknown>)[isArray ? segment.slice(0, -3) : segment];
      if (field === undefined) continue;
      if (isArray) {
        if (Array.isArray(field)) next.push(...field);
      } else {
        next.push(field);
      }
    }
    values = next;
  }

  return values;
}

/** Действие старого канала с самым дешёвым видимым эффектом. */
function legacyAction(): Record<string, unknown> {
  return {
    type: "guarantee",
    sourceCountryId: "SUN",
    targetCountryId: "USA",
  };
}

// --------------------------------------------------------------------------
// 1. Per-verb discriminated union
// --------------------------------------------------------------------------

describe("контракт примитива: форма по глаголу, а не общий мешок полей", () => {
  it("поле ЧУЖОГО глагола отклоняется схемой, а не игнорируется молча", () => {
    const { primitives, invalid } = parsePrimitives([
      {
        verb: "repress",
        sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL },
        // `incidentKind` принадлежит `spawn_incident`; обработчик `repress` его
        // не читает вовсе — до Милстоуна 1 схема пропускала такую запись.
        params: { intensity: "mild", incidentKind: "uprising" },
      },
    ]);

    expect(primitives).toHaveLength(0);
    expect(invalid[0]!.reason).toMatch(/incidentKind/);
  });

  it("цель чужого глагола отклоняется так же: repress не адресуется стране", () => {
    const { primitives, invalid } = parsePrimitives([
      {
        verb: "repress",
        sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL, countryId: "USA" },
      },
    ]);

    expect(primitives).toHaveLength(0);
    expect(invalid[0]!.reason).toMatch(/countryId/);
  });

  it("примитив, провалившийся на СХЕМЕ, несёт глагол — правило класса стало применимо", () => {
    // До Милстоуна 1 `parsePrimitives` возвращал только индекс и причину,
    // поэтому отличить провалившийся `enact_reform` от провалившегося
    // `repress` было нечем, и «отказ структурного отклоняет весь ответ» на
    // этом слое не выполнялось не по решению, а по отсутствию данных.
    const { invalid } = parsePrimitives([
      { verb: "enact_reform", sourceCountryId: "SUN", target: {} },
    ]);

    expect(invalid[0]!.verb).toBe("enact_reform");
  });

  it("глагол вне алфавита глагола не несёт: выдумывать его нечем", () => {
    const { invalid } = parsePrimitives([
      { verb: "annex_everything", sourceCountryId: "SUN", target: {} },
    ]);

    expect(invalid[0]!.verb).toBeUndefined();
  });

  it("битый структурный отклоняет ВЕСЬ ответ, включая мягкие примитивы", () => {
    const game = createDiscontentTestGame();

    const result = new LLMService(game).processResponse(
      llmResponse({
        primitives: [
          {
            verb: "incite_unrest",
            sourceCountryId: "USA",
            target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
          },
          // Структурный без цели — форма битая, до движка он не доедет.
          { verb: "enact_reform", sourceCountryId: "SUN", target: {} },
        ],
      })
    );

    expect(result.receipt.primitives.applied).toEqual([]);
    expect(game.groupImpactMemory).toEqual([]);
    expect(result.receipt.primitives.rejected.map(r => r.code)).toContain("structuralRollback");
  });

  it("реестр схем покрывает весь алфавит — глагол без формы не существует", () => {
    expect(Object.keys(PRIMITIVE_SCHEMAS).sort()).toEqual([...PRIMITIVE_VERBS].sort());
  });

  it("схема провайдера выводится из той же схемы и различает ветки по `verb`", () => {
    // Второй, «схемы для генерации», не существует: она разъехалась бы с
    // валидацией на первой же правке. Схлопывание одинаковых по форме веток
    // работает и по дискриминанту `verb`, а не только по захардкоженному
    // `type` (`repress` и `grant_autonomy` — одна и та же форма).
    const schema = toProviderSchema(primitiveTranslationSchema);
    const branches = ((schema.properties as Record<string, { items?: Record<string, unknown> }>)
      .primitives!.items as Record<string, unknown>).anyOf as Record<string, unknown>[];

    const verbEnums = branches.map(
      b => ((b.properties as Record<string, { enum?: string[] }>).verb!.enum ?? []) as string[]
    );
    expect(verbEnums.flat().sort()).toEqual([...PRIMITIVE_VERBS].sort());
    // Схлопывание состоялось: веток меньше, чем глаголов.
    expect(branches.length).toBeLessThan(PRIMITIVE_VERBS.length);
  });
});

// --------------------------------------------------------------------------
// 2-3. Квитанция и транзакция всего ответа
// --------------------------------------------------------------------------

describe("транзакция ответа: старый канал и примитивы коммитятся вместе", () => {
  it("отказ структурного откатывает и СТАРЫЙ канал, а не только примитивы", () => {
    const game = createDiscontentTestGame();
    const before = legacyTraceOf(game, "SUN", "USA");

    const result = new LLMService(game).processResponse(
      llmResponse({
        actions: [legacyAction()],
        primitives: [
          // Реформа в ЧУЖОЙ стране: предпосылка движка не выполнена. Источник —
          // не страна игрока, иначе примитив снял бы ГРАНИЦА АГЕНТНОСТИ, а её
          // отказ весь ответ намеренно не откатывает (JSDoc `splitByAgency`).
          {
            verb: "enact_reform",
            sourceCountryId: "USA",
            target: { countryId: "SUN" },
            params: { politicalDirection: "democratic" },
          },
        ],
      })
    );

    // До Милстоуна 1 `applyLlmActions` применялся ПРЯМО в состояние и до
    // примитивов, поэтому сдвиг отношений переживал отказ структурного: мир
    // оставался там, куда его никто не вёл.
    expect(legacyTraceOf(game, "SUN", "USA")).toBe(before);
    expect(result.receipt.primitives.applied).toEqual([]);
  });

  it("нарушенный пост-инвариант откатывает весь ответ целиком", () => {
    const game = createDiscontentTestGame();
    const before = legacyTraceOf(game, "SUN", "USA");

    // Порча, которую ни один примитив не создаёт, но которую обязана поймать
    // ПОСЛЕДНЯЯ фаза: состояние заведомо непригодно ещё до ответа.
    game.primitiveTurnBudget = { ...game.primitiveTurnBudget, softUsed: -100 };

    const result = new LLMService(game).processResponse(
      llmResponse({ actions: [legacyAction()] })
    );

    expect(legacyTraceOf(game, "SUN", "USA")).toBe(before);
    expect(result.narrativeCanonized).toBe(false);
    expect(result.receipt.primitives.rejected.map(r => r.code)).toEqual([
      "postInvariantViolated",
    ]);
    // Откат виден и модели: без этой записи он был бы невидим обоим.
    expect(game.pendingWorldFacts.some(f => f.text.includes("rolled back"))).toBe(true);
  });

  it("квитанция события и квитанция ответа — одно и то же", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      llmResponse({ actions: [legacyAction()] })
    );

    expect(result.narrativeCanonized).toBe(true);
    expect(game.eventHistory.at(-1)!.receipt).toEqual(result.receipt);
    // Квитанция называет и страны, и место — до Милстоуна 1 регионов в ней не было.
    expect(result.receipt.countries).toContain("SUN");
    expect(result.receipt.regions).toEqual([]);
  });

  it("квитанция считает регионы из ПРИМЕНЁННЫХ примитивов", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      llmResponse({
        primitives: [
          {
            verb: "incite_unrest",
            sourceCountryId: "USA",
            target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
          },
        ],
      })
    );

    expect(result.receipt.regions).toContain(TEST_REGION_NATIONAL);
  });
});

// --------------------------------------------------------------------------
// 4. Idempotency на весь ответ
// --------------------------------------------------------------------------

describe("idempotency покрывает ВЕСЬ ответ, а не только примитивы", () => {
  /**
   * Ответ БЕЗ примитивов законен: поле необязательное (`actionSchemas.ts`),
   * месяц без режиссуры — обычное дело. До 2026-07-27 ключ такого ответа не
   * запоминался ВООБЩЕ: его писал только движок примитивов, а его в этом
   * случае не звали. Повтор того же текста (ретрай, двойной клик — запрос
   * идёт без клиентского ключа) применял старый канал второй раз, и отношения
   * шли 20 → 40. Прежний тест этого не видел: его фикстура всегда клала
   * примитивы. Поэтому случаи перечислены явно, а не выбраны одним.
   */
  const repeatedResponses: readonly { readonly name: string; readonly body: Record<string, unknown> }[] = [
    {
      name: "с примитивами",
      body: {
        actions: [legacyAction()],
        primitives: [
          {
            verb: "incite_unrest",
            sourceCountryId: "USA",
            target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
          },
        ],
      },
    },
    { name: "БЕЗ поля primitives вовсе", body: { actions: [legacyAction()] } },
    { name: "с пустым массивом примитивов", body: { actions: [legacyAction()], primitives: [] } },
  ];

  for (const { name, body } of repeatedResponses) {
    it(`повторно поданный ответ (${name}) не двигает отношения второй раз`, () => {
      const game = createDiscontentTestGame();
      const raw = llmResponse(body);

      new LLMService(game).processResponse(raw);
      const afterFirst = legacyTraceOf(game, "SUN", "USA");
      // Первый ответ действительно что-то сделал — иначе «не двинулось второй
      // раз» выполнялось бы по построению.
      expect(afterFirst).not.toBe(0);

      const second = new LLMService(game).processResponse(raw);

      expect(legacyTraceOf(game, "SUN", "USA")).toBe(afterFirst);
      expect(second.receipt.duplicate).toBe(true);
      expect(second.receipt.primitives.rejected.map(r => r.code)).toEqual(["duplicateResponse"]);
    });
  }

  it("ОТКАЧЕННЫЙ ответ тоже запоминается: повтор не пишет диагностику дважды", () => {
    // Ключ движка живёт на клоне и при откате уходит вместе с ним, поэтому
    // повтор откаченного ответа заново писал диагностику, инкрементировал
    // счётчик хода модели и врал признаком дубля в квитанции.
    const game = createDiscontentTestGame();
    const raw = llmResponse({
      primitives: [
        // Реформа в ЧУЖОЙ стране: отказ предпосылки движка откатывает ответ
        // целиком. Источник не игрок — иначе сработала бы граница агентности,
        // которая отката намеренно не вызывает.
        {
          verb: "enact_reform",
          sourceCountryId: "USA",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ],
    });

    const first = new LLMService(game).processResponse(raw);
    expect(first.receipt.primitives.applied).toEqual([]);
    const factsAfterFirst = game.pendingWorldFacts.length;
    const turnAfterFirst = game.llmTurn;
    expect(factsAfterFirst).toBeGreaterThan(0);

    const second = new LLMService(game).processResponse(raw);

    expect(second.receipt.duplicate).toBe(true);
    expect(game.pendingWorldFacts.length).toBe(factsAfterFirst);
    expect(game.llmTurn).toBe(turnAfterFirst);
  });

  it("причина отката уходит в промт ОБЪЯСНЕНИЕМ, а не голым кодом отказа", () => {
    // На пути отката union причины уже смаплен в запись игрока, и до
    // 2026-07-27 в промт подставлялся `record.code`: модель читала
    // «Attempt rejected (enact_reform): reformNotDomestic» — код без правила,
    // то есть ровно то, чего механизм «чтобы не долбилась в невозможное»
    // избегает.
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      llmResponse({
        // Битое действие старого канала: его причина тоже теряется при откате.
        actions: [
          {
            type: "guarantee",
            sourceCountryId: "SUN",
            targetCountryId: "NOWHERE",
          },
        ],
        primitives: [
          {
            verb: "enact_reform",
            sourceCountryId: "USA",
            target: { countryId: "SUN" },
            params: { politicalDirection: "democratic" },
          },
        ],
      })
    );

    const section = new LLMService(game)
      .generatePrompt()
      .prompt.split("## Rejected Attempts Last Cycle")[1]!
      .split("\n## ")[0]!;

    const code = "reformNotDomestic";
    const promptLine = section
      .split("\n")
      .find(line => line.includes("Attempt rejected (enact_reform)"))!;
    // Текст не сводится к коду: он длиннее кода и самого кода не содержит.
    expect(promptLine).not.toContain(code);
    expect(promptLine.length).toBeGreaterThan(`Attempt rejected (enact_reform): ${code}`.length);
    // Отказ СТАРОГО канала на пути отката тоже доезжает.
    expect(section).toContain("Action rejected (guarantee)");
  });

  it("тот же текст в ДРУГОМ месяце — законный ответ, а не дубль", () => {
    const game = createDiscontentTestGame();
    const raw = llmResponse({ actions: [legacyAction()] });

    new LLMService(game).processResponse(raw);
    const afterFirst = legacyTraceOf(game, "SUN", "USA");

    game.currentDate = "1946-02-01";
    const second = new LLMService(game).processResponse(raw);

    expect(second.receipt.duplicate).toBe(false);
    // Проверяется, что старый канал ОТРАБОТАЛ второй раз, а не что его след
    // накопился: `guarantee` идемпотентен по эффекту (повторная гарантия
    // отклоняется как уже существующая), и требовать от него накопления
    // значило бы проверять свойство носителя, а не свойство idempotency-ключа.
    // Ключ отвечает ровно на один вопрос — «этот запрос уже приходил?», — и
    // ответ «нет» виден по тому, что ответ дошёл до канала повторно.
    expect(second.receipt.actions.applied.length + second.receipt.actions.rejected.length)
      .toBe(1);
    expect(legacyTraceOf(game, "SUN", "USA")).toBe(afterFirst);
  });
});

// --------------------------------------------------------------------------
// 5. Структурный код отказа
// --------------------------------------------------------------------------

describe("причина отказа: код игроку, английский текст промту", () => {
  it("игроку не уходит величина ДЕЙСТВИЯ, которого не было, — а промту уходит", () => {
    // Проверяется ГРАНИЦА ДВУХ РЕНДЕРОВ, а не путь состояния к этому отказу:
    // сам отказ по потолку накопления пинится отдельно, тестом кольца соседей
    // (`PrimitiveEngine.test.ts`). Здесь важно ровно одно — какие числа каждый
    // рендер вправе показать.
    const rejection: PrimitiveRejection = {
      code: "impactCeilingReached",
      field: "suppression",
      region: { en: "Šiauliai", ru: "Шяуляй" },
      group: { en: "Lithuanians", ru: "Литовцы" },
      ceiling: 0.45,
      // Магнитуда приказа, который НЕ состоялся.
      wouldTotal: 0.238,
    };

    // Модели нужно число: без него следующая попытка снова наугад.
    expect(rejectionPromptText(rejection)).toContain("0.238");
    // Игроку — нет: величины не существует, примитив не применён
    // (docs/PRIMITIVES.md §1 — «величину считает движок в момент применения»).
    expect(JSON.stringify(rejectionRecord(rejection))).not.toContain("0.238");
    // А правило — можно: потолок хода игрок и так видит в интерфейсе.
    expect(rejectionRecord(rejection).values).toMatchObject({ ceiling: 0.45 });
  });

  it("причина называет цель ИМЕНЕМ, а не сырым идентификатором кода", () => {
    const game = createDiscontentTestGame();
    const groupName = getText(
      game.ethnicGroups.find(g => g.id === TEST_GROUP_TITULAR)!.names,
      LLM_LOCALE
    );

    const result = applyPrimitiveTurn(
      game,
      [
        {
          verb: "repress",
          sourceCountryId: "SUN",
          target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
        },
        {
          verb: "repress",
          sourceCountryId: "SUN",
          target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
        },
      ],
      "target-cap"
    );

    const text = rejectionPromptText(result.rejected[0]!.rejection);
    expect(text).toContain(groupName);
    expect(text).not.toContain(TEST_GROUP_TITULAR);
  });

  it("у каждого кода есть и английский рендер, и запись для игрока", () => {
    // Исчерпывающий `switch` держит это на уровне сборки; тест фиксирует, что
    // ни один код не рендерится в пустоту или в собственное имя.
    const game = createDiscontentTestGame();
    const result = applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
      "one-rejection"
    );

    const rejection = result.rejected[0]!.rejection;
    expect(rejectionPromptText(rejection).length).toBeGreaterThan(rejection.code.length);
    expect(rejectionRecord(rejection).code).toBe(rejection.code);
  });
});

// --------------------------------------------------------------------------
// 6. Обобщённая сверка результата
// --------------------------------------------------------------------------

describe("сверка результата покрывает все числовые каналы алфавита", () => {
  it("палитра и сверка описывают одни и те же каналы", () => {
    // Числовой путь, разрешённый палитрой хоть одному глаголу, обязан иметь
    // ячейку в разложении состояния — иначе палитра разрешает менять то, о чём
    // сверка не спросит.
    //
    // КЛАССИФИКАЦИЯ, А НЕ ФИЛЬТР (переписано 2026-07-27 по независимому ревью).
    // Прежняя версия оставляла от палитры только пути, уже перечисленные в
    // локальной карте, — то есть НОВЫЙ путь, ровно тот случай, ради которого
    // тест и существует, молча отфильтровывался, и тест оставался зелёным.
    // Теперь каждый путь палитры обязан попасть либо в числовой канал, либо в
    // явное исключение с причиной; неклассифицированный валит тест.
    const game = createDiscontentTestGame();
    // Память воздействий разрежена: её ячейки существуют там, где примитив уже
    // оставил след. Засеваем след, а не подставляем ожидание.
    applyPrimitiveTurn(
      game,
      [
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
        // Словарь отношений в фикстуре пуст, как и в поставляемом сценарии 1946
        // (прямой подсчёт 2026-07-27: ноль непустых `relations` у всех 157
        // стран). Ячейка канала `relation:` существует только там, где запись
        // уже материализована, поэтому её тоже засеваем примитивом, а не
        // подставляем ожидание.
        {
          verb: "diplomacy", sourceCountryId: "SUN",
          target: { countryId: "USA" }, params: { direction: "improve" },
        },
        // Словарь ВЛИЯНИЯ разрежен ровно так же, как отношения (в сценарии 1946
        // непустых 47 из 157), поэтому ячейка канала `influence:` тоже
        // засевается примитивом, а не подставляется ожиданием.
        { verb: "send_aid", sourceCountryId: "SUN", target: { countryId: "USA" } },
      ],
      "seed-cells"
    );
    const cellPrefixes = new Set(
      [...enumerateCells(game).keys()].map(key => key.split(":")[0]!)
    );

    // Отображение выводится из ТЕХ ЖЕ констант, по которым `enumerateCells`
    // строит ключи: новое поле памяти или новая ось идеологии попадают сюда
    // сами, а не ждут, пока их впишут руками.
    const numericPathChannel: Record<string, string> = {
      ...Object.fromEntries(
        IMPACT_MEMORY_FIELDS.map(field => [`groupImpactMemory[*].${field}`, "impact"])
      ),
      ...Object.fromEntries(
        IDEOLOGY_AXES.map(axis => [`countries[*].politics.ideologyCoordinates.${axis}`, "ideology"])
      ),
      "countries[*].politics.governmentSupport": "support",
      // Каналы дипломатического блока (Милстоун 1). `relations` — та самая
      // ячейка, ради которой сверка и обобщалась на этот домен: глагол,
      // соврав о величине сдвига отношений, обязан откатываться рантаймом.
      // `legitimacy` и `treasury` появились вместе с `peace`, который платит
      // цену исхода войны штрафом легитимности и репарациями.
      "countries[*].diplomacy.relations.{*}": "relation",
      "countries[*].politics.legitimacy": "legitimacy",
      "countries[*].economy.treasury": "treasury",
      // Каналы мягких воздействий (Милстоун 1). `influence` появилось вместе с
      // `send_aid` — это то самое поле, которое до него двигалось плоским шагом
      // из старого канала мимо всякой сверки. `regions[*].gdp` — с
      // `capital_flight`: удар по производству живёт в регионе, потому что ВВП
      // страны агрегат, который тик перезаписывает. `activePersonnel` — с
      // `support_proxy`, и с ним же раскол государства обязан заявлять деление
      // живой силы метрополии.
      "countries[*].diplomacy.influence.{*}": "influence",
      "regions[*].gdp": "regionGdp",
      "countries[*].military.activePersonnel": "personnel",
    };

    /**
     * Пути вне разложения на ячейки — каждый с причиной, а не общей корзиной.
     *
     * Исключение ключуется ПАРОЙ (глагол, путь), а не одним путём (уточнено
     * Милстоуном 1, сессия жизненного цикла). Разница содержательна:
     * `countries[*].economy.treasury` законно стоит вне сверки у структурного
     * `split_country`, чью правдивость держит проверка СХОДИМОСТИ СУММ, но
     * стоял бы там незаконно у мягкого глагола, который просто двигает казну.
     * Исключение на весь алфавит открыло бы вторую дверь первому же такому
     * глаголу — молча.
     */
    const outsideCellReconciliation = (verb: PrimitiveVerb, path: string): boolean => {
      // Объекты карты сверяются фактом создания («заявленный создан, созданный
      // заявлен»), а не числовыми ячейками.
      if (path.startsWith("mapFeatures[")) return true;
      // Счётчик, а не заявление о мире: его правдивость держит палитра
      // (JSDoc `reconciliation.ts`).
      if (path === "nextFeatureId") return true;
      // Появление и исчезновение элемента массива — заявление о СОСТАВЕ мира, а
      // не величина: содержимое созданного объекта проверяют пост-инварианты.
      if (path.endsWith("[+]") || path.endsWith("[-]")) return true;

      // ЖИЗНЕННЫЙ ЦИКЛ ГОСУДАРСТВ (`CONCEPT.md` §7.1) — правило КЛАССА, а не
      // список глаголов (обобщено Милстоуном 1, сессия структурных глаголов;
      // предсказано в `docs/TODO.md` при первом же глаголе этого класса).
      //
      // Операции, меняющие СОСТАВ стран, заявляют ровно те ячейки, которые
      // соответствуют ДЕЛИМОМУ ИМУЩЕСТВУ (`commands/lifecycle.ts`), и ничего
      // сверх: раскол это имущество делит, объединение складывает, и обе
      // обязаны о своей арифметике отчитаться. Всё остальное, что они двигают
      // (население, ВВП, состав регионов и стран, перенесённые ссылки),
      // остаётся вне поячеечной сверки: её держат сходимость сумм и ноль
      // висячих ссылок — механизмы, которые знают смысл полей, в отличие от
      // плоской карты ячеек.
      //
      // Исключение сформулировано «всё КРОМЕ заявляемых ячеек», а не «весь
      // глагол», намеренно: иначе оно молча покрыло бы и те каналы, которые
      // обязаны сверяться. Их список растёт вместе с разложением состояния —
      // `treasury:` пришла с репарациями `peace`, `personnel:` с
      // `support_proxy`, и каждая обязала жизненный цикл заявлять своё деление.
      const LIFECYCLE_VERBS: PrimitiveVerb[] = [
        "split_country",
        "merge_countries",
        "create_country",
      ];
      const LIFECYCLE_REPORTED_PATHS = [
        "countries[*].economy.treasury",
        "countries[*].military.activePersonnel",
        // Влияние — третья заявляемая ячейка, добавлена Милстоуном 1 по находке
        // на боевых данных 1946: поглощение клиента снимает влияние поглотителя
        // на него как самоссылку, и это такая же дельта, как сложение казны.
        "countries[*].diplomacy.influence.{*}",
      ];
      if (LIFECYCLE_VERBS.includes(verb) && !LIFECYCLE_REPORTED_PATHS.includes(path)) {
        return true;
      }

      // Идентификаторы и флаги — не величины, и сверять их ячейками нечем.
      // Перечислены поимённо, с причиной у каждого, а не общей корзиной
      // «нечисловое»: иначе первое же ЧИСЛОВОЕ поле, случайно похожее на
      // идентификатор, проехало бы мимо сверки молча.
      const NOT_A_MAGNITUDE: Record<string, string> = {
        // Флаг «война идёт» — состояние сущности, а не величина.
        "wars[*].active": "peace гасит войну",
        // Владение и оккупация — ссылки на страну.
        "regions[*].ownerCountryId": "аннексия по мирному договору",
        "regions[*].occupiedBy": "снятие оккупации по мирному договору",
        // Число, но идентификатор региона: «столица переехала» не величина.
        "countries[*].capitalRegionId": "перенос столицы, потерянной по договору",
        // Строковый элемент массива видов санкций.
        "countries[*].diplomacy.sanctions.{*}[*]": "введённый режим санкций",
        // Юридическое положение — перечисление и список ссылок на страны, а не
        // величины. Их правдивость держит пост-инвариант согласованности
        // подчинения (`primitives/subordination.ts`), который знает смысл обоих
        // полей: поячеечная сверка на них сказала бы только «строка изменилась».
        "countries[*].politics.sovereigntyStatus": "puppet меняет юридический статус",
        "countries[*].diplomacy.puppets[*]": "рантайм-половина зависимости — ссылка на страну",
        "countries[*].politics.overlordIds[*]": "перенос сюзерена жизненным циклом",
        "countries[*].politics.overlordIds": "появление списка сюзеренов у суверенной страны",
      };
      if (path in NOT_A_MAGNITUDE) return true;

      // АГРЕГАТЫ, выводимые из регионов, — не заявления глагола, а пересчёт.
      // Их источник истины один (`aggregateCountryFromRegions`), и требовать от
      // примитива заявлять их дельту значило бы завести второе мнение о числе,
      // которое и так вычисляется из состояния. Причина общая для всего
      // алфавита, поэтому и правило общее, а не по глаголу.
      if (path === "countries[*].population" || path === "countries[*].economy.gdp") return true;

      // Состояние КАМПАНИИ — не мир, а партия (`primitives/campaign.ts`).
      // Его вычисляет движок из состава мира, и правило §6 «game over считает
      // движок, а не объявляет текст модели» держится именно тем, что примитив
      // не вправе его ЗАЯВИТЬ — только вызвать вычисление.
      if (path.startsWith("campaign.")) return true;

      return false;
    };

    const paletteEntries = Object.entries(PRIMITIVE_PALETTE) as [PrimitiveVerb, readonly string[]][];
    expect(paletteEntries.length).toBeGreaterThan(0);

    // 1. Классификация полная: путь, которого нет ни в одном канале и ни в
    //    одном исключении, обязан уронить тест — это и есть «канал объявлен
    //    палитрой, но сверке неизвестен».
    expect(
      paletteEntries.flatMap(([verb, paths]) =>
        paths
          .filter(path => !(path in numericPathChannel) && !outsideCellReconciliation(verb, path))
          .map(path => `${verb}: ${path}`)
      )
    ).toEqual([]);

    for (const [path, channel] of Object.entries(numericPathChannel)) {
      // 2. Канал существует в разложении состояния.
      expect(cellPrefixes).toContain(channel);
      // 3. Отображение не фиктивное: путь действительно разрешается в число на
      //    боевой фикстуре, а не назван числовым на словах.
      expect(resolveStatePath(game, path).some(value => typeof value === "number")).toBe(true);
    }
  });

  it("ложь о СДВИГЕ КООРДИНАТ откатывает реформу целиком", () => {
    // Главное, ради чего сверка обобщалась. До Милстоуна 1 рантайм-откат
    // покрывал только память воздействий: обработчик, соврав о сдвиге
    // координат, ловился внешним тестом, но не откатом, — то есть ложь уходила
    // в нарратив, если тест её не ждал.
    const game = createDiscontentTestGame();
    const before = structuredClone(
      game.countries.find(c => c.id === "SUN")!.politics
    );

    const original = politicsCommands.shiftCountryIdeology;
    const spy = vi
      .spyOn(politicsCommands, "shiftCountryIdeology")
      .mockImplementation((...args: Parameters<typeof politicsCommands.shiftCountryIdeology>) => {
        const result = original(...args);
        // Координаты сдвинулись, а отчёт утверждает, что не сдвинулись.
        return result.success ? { ...result, applied: { economic: 0, political: 0 } } : result;
      });

    try {
      const result = applyPrimitiveTurn(
        game,
        [
          {
            verb: "enact_reform",
            sourceCountryId: "SUN",
            target: { countryId: "SUN" },
            params: { politicalDirection: "democratic" },
          },
        ],
        "lying-reform"
      );

      expect(result.applied).toEqual([]);
      expect(result.rejected[0]!.rejection.code).toBe("resultMisreported");
      // Откат целиком: ни координаты, ни списанная цена в мире не остались.
      expect(game.countries.find(c => c.id === "SUN")!.politics).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("координаты идеологии и поддержка попадают в разложение состояния", () => {
    const game = createDiscontentTestGame();
    const keys = [...enumerateCells(game).keys()];

    expect(keys).toContain("ideology:SUN.economic");
    expect(keys).toContain("ideology:SUN.political");
    expect(keys).toContain("support:SUN");
  });
});

describe("палитра выражает ключи словарей и удаление элементов", () => {
  // Оба свойства сегодня не задевают ни один из пяти глаголов — они вводятся
  // под глаголы следующей сессии (`diplomacy`/`sanction`/`war`/`peace` пишут в
  // `Record`-поля дипломатии, `peace` снимает объекты карты при завершении
  // войны). Проверяются поэтому на уровне механизма, а не через боевой глагол.

  it("ключ словаря попадает в путь ДОСЛОВНО — схлопывать его в дифе нельзя", () => {
    const changed = collectChangedPaths(
      { countries: [{ diplomacy: { relations: {} } }] },
      { countries: [{ diplomacy: { relations: { USA: 5 } } }] }
    );
    expect(changed).toEqual(["countries[*].diplomacy.relations.USA"]);
  });

  it("шаблон `{*}` в палитре покрывает любой ключ словаря", () => {
    const entry = "countries[*].diplomacy.relations.{*}";
    expect(pathMatchesPaletteEntry(entry, "countries[*].diplomacy.relations.USA")).toBe(true);
    expect(pathMatchesPaletteEntry(entry, "countries[*].diplomacy.relations.SUN")).toBe(true);
    // Ровно ОДИН сегмент: шаблон не должен превращаться в «что угодно дальше».
    expect(pathMatchesPaletteEntry(entry, "countries[*].diplomacy.relations.USA.extra"))
      .toBe(false);
    // И не покрывает соседнее поле того же уровня.
    expect(pathMatchesPaletteEntry(entry, "countries[*].diplomacy.influence.USA")).toBe(false);
  });

  it("запись палитры без шаблона по-прежнему сравнивается точно", () => {
    const entry = "countries[*].politics.governmentSupport";
    expect(pathMatchesPaletteEntry(entry, entry)).toBe(true);
    expect(pathMatchesPaletteEntry(entry, "countries[*].politics.legitimacy")).toBe(false);
  });

  it("удаление элемента массива отмечается отдельным путём, а не россыпью полей", () => {
    const changed = collectChangedPaths(
      { mapFeatures: [{ id: "a" }, { id: "b" }] },
      { mapFeatures: [{ id: "a" }] }
    );
    // Маркер обязателен: по нему отказ палитры называет удаление удалением.
    expect(changed).toContain("mapFeatures[-]");
  });

  it("ДОБАВЛЕНИЕ элемента маркера не даёт — позиции не сдвигаются", () => {
    // Иначе `spawn_incident`, который только дополняет `mapFeatures`, начал бы
    // требовать объявления удаления, которого не делает.
    const changed = collectChangedPaths(
      { mapFeatures: [{ id: "a" }] },
      { mapFeatures: [{ id: "a" }, { id: "b" }] }
    );
    expect(changed).not.toContain("mapFeatures[-]");
  });

  it("ни один сегодняшний глагол маркера удаления не производит", () => {
    // Свойство, а не снимок: если новый глагол начнёт удалять элементы, он
    // обязан объявить это в палитре — и тест назовёт его первым.
    const game = createDiscontentTestGame();
    const before = structuredClone(game);
    applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } }],
      "no-removal"
    );
    expect(collectChangedPaths(before, game).filter(p => p.endsWith("[-]"))).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 7. Инварианты состояния
// --------------------------------------------------------------------------

describe("инварианты состояния", () => {
  it("боевая фикстура их удовлетворяет — проверка не ложная по построению", () => {
    expect(findStateViolations(createDiscontentTestGame())).toEqual([]);
  });

  it("отрицательный счётчик бюджета хода — нарушение", () => {
    const game = createDiscontentTestGame();
    game.primitiveTurnBudget = { ...game.primitiveTurnBudget, softUsed: -100 };
    expect(findStateViolations(game).join()).toMatch(/softUsed/);
  });

  it("поле памяти воздействий вне 0..1 — нарушение", () => {
    const game = createDiscontentTestGame();
    game.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 5,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });
    expect(findStateViolations(game).join()).toMatch(/suppression is outside/);
  });

  it("память воздействий с висячей ссылкой — нарушение", () => {
    const game = createDiscontentTestGame();
    game.groupImpactMemory.push({
      regionId: 999999,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });
    expect(findStateViolations(game).join()).toMatch(/unknown region/);
  });
});

// --------------------------------------------------------------------------
// 8. Отказы старого канала доезжают до промта со своей квотой
// --------------------------------------------------------------------------

describe("диагностика старого канала `actions`", () => {
  it("отказ действия попадает в секцию отказов следующего промта", () => {
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      llmResponse({
        actions: [
          {
            type: "diplomacy",
            sourceCountryId: "SUN",
            targetCountryId: "NOWHERE",
            data: { relationChange: 5 },
          },
        ],
      })
    );

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.split("## Rejected Attempts Last Cycle")[1]!.split("\n## ")[0]!;
    expect(section).toContain("Action rejected (diplomacy)");
  });

  it("поток отказов действий не вытесняет точную причину отказа примитива", () => {
    const game = createDiscontentTestGame();

    // Отказов действий больше, чем вся квота подробных записей. Пишутся они
    // напрямую той же функцией, что и в бою: кап действий в ОДНОМ ответе
    // (MAX_ACTIONS_PER_RESPONSE) меньше квоты, поэтому переполнить её одним
    // ответом нельзя — а несколькими ходами подряд можно, и именно это
    // состояние здесь и воспроизводится.
    for (let i = 0; i < MAX_PENDING_REJECTION_FACTS_PER_SOURCE * 2; i++) {
      pushRejectionFact(
        game,
        "action_rejected",
        { countryId: "SUN", text: `Action rejected (diplomacy): unknown target ${i}` },
        "director"
      );
    }

    new LLMService(game).processResponse(
      llmResponse({
        primitives: [
          {
            verb: "incite_unrest",
            sourceCountryId: "USA",
            target: { regionId: 999998, groupId: TEST_GROUP_TITULAR },
          },
        ],
      })
    );

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.split("## Rejected Attempts Last Cycle")[1]!.split("\n## ")[0]!;

    // Причина отказа ПРИМИТИВА — подробная, а не вытесненная потоком действий.
    expect(section).toContain("Attempt rejected (incite_unrest)");
    expect(section).toContain("999998");
    // И хвост старого канала назван агрегатом, а не замолчан.
    expect(section).toMatch(/further rejected director attempts are not listed/);
  });
});

// --------------------------------------------------------------------------
// 9. Одноразовые данные в РУЧНОМ цикле
// --------------------------------------------------------------------------

describe("одноразовые данные промта переживают невставленный ответ", () => {
  function gameWithRejection(): GameState {
    const game = createDiscontentTestGame();
    applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
      "seed-rejection"
    );
    return game;
  }

  it("промт выдан, ответ не вставлен — диагностика на месте", () => {
    const game = gameWithRejection();

    const { prompt, consumption } = new LLMService(game).generatePrompt();
    expect(prompt).toContain("Attempt rejected (repress)");
    game.pendingPromptConsumption = consumption;

    // Игрок закрыл вкладку. Второй промт обязан показать тот же отказ.
    expect(new LLMService(game).generatePrompt().prompt).toContain("Attempt rejected (repress)");
  });

  it("ответ вставлен — та же диагностика списана ровно один раз", () => {
    const game = gameWithRejection();

    const service = new LLMService(game);
    const { consumption } = service.generatePrompt();
    game.pendingPromptConsumption = consumption;

    service.processResponse(llmResponse({}));

    expect(new LLMService(game).generatePrompt().prompt).toContain(
      "Nothing was rejected last cycle"
    );
  });

  it("факт, дописанный ПОСЛЕ выдачи промта, не списывается чужим ответом", () => {
    const game = gameWithRejection();

    const service = new LLMService(game);
    const { consumption } = service.generatePrompt();
    game.pendingPromptConsumption = consumption;

    // Приказ игрока, отданный, пока промт лежал у него в буфере обмена.
    applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: "USA", target: { regionId: 999998 } }],
      "order-after-prompt"
    );

    service.processResponse(llmResponse({}));

    const prompt = new LLMService(game).generatePrompt().prompt;
    expect(prompt).toContain("999998");
    expect(prompt).not.toContain(`region ${TEST_REGION_NATIONAL}`);
  });
});
