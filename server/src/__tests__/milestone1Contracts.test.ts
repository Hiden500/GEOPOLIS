import { describe, it, expect, vi } from "vitest";
import { type GameState } from "@shared/types/GameState";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { MAX_PENDING_REJECTION_FACTS_PER_SOURCE } from "@shared/defines/discontent";
import { LLMService } from "../services/LLMService";
import { parsePrimitives, PRIMITIVE_SCHEMAS } from "../primitives/primitiveSchemas";
import { PRIMITIVE_PALETTE } from "../primitives/palette";
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
import { PRIMITIVE_VERBS } from "../primitives/types";
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

function relation(game: GameState, from: string, to: string): number {
  return game.countries.find(c => c.id === from)!.diplomacy.relations[to] ?? 0;
}

function llmResponse(body: Record<string, unknown>): string {
  return JSON.stringify({ title: "t", descriptions: "d", actions: [], ...body });
}

/** Ответ, двигающий отношения старым каналом, — самый дешёвый видимый эффект. */
function relationAction(change: number): Record<string, unknown> {
  return {
    type: "diplomacy",
    sourceCountryId: "SUN",
    targetCountryId: "USA",
    data: { relationChange: change },
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
    const before = relation(game, "SUN", "USA");

    const result = new LLMService(game).processResponse(
      llmResponse({
        actions: [relationAction(20)],
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
    expect(relation(game, "SUN", "USA")).toBe(before);
    expect(result.receipt.primitives.applied).toEqual([]);
  });

  it("нарушенный пост-инвариант откатывает весь ответ целиком", () => {
    const game = createDiscontentTestGame();
    const before = relation(game, "SUN", "USA");

    // Порча, которую ни один примитив не создаёт, но которую обязана поймать
    // ПОСЛЕДНЯЯ фаза: состояние заведомо непригодно ещё до ответа.
    game.primitiveTurnBudget = { ...game.primitiveTurnBudget, softUsed: -100 };

    const result = new LLMService(game).processResponse(
      llmResponse({ actions: [relationAction(20)] })
    );

    expect(relation(game, "SUN", "USA")).toBe(before);
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
      llmResponse({ actions: [relationAction(20)] })
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
  it("повторно поданный ответ не двигает отношения второй раз", () => {
    const game = createDiscontentTestGame();
    const raw = llmResponse({
      actions: [relationAction(20)],
      primitives: [
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
        },
      ],
    });

    new LLMService(game).processResponse(raw);
    const afterFirst = relation(game, "SUN", "USA");

    const second = new LLMService(game).processResponse(raw);

    // Раньше ключ прикрывал только массив `primitives`, и старый канал
    // отрабатывал второй раз — молча.
    expect(relation(game, "SUN", "USA")).toBe(afterFirst);
    expect(second.receipt.duplicate).toBe(true);
    expect(second.receipt.primitives.rejected.map(r => r.code)).toEqual(["duplicateResponse"]);
  });

  it("тот же текст в ДРУГОМ месяце — законный ответ, а не дубль", () => {
    const game = createDiscontentTestGame();
    const raw = llmResponse({ actions: [relationAction(5)] });

    new LLMService(game).processResponse(raw);
    const afterFirst = relation(game, "SUN", "USA");

    game.currentDate = "1946-02-01";
    const second = new LLMService(game).processResponse(raw);

    expect(second.receipt.duplicate).toBe(false);
    expect(relation(game, "SUN", "USA")).not.toBe(afterFirst);
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
    const game = createDiscontentTestGame();
    // Память воздействий разрежена: её ячейки существуют там, где примитив уже
    // оставил след. Засеваем след, а не подставляем ожидание.
    applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } }],
      "seed-cells"
    );
    const cellPrefixes = new Set(
      [...enumerateCells(game).keys()].map(key => key.split(":")[0]!)
    );

    const pathToChannel: Record<string, string> = {
      "groupImpactMemory[*].suppression": "impact",
      "groupImpactMemory[*].alienation": "impact",
      "groupImpactMemory[*].concession": "impact",
      "groupImpactMemory[*].emboldenment": "impact",
      "countries[*].politics.ideologyCoordinates.economic": "ideology",
      "countries[*].politics.ideologyCoordinates.political": "ideology",
      "countries[*].politics.governmentSupport": "support",
    };

    const numericPaths = Object.values(PRIMITIVE_PALETTE)
      .flat()
      .filter(path => path in pathToChannel);
    expect(numericPaths.length).toBeGreaterThan(0);
    for (const path of numericPaths) {
      expect(cellPrefixes).toContain(pathToChannel[path]!);
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
