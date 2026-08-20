import { describe, it, expect } from "vitest";
import { LLMService } from "../LLMService";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  MAX_PROMPT_CRISES,
  MAX_PENDING_REJECTION_FACTS_PER_SOURCE,
  MAX_REJECTION_FACT_LENGTH,
  MAX_PROMPT_REGIONS_PER_COUNTRY,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
} from "@shared/defines/discontent";
import { MAX_EXTRACTION_LEVEL } from "@shared/defines/resources";
import { applyPrimitiveTurn } from "../../primitives/turnBatch";
import { chronicleTick } from "../../simulation/chronicle/ChronicleTick";
import { createTestRegion, responseEvent } from "../../test-utils/fixtures";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_GROUP_LOYAL,
  TEST_REGION_NATIONAL,
} from "../../test-utils/discontentFixtures";

/**
 * Стык примитивов с LLM-путём (сессия B): кризисный кап в промте, контракт
 * примитивов, применение ответа модели, диагностика отказов и граница
 * агентности.
 */

const REGION_POPULATION = 1_000_000;

/** Заведомо отсутствующий регион — приказ по нему отклоняется с внятной причиной. */
const MISSING_REGION = 999998;

/** Диагностические факты об отказах примитивов, накопленные в состоянии. */
function rejectionFacts(game: GameState) {
  return game.pendingWorldFacts.filter(f => f.kind === "primitive_rejected");
}

/**
 * Мир с произвольным числом кризисных регионов. Недовольство разводится по
 * регионам через экономическое отставание (`gdp`), а не через разные группы:
 * так у каждого региона получается СВОЙ индекс, и «острейшие пять» — вопрос
 * вычисления, а не расстановки.
 */
function gameWithCrises(count: number): GameState {
  const regions: Region[] = Array.from({ length: count }, (_, i) =>
    createTestRegion({
      id: 100 + i,
      geoJsonId: `CRISIS-${i}`,
      names: { en: `Crisis region ${i}` },
      ownerCountryId: "SUN",
      population: REGION_POPULATION,
      // Чем меньше ВВП, тем выше вклад экономической обездоленности.
      gdp: 400_000_000 - i * 20_000_000,
      landNeighboringRegionIds: [],
      demographics: [
        { groupId: TEST_GROUP_TITULAR, share: 0.88 },
        { groupId: TEST_GROUP_LOYAL, share: 0.12 },
      ],
    })
  );

  return createDiscontentTestGame({
    regions,
    regionCrisisLatch: regions.map(r => r.id),
  });
}

/** Развёрнутые строки кризисов из готового промта. */
function crisisLines(prompt: string): string[] {
  const section = prompt.split("## Regional Crises")[1]!.split("## Rejected Attempts")[0]!;
  return section.split("\n").filter(line => line.startsWith("- region "));
}

describe("секция кризисов в промте (кризисный кап, docs/CONCEPT.md §7)", () => {
  it("развёрнуто показывает не больше капа, сколько бы регионов ни кипело", () => {
    const game = gameWithCrises(11);
    const prompt = new LLMService(game).generatePrompt().prompt;

    expect(crisisLines(prompt)).toHaveLength(MAX_PROMPT_CRISES);
  });

  it("отбирает по ОСТРОТЕ, а не по порядку регионов", () => {
    const game = gameWithCrises(11);
    // Ожидание вычисляется из состояния той же формулой, что и движок: тест
    // фиксирует инвариант «показаны острейшие», а не конкретный список id,
    // который уехал бы при любой калибровке коэффициентов.
    const expected = [...game.regions]
      .map(r => ({ id: r.id, discontent: regionDiscontent(game, r)! }))
      .sort((a, b) => b.discontent - a.discontent || a.id - b.id)
      .slice(0, MAX_PROMPT_CRISES)
      .map(r => r.id);

    const prompt = new LLMService(game).generatePrompt().prompt;
    const shown = crisisLines(prompt).map(line => Number(line.match(/^- region (\d+)/)![1]));

    expect(shown).toEqual(expected);
  });

  it("хвост не замалчивается: агрегат называет ИСТИННОЕ число оставшихся", () => {
    const game = gameWithCrises(11);
    const prompt = new LLMService(game).generatePrompt().prompt;

    expect(prompt).toContain(`(${11 - MAX_PROMPT_CRISES} more region(s) are above the threshold`);
  });

  it("невлезший кризис всплывает позже сам, когда становится острейшим", () => {
    const game = gameWithCrises(11);
    // Регион, заведомо оставшийся за капом: самый благополучный из кризисных
    // (в `gameWithCrises` ВВП убывает с индексом, поэтому нулевой — богатейший
    // и наименее острый).
    const tail = game.regions[0]!;
    expect(crisisLines(new LLMService(game).generatePrompt().prompt).join()).not.toContain(
      `- region ${tail.id}`
    );

    // Мир меняется: в этом регионе вспыхивает недовольство (память воздействий),
    // и он становится острейшим. Никакой очереди «невыданных фактов» для этого
    // не нужно — секция считает остроту заново.
    game.groupImpactMemory.push({
      regionId: tail.id,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 1,
      concession: 0,
      emboldenment: 1,
    });

    expect(crisisLines(new LLMService(game).generatePrompt().prompt)[0]).toContain(`- region ${tail.id}`);
  });

  it("снятый кризис исчезает из секции — секция не тащит устаревший факт", () => {
    const game = gameWithCrises(3);
    expect(crisisLines(new LLMService(game).generatePrompt().prompt)).toHaveLength(3);

    game.regionCrisisLatch = [];
    const prompt = new LLMService(game).generatePrompt().prompt;
    expect(prompt).toContain("No region is above the crisis threshold");
  });

  it("помечает новые кризисы месяца и потребляет их одноразовые факты", () => {
    const game = gameWithCrises(2);
    const fresh = game.regions[0]!;
    game.pendingWorldFacts.push({
      countryId: "SUN",
      kind: "region_crisis",
      regionId: fresh.id,
      text: "Unrest crisis somewhere",
    });

    const service = new LLMService(game);
    const { prompt, consumption } = service.generatePrompt();
    expect(crisisLines(prompt).find(l => l.startsWith(`- region ${fresh.id}`))).toContain(
      "NEW this month"
    );

    // Факт одноразовый, но списывается он не рендером, а ОТВЕТОМ (Милстоун 1):
    // промт, который никто не увидел, новизну не израсходовал.
    expect(consumption.facts.some(f => f.kind === "region_crisis")).toBe(true);
    expect(game.pendingWorldFacts.some(f => f.kind === "region_crisis")).toBe(true);

    game.pendingPromptConsumption = consumption;
    service.processResponse(JSON.stringify({ title: "t", descriptions: "d", actions: [] }));

    expect(game.pendingWorldFacts.some(f => f.kind === "region_crisis")).toBe(false);
    expect(crisisLines(new LLMService(game).generatePrompt().prompt).join()).not.toContain(
      "NEW this month"
    );
  });

  it("порог в тексте секции — тот же, что у движка", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt().prompt;
    expect(prompt).toContain(REGION_CRISIS_DISCONTENT_THRESHOLD.toFixed(2));
  });
});

describe("контракт примитивов в промте", () => {
  it("перечисляет глаголы, запрещает величины и повторяет реальные пороги движка", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt().prompt;

    expect(prompt).toContain('"primitives"');
    for (const verb of ["incite_unrest", "repress", "grant_autonomy", "enact_reform", "spawn_incident"]) {
      expect(prompt).toContain(verb);
    }
    expect(prompt).toContain("You NEVER set a magnitude");
    // Порог восстания подставлен из константы, а не переписан в текст руками.
    expect(prompt).toContain("0.65");
  });

  it("запрещает модели называть числа последствий примитивов", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt().prompt;
    expect(prompt).toContain("Do NOT put numeric consequences of primitives");
  });
});

describe("применение примитивов из ответа модели", () => {
  function response(primitives: unknown[], extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      title: "t",
      descriptions: "d",
      actions: [],
      primitives,
      ...extra,
    });
  }

  it("валидный примитив применяется и возвращает отклик с фактическими величинами", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      response([
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
          params: { intensity: "severe" },
        },
      ])
    );

    expect(result.success).toBe(true);
    expect(result.receipt.primitives.applied).toHaveLength(1);
    expect(result.receipt.primitives.applied[0]!.verb).toBe("incite_unrest");

    const memory = game.groupImpactMemory.find(
      m => m.regionId === TEST_REGION_NATIONAL && m.groupId === TEST_GROUP_TITULAR
    );
    expect(memory!.emboldenment).toBeGreaterThan(0);
  });

  it("ответ без примитивов остаётся валидным — месяц без режиссуры законен", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      JSON.stringify({ title: "t", descriptions: "d", actions: [] })
    );

    expect(result.success).toBe(true);
    expect(result.receipt.primitives.applied).toEqual([]);
    expect(result.receipt.primitives.rejected).toEqual([]);
  });

  it("числовая величина в params отклоняется схемой, а не молча отбрасывается", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      response([
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
          params: { intensity: "severe", magnitude: 0.9 },
        },
      ])
    );

    expect(result.receipt.primitives.applied).toEqual([]);
    expect(result.receipt.primitives.rejected).toHaveLength(1);
    expect(game.groupImpactMemory).toHaveLength(0);
  });

  it("режиссёр не принимает за игрока решений его же политики (§7.2)", () => {
    const game = createDiscontentTestGame(); // playerCountryId: SUN
    const result = new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );

    expect(result.receipt.primitives.applied).toEqual([]);
    expect(result.receipt.primitives.rejected[0]!.verb).toBe("repress");
    expect(game.groupImpactMemory).toHaveLength(0);
  });

  it("но давление на игрока режиссёру разрешено — иначе кризис некому создать", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      response([
        {
          verb: "spawn_incident",
          sourceCountryId: "SUN",
          target: { regionId: TEST_REGION_NATIONAL },
          params: { incidentKind: "protest" },
        },
      ])
    );

    expect(result.receipt.primitives.rejected).toEqual([]);
    expect(result.receipt.primitives.applied).toHaveLength(1);
    expect(game.mapFeatures.some(f => f.type === "protest")).toBe(true);
  });

  it("повторно поданный тот же ответ не применяет примитивы второй раз", () => {
    const game = createDiscontentTestGame();
    const raw = response([
      {
        verb: "incite_unrest",
        sourceCountryId: "USA",
        target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
        params: { intensity: "severe" },
      },
    ]);

    new LLMService(game).processResponse(raw);
    const afterFirst = game.groupImpactMemory.find(
      m => m.regionId === TEST_REGION_NATIONAL
    )!.emboldenment;

    const second = new LLMService(game).processResponse(raw);

    expect(second.success).toBe(true);
    expect(second.receipt.primitives.applied).toEqual([]);
    expect(
      game.groupImpactMemory.find(m => m.regionId === TEST_REGION_NATIONAL)!.emboldenment
    ).toBe(afterFirst);
  });

  it("отказ уходит диагностикой в СЛЕДУЮЩИЙ промт и потребляется там", () => {
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );

    const service = new LLMService(game);
    const { prompt, consumption } = service.generatePrompt();
    expect(prompt).toContain("## Rejected Attempts Last Cycle");
    expect(prompt).toContain("Attempt rejected (repress)");

    // Одноразовая — но списывается ОТВЕТОМ, а не рендером: пока ответа нет,
    // отказ обязан дожить до следующего промта (Милстоун 1, ручной цикл).
    expect(new LLMService(game).generatePrompt().prompt).toContain("Attempt rejected (repress)");

    game.pendingPromptConsumption = consumption;
    service.processResponse(JSON.stringify({ title: "t", descriptions: "d", actions: [] }));

    // А после ответа — чисто, иначе модель получала бы один и тот же упрёк вечно.
    expect(new LLMService(game).generatePrompt().prompt).toContain("Nothing was rejected last cycle");
  });

  it("сбой провайдера не съедает диагностику: промта никто не увидел", async () => {
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );
    const beforeContext = game.llmContext;

    await expect(
      new LLMService(game).runAutoCycle(() => Promise.reject(new Error("provider is down")))
    ).rejects.toThrow("provider is down");

    // Отказ обязан дожить до следующего промта — он ЕДИНСТВЕННЫЙ способ
    // сказать модели, что предпосылка невыполнима (docs/PRIMITIVES.md §3).
    const prompt = new LLMService(game).generatePrompt().prompt;
    expect(prompt).toContain("Attempt rejected (repress)");
    // И промт, который никто не получил, не остался в состоянии.
    expect(beforeContext).toBe(undefined);
  });

  it("серия отказов не раздувает секцию промта — работает кап, а не удача", () => {
    // 50 отклонённых приказов в одном месяце: ровно замер ревью 2026-07-26,
    // где секция отказов вырастала до 28 144 символов при бюджете
    // docs/CONCEPT.md §7 «PROMPT < ~20k токенов».
    const game = createDiscontentTestGame();
    for (let i = 0; i < 50; i++) {
      applyPrimitiveTurn(
        game,
        [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
        `spam-${i}`
      );
    }

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.split("## Rejected Attempts Last Cycle")[1]!.split("\n## ")[0]!;
    const lines = section.split("\n").filter(line => line.startsWith("- "));

    expect(lines).toHaveLength(MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1);
    expect(section).toContain("further rejected player attempts are not listed");
    // Абсолютная граница, а не только число строк: строку тоже нельзя раздуть
    // содержимым запроса (идентификаторы ограничены схемой).
    expect(section.length).toBeLessThan(3000);
  });

  it("секцию не раздувает ИМЯ нераспознанного ключа — держит кап длины записи", () => {
    // Дыра, названная независимым ревью 2026-07-27 и закрытая 2026-08-09.
    // `MAX_PRIMITIVE_ID_LENGTH` держит длину ЗНАЧЕНИЙ трёх известных полей, но
    // `.strict()` кладёт в причину ИМЯ нераспознанного ключа целиком, а имена
    // ключей в теле запроса не ограничены ничем. Оценка ревью: одиннадцать
    // примитивов с ключом в 5 000 знаков дают секцию ~67 000 знаков против
    // бюджета docs/CONCEPT.md §7 «PROMPT < ~20k токенов».
    const game = createDiscontentTestGame();
    const hugeKey = "x".repeat(5000);

    new LLMService(game).processResponse(
      response(
        Array.from({ length: MAX_PENDING_REJECTION_FACTS_PER_SOURCE }, () => ({
          verb: "repress",
          sourceCountryId: "SUN",
          target: { regionId: TEST_REGION_NATIONAL },
          [hugeKey]: 1,
        }))
      )
    );

    const facts = rejectionFacts(game);
    expect(facts.length).toBeGreaterThan(0);
    const longest = Math.max(...facts.map(f => f.text.length));
    expect(longest, `самая длинная запись при капе ${MAX_REJECTION_FACT_LENGTH}`).toBeLessThanOrEqual(
      MAX_REJECTION_FACT_LENGTH
    );
    // Обрезка помечена — иначе модель прочтёт усечённую причину как полную.
    expect(facts.some(f => f.text.endsWith("… (truncated)"))).toBe(true);

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.split("## Rejected Attempts Last Cycle")[1]!.split("\n## ")[0]!;

    // Граница выведена из капов, а не снята снимком: число записей × длина
    // записи плюс запас на разметку строк и заголовок секции.
    expect(section.length).toBeLessThan(
      (MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1) * (MAX_REJECTION_FACT_LENGTH + 3) + 200
    );
  });

  /**
   * Точная диагностика режиссёра зарезервирована от приказов игрока (внешний
   * аудит 2026-07-26).
   *
   * Дефект: кап подробных записей считался общей кучей, поэтому игрок мог
   * заполнить его заведомо отклоняемыми приказами ДО обработки ответа модели —
   * и точная причина отказа ЕЁ примитива заменялась агрегатной строкой. Модель
   * не узнавала, какой её глагол или предпосылка неверны, то есть повторяла ту
   * же попытку — ровно против чего диагностика и заведена.
   */
  it("приказы игрока не вытесняют точную причину отказа режиссёра", () => {
    const game = createDiscontentTestGame();

    // Игрок забивает свою квоту с запасом — вдвое больше капа.
    for (let i = 0; i < MAX_PENDING_REJECTION_FACTS_PER_SOURCE * 2; i++) {
      applyPrimitiveTurn(
        game,
        [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
        `player-spam-${i}`
      );
    }

    // И только теперь приходит ответ модели с невозможным примитивом.
    new LLMService(game).processResponse(
      response([
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: MISSING_REGION, groupId: TEST_GROUP_TITULAR },
        },
      ])
    );

    // Учёт по источнику — до рендера промта: он факты ПОТРЕБЛЯЕТ.
    const facts = rejectionFacts(game);
    expect(facts.filter(f => f.source === "director")).toHaveLength(1);
    expect(facts.filter(f => (f.source ?? "player") === "player")).toHaveLength(
      MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1
    );

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.split("## Rejected Attempts Last Cycle")[1]!.split("\n## ")[0]!;

    // Причина отказа модели — ПОДРОБНАЯ, с глаголом и предпосылкой, а не
    // «дальше не показываем».
    expect(section).toContain("Attempt rejected (incite_unrest)");
    expect(section).toContain(String(MISSING_REGION));

    // Хвост игрока назван своим агрегатом — и не замалчивается, и не выдаёт
    // себя за диагностику режиссёра.
    expect(section).toContain("further rejected player attempts are not listed");
    expect(section).not.toContain("further rejected director attempts are not listed");

    // Цена разделения названа числом: даже при переполненной квоте игрока
    // секция остаётся в тех же рамках, что и раньше.
    expect(section.length).toBeLessThan(4000);
  });

  it("откат не стирает диагностику, дописанную ПОКА цикл ждал провайдера", async () => {
    // Гонка воспроизводится, а не имитируется вызовом отката: приказ игрока
    // отдаётся ВНУТРИ ожидания провайдера — ровно там, где его отдаёт живой
    // игрок (автоцикл ждёт Gemini секундами, индикатор занятости панели LLM
    // кнопки панели приказов не гасит). Найдено ревью 2026-07-26: откат
    // безусловно писал доцикловый снимок и уничтожал всё, что дописали за это
    // время.
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );
    expect(rejectionFacts(game)).toHaveLength(1);

    let seenWhileWaiting = -1;
    await expect(
      new LLMService(game).runAutoCycle(() => {
        // Промт уже собран. С Милстоуна 1 он диагностику НЕ списывает —
        // списание отложено до ответа, — поэтому факт виден и во время
        // ожидания. Гонка от этого не исчезает: приказ игрока дописывает свой
        // факт ровно здесь.
        seenWhileWaiting = rejectionFacts(game).length;
        applyPrimitiveTurn(
          game,
          [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: MISSING_REGION } }],
          "player-order-while-waiting"
        );
        return Promise.reject(new Error("provider is down"));
      })
    ).rejects.toThrow("provider is down");

    expect(seenWhileWaiting).toBe(1);

    // Оба факта на месте и ровно по одному разу. Раньше это держалось на
    // слиянии снимков; теперь — на том, что отнимать нечего.
    const facts = rejectionFacts(game);
    expect(facts).toHaveLength(2);
    expect(facts.filter(f => f.text.includes("policy decision of"))).toHaveLength(1);
    expect(facts.filter(f => f.text.includes(`Unknown region: ${MISSING_REGION}`))).toHaveLength(1);

    const prompt = new LLMService(game).generatePrompt().prompt;
    expect(prompt).toContain("policy decision of");
    expect(prompt).toContain(`Unknown region: ${MISSING_REGION}`);
  });

  it("откат не отменяет чужой промт и чужие показы развилок", async () => {
    // Та же гонка на остальных одноразовых данных промта: параллельный цикл
    // успел сохранить СВОЙ промт и увеличить счётчики показов, пока наш ждал
    // провайдера. Безусловный откат вернул бы состояние к нашему доцикловому,
    // то есть подменил бы живой промт прошлым и отменил чужие показы.
    const game = createDiscontentTestGame();
    game.hingePointShowCount = { "shown-before": 2 };

    await expect(
      new LLMService(game).runAutoCycle(() => {
        game.llmContext = "промт параллельного цикла";
        // Инкремент, а не присваивание: параллельный рендер делает именно это,
        // и от него не зависит, успел ли наш рендер посчитать ту же развилку.
        game.hingePointShowCount["shown-before"] =
          (game.hingePointShowCount["shown-before"] ?? 0) + 1;
        game.hingePointShowCount["seen-by-the-other-cycle"] = 1;
        return Promise.reject(new Error("provider is down"));
      })
    ).rejects.toThrow("provider is down");

    expect(game.llmContext).toBe("промт параллельного цикла");
    // Наш собственный показ откачен, чужой инкремент сохранён: 2 + 1, а не 4.
    expect(game.hingePointShowCount["shown-before"]).toBe(3);
    expect(game.hingePointShowCount["seen-by-the-other-cycle"]).toBe(1);
  });

  /**
   * Регрессия правки B8 (найдена повторной верификацией внешнего аудита
   * 2026-07-26): восстановление снимка теряло ИСТОЧНИК факта.
   *
   * `restorePromptConsumables` (удалён Милстоуном 1 вместе со всей логикой
   * отката) пересобирал диагностику через `pushRejectionFact` без явного
   * источника. Умолчание —
   * `"player"`, и оно же перезаписывает `source` в самом факте, поэтому факт
   * режиссёра при возврате считался против квоты игрока. Разделение корзин,
   * введённое чтобы точная причина модели не вытеснялась кликами игрока, на
   * этом пути отменялось само.
   *
   * Сценарий воспроизводится целиком, а не через прямой вызов отката: игрок
   * выбирает свою квоту → приходит ТОЧНАЯ причина отказа модели → следующий
   * автоцикл теряет провайдера → откат, задуманный как спасение диагностики,
   * уничтожает ровно её.
   */
  it("сбой провайдера не топит диагностику режиссёра в переполненной корзине игрока", async () => {
    const game = createDiscontentTestGame();

    // 1. Игрок выбирает свою квоту с запасом: 11 подробных + агрегат.
    for (let i = 0; i < MAX_PENDING_REJECTION_FACTS_PER_SOURCE * 2; i++) {
      applyPrimitiveTurn(
        game,
        [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
        `player-spam-${i}`
      );
    }
    expect(rejectionFacts(game)).toHaveLength(MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1);

    // 2. Приходит ответ модели с невозможным примитивом — точная причина ложится
    //    в СВОЮ корзину и обязана дожить до следующего промта.
    new LLMService(game).processResponse(
      response([
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: MISSING_REGION, groupId: TEST_GROUP_TITULAR },
        },
      ])
    );
    expect(rejectionFacts(game).filter(f => f.source === "director")).toHaveLength(1);

    // 3. Следующий автоцикл теряет провайдера: промт собран и до модели не
    //    доехал — значит, ничего не списано, и обе корзины целы.
    await expect(
      new LLMService(game).runAutoCycle(() => Promise.reject(new Error("provider is down")))
    ).rejects.toThrow("provider is down");

    const director = rejectionFacts(game).filter(f => f.source === "director");
    expect(director).toHaveLength(1);
    expect(director[0]!.text).toContain("Attempt rejected (incite_unrest)");
    expect(director[0]!.text).toContain(String(MISSING_REGION));

    // Квота игрока при этом не раздулась.
    expect(rejectionFacts(game).filter(f => (f.source ?? "player") === "player")).toHaveLength(
      MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1
    );

    // И до модели причина реально доезжает — подробной, а не агрегатом.
    const prompt = new LLMService(game).generatePrompt().prompt;
    expect(prompt).toContain("Attempt rejected (incite_unrest)");
    expect(prompt).toContain(String(MISSING_REGION));
  });

  it("сбой ПОСЛЕ ответа модели диагностику не возвращает — она уже доехала", async () => {
    const game = createDiscontentTestGame();
    new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );

    // Модель ответила мусором: промт до неё доехал, отказы она видела. Второй
    // раз показывать их значило бы упрекать за то, что уже сказано.
    const result = await new LLMService(game).runAutoCycle(() => Promise.resolve("not json"));

    expect(result.success).toBe(false);
    expect(new LLMService(game).generatePrompt().prompt).toContain("Nothing was rejected last cycle");
  });
});

/**
 * Область действия правила «отказ структурного отклоняет весь ответ»
 * (docs/PRIMITIVES.md §3–§4, уточнено 2026-07-26 повторной верификацией внешнего
 * аудита).
 *
 * Аудит показал, что на главном пути правило не выполнялось: `splitByAgency`
 * снимает запрещённый структурный ДО движка, и мягкие уходят туда отдельным
 * батчем. Решено оставить поведение и привести правило к нему — отказ по
 * АВТОРУ («это не твоё решение») не то же, что отказ по ПРЕДПОСЫЛКЕ («так не
 * бывает»): первый и задуман как «давление применилось, ответ выбирает игрок».
 *
 * Тесты пинят обе половины решения: разное обращение с двумя видами отказа И
 * отсутствие обхода — единственное, ради чего разницу вообще можно было бы
 * использовать.
 */
describe("граница агентности против правила «структурный отказ отклоняет весь ответ»", () => {
  /** Мягкий примитив режиссёра, заведомо применимый: давление извне на игрока. */
  const SOFT_PRESSURE = {
    verb: "incite_unrest",
    sourceCountryId: "USA",
    target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    params: { intensity: "severe" },
  };

  function directorResponse(primitives: unknown[], title = "t"): string {
    return JSON.stringify({ title, descriptions: "d", actions: [], primitives });
  }

  function emboldenment(game: GameState): number {
    return (
      game.groupImpactMemory.find(
        m => m.regionId === TEST_REGION_NATIONAL && m.groupId === TEST_GROUP_TITULAR
      )?.emboldenment ?? 0
    );
  }

  it("структурный, снятый ГРАНИЦЕЙ АГЕНТНОСТИ, уносит только себя — мягкое давление применяется", () => {
    const game = createDiscontentTestGame(); // playerCountryId: SUN
    const result = new LLMService(game).processResponse(
      directorResponse([
        SOFT_PRESSURE,
        {
          // Реформа за страну ИГРОКА — решение, которое режиссёр принимать не вправе.
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ])
    );

    expect(result.receipt.primitives.applied.map(o => o.verb)).toEqual(["incite_unrest"]);
    expect(emboldenment(game)).toBeGreaterThan(0);
    expect(result.receipt.primitives.rejected.map(r => r.verb)).toEqual(["enact_reform"]);
    expect(result.receipt.primitives.rejected[0]!.code).toBe("agencyPlayerDecision");
  });

  it("а предложение доходит до игрока: событие есть, и отказ лежит в нём машиночитаемо", () => {
    // Вторая причина решения (docs/PRIMITIVES.md §4): откат батча оставил бы
    // ответ без единого применённого примитива, событие бы не создалось, и текст,
    // которым режиссёр ПРЕДЛАГАЕТ игроку уступку, до игрока не дошёл бы вовсе.
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      directorResponse([
        SOFT_PRESSURE,
        {
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ])
    );

    expect(result.narrativeCanonized).toBe(true);
    expect(game.eventHistory).toHaveLength(1);

    const event = game.eventHistory[0]!;
    expect(responseEvent(event).receipt.primitives.rejected?.map(r => r.verb)).toEqual(["enact_reform"]);
    expect(responseEvent(event).receipt.primitives.applied?.map(o => o.verb)).toEqual(["incite_unrest"]);
  });

  it("но отказ ДВИЖКА по структурному по-прежнему откатывает весь ответ", () => {
    const game = createDiscontentTestGame();
    const result = new LLMService(game).processResponse(
      directorResponse([
        SOFT_PRESSURE,
        {
          // Чужая страна — границу агентности проходит, до движка доезжает и
          // падает на предпосылке (страны нет).
          verb: "enact_reform",
          sourceCountryId: "XXX",
          target: { countryId: "XXX" },
          params: { politicalDirection: "democratic" },
        },
      ])
    );

    expect(result.receipt.primitives.applied).toEqual([]);
    expect(emboldenment(game)).toBe(0);
    expect(result.narrativeCanonized).toBe(false);
    expect(game.eventHistory).toHaveLength(0);
  });

  it("обхода нет: запрещённый структурный ничего не ДОБАВЛЯЕТ к тому же ответу без него", () => {
    // Третья причина решения: фильтр умеет только УДАЛЯТЬ. Если добавление
    // запрещённого структурного открывает хоть одно новое состояние мира,
    // решение неверно. Сравниваются полные снимки двух миров.
    const withForbidden = createDiscontentTestGame();
    new LLMService(withForbidden).processResponse(
      directorResponse([
        SOFT_PRESSURE,
        {
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ])
    );

    const withoutIt = createDiscontentTestGame();
    new LLMService(withoutIt).processResponse(directorResponse([SOFT_PRESSURE]));

    // Поля, заведомо различные не по смыслу правила: ключи батчей выводятся из
    // ТЕКСТА ответа, а диагностика отказов у второго мира просто отсутствует.
    //
    // `factuality` — из той же корзины (2026-07-27): ответ с запрещённым
    // структурным честно помечен `partial`, ответ без него — `confirmed`. Это
    // не состояние мира, которое модель получила бы в обмен на запрещённый
    // примитив, а аттестация её собственного текста, и разница направлена
    // ПРОТИВ неё: помеченный заголовок в летопись уже не попадёт.
    const comparable = (game: GameState) => ({
      ...game,
      primitiveBatchKeys: [],
      primitiveNoopBatchKeys: [],
      pendingWorldFacts: [],
      llmResponse: "",
      eventHistory: game.eventHistory.map(e =>
        e.kind === "response"
          ? {
              ...e,
              receipt: {
                ...e.receipt,
                factuality: "confirmed" as const,
                primitives: { ...e.receipt.primitives, rejected: [] },
              },
            }
          : e
      ),
    });

    expect(comparable(withForbidden)).toEqual(comparable(withoutIt));
  });
});

/**
 * Летопись строится по ФАКТУ, а не по заголовку (решение пользователя
 * 2026-07-27 по итогам внешнего аудита).
 *
 * Прежняя версия этого блока пинила ровно обратное — «сырой заголовок доходит
 * до летописи дословно» — и была написана с условием: правка, которая начнёт
 * сверять текст с фактом, обязана переписать и тест, и документ. Правка
 * пришла, поэтому переписаны оба.
 *
 * Граница цены при этом НЕ закрыта и осталась названной: сам текст события
 * по-прежнему не переписывается по фактам, он лишь помечен и не допущен в
 * долгую память кампании. Полная правдивость текста — второй вызов модели,
 * Милстоун 1.
 */
describe("правдивость летописи: в долгую память идёт применённое, а не заявленное", () => {
  it("частично применённый ответ не доносит до летописи свой заголовок — только факт", () => {
    const game = createDiscontentTestGame();
    game.currentDate = "1946-02-01";

    const result = new LLMService(game).processResponse(
      JSON.stringify({
        // Заголовок описывает ровно ту половину, которую движок отклонит.
        title: "Москва пошла на уступки и провела реформу",
        descriptions: "d",
        actions: [],
        primitives: [
          {
            verb: "incite_unrest",
            sourceCountryId: "USA",
            target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
            params: { intensity: "severe" },
          },
          {
            verb: "enact_reform",
            sourceCountryId: "SUN",
            target: { countryId: "SUN" },
            params: { politicalDirection: "democratic" },
          },
        ],
      })
    );

    // Применилось частично — событие законно, помечено, и рядом с текстом
    // лежит факт.
    expect(result.narrativeCanonized).toBe(true);
    expect(result.receipt.factuality).toBe("partial");
    expect(responseEvent(game.eventHistory[0]).receipt.factuality).toBe("partial");
    expect(responseEvent(game.eventHistory[0]).receipt.primitives.rejected).toHaveLength(1);

    // В ЛЕНТЕ событие остаётся целиком, вместе со своим заголовком: игрок
    // читает заявление режиссёра, а не пустоту.
    expect(game.eventHistory[0]!.title).toBe("Москва пошла на уступки и провела реформу");

    game.currentDate = "1947-01-01";
    chronicleTick(game);

    // А в летопись — только то, что легло в мир. Реформы, которой не было, в
    // многолетней памяти кампании нет ни словом.
    expect(game.chronicle[0]!.summary).not.toContain("реформу");
    expect(game.chronicle[0]!.summary).toBe("applied: incite_unrest in National region 187");
  });

  it("а полностью неприменённый ответ до летописи не доходит — единственная гарантия, которую даёт код", () => {
    const game = createDiscontentTestGame();
    game.currentDate = "1946-02-01";

    new LLMService(game).processResponse(
      JSON.stringify({
        title: "Восстание подавлено",
        descriptions: "d",
        actions: [],
        primitives: [
          { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
        ],
      })
    );

    game.currentDate = "1947-01-01";
    chronicleTick(game);

    expect(game.chronicle).toEqual([]);
  });
});

/**
 * Секция «Regions You Can Address» и её связь со списком стран.
 *
 * Найдено замером 2026-08-02 (`.agent/runs/director-prompt-domains-2026-08-02`,
 * 72 хода): региональные глаголы не применялись почти никогда — `incite_unrest`
 * ни разу, затронуто 2–3 региона за два года. Причина оказалась не в модели:
 * промт разворачивал кризис в стране, которой нет в `## Country IDs`, а
 * «Narrative requirements» запрещают о такой стране и говорить, и действовать.
 * Плюс ни одного id региона за пределами кризисной пятёрки промт не давал вовсе.
 */
describe("регионы как адресуемые цели в промте", () => {
  /** Кризис в стране, которая НЕ мажор и НЕ в ротации, — только через кризис. */
  function gameWithForeignCrisis(): GameState {
    const foreignRegion = createTestRegion({
      id: 700,
      geoJsonId: "FOREIGN-1",
      names: { en: "Foreign crisis region" },
      ownerCountryId: "MWI",
      population: REGION_POPULATION,
      gdp: 100_000_000,
      landNeighboringRegionIds: [],
      demographics: [
        { groupId: TEST_GROUP_TITULAR, share: 0.9 },
        { groupId: TEST_GROUP_LOYAL, share: 0.1 },
      ],
    });
    const game = createDiscontentTestGame({ regionCrisisLatch: [foreignRegion.id] });
    game.regions.push(foreignRegion);
    game.countries.push({
      ...game.countries[1]!,
      id: "MWI",
      name: { en: "Malawi" },
      tier: "minor",
    });
    // Ротация обязана быть ЗАБИТА чужими странами, иначе MWI попадёт в промт
    // как spotlight и тест пройдёт мимо проверяемого свойства (поймано
    // негативным контролем: без этого он проходил и со снятой правкой). Пул
    // ротации сортируется по id, поэтому имена подобраны алфавитно раньше MWI.
    for (const id of ["AAA", "AAB", "AAC", "AAD", "AAE"]) {
      game.countries.push({ ...game.countries[1]!, id, name: { en: id }, tier: "minor" });
    }
    return game;
  }

  it("страна показанного кризиса попадает в ## Country IDs — иначе промт запрещает то, что показывает", () => {
    const game = gameWithForeignCrisis();
    const prompt = new LLMService(game).generatePrompt().prompt;

    const idsSection = prompt.slice(
      prompt.indexOf("## Country IDs"),
      prompt.indexOf("## Instructions")
    );
    const crisisSection = prompt.slice(
      prompt.indexOf("## Regional Crises"),
      prompt.indexOf("## Regions You Can Address")
    );

    // Сначала убеждаемся, что кризис ДЕЙСТВИТЕЛЬНО показан: тест, где кризиса
    // нет, прошёл бы по пустому месту и ничего не доказывал.
    expect(crisisSection).toContain("held by MWI");
    expect(idsSection).toContain("MWI");
  });

  it("даёт id регионов страны игрока, а не только кризисную пятёрку мира", () => {
    const game = createDiscontentTestGame();
    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.slice(
      prompt.indexOf("## Regions You Can Address"),
      prompt.indexOf("## Rejected Attempts")
    );

    const playerRegions = game.regions.filter(r => r.ownerCountryId === game.playerCountryId);
    expect(playerRegions.length).toBeGreaterThan(0);
    for (const region of playerRegions) {
      expect(section).toContain(`- ${region.id} `);
    }
  });

  it("показывает месторождения и уровень добычи — предпосылку build_extraction", () => {
    // Замер 2026-08-08: перечисления ресурсов оказалось мало. Модель стала
    // называть ресурс верно (попыток 1 → 7 за 72 хода), но все они ушли в
    // отказы `extractionAtMaximum` и `noDepositInRegion` — предпосылку она не
    // видела. Строка обязана нести И залежь, И то, сколько уже построено:
    // «есть уголь» без уровня снова отправляет модель в потолок.
    const game = createDiscontentTestGame();
    const region = game.regions.find(r => r.ownerCountryId === game.playerCountryId)!;
    region.deposits = { coal: 0.7, oil: 0.2 };
    region.extraction = { coal: MAX_EXTRACTION_LEVEL, oil: 3 };

    const prompt = new LLMService(game).generatePrompt().prompt;
    const line = prompt
      .slice(prompt.indexOf("## Regions You Can Address"), prompt.indexOf("## Rejected Attempts"))
      .split(/\r?\n/)
      .find(l => l.includes(`- ${region.id} `))!;

    // Расширяемое названо, исчерпанное — нет: строка отвечает на вопрос «где
    // ещё можно строить», а не пересказывает геологию. Замер 2026-08-08:
    // полный список залежей стоил +10,6% промта на каждом ходу ради сообщения,
    // которое в стартовом мире всюду одинаково («10/10»).
    expect(line).toContain(`oil 3/${MAX_EXTRACTION_LEVEL}`);
    expect(line).not.toContain("coal");
  });

  it("регион без места для расширения не получает строки вовсе", () => {
    const game = createDiscontentTestGame();
    const region = game.regions.find(r => r.ownerCountryId === game.playerCountryId)!;
    // Именно стартовый случай мира 1946: залежь есть, но мощности на потолке.
    region.deposits = { coal: 0.7 };
    region.extraction = { coal: MAX_EXTRACTION_LEVEL };

    const prompt = new LLMService(game).generatePrompt().prompt;
    const line = prompt
      .slice(prompt.indexOf("## Regions You Can Address"), prompt.indexOf("## Rejected Attempts"))
      .split(/\r?\n/)
      .find(l => l.includes(`- ${region.id} `))!;

    expect(line).not.toContain("can expand");
  });

  it("режет список регионов страны капом и честно называет остаток", () => {
    const many = Array.from({ length: MAX_PROMPT_REGIONS_PER_COUNTRY + 3 }, (_, i) =>
      createTestRegion({
        id: 800 + i,
        geoJsonId: `MANY-${i}`,
        names: { en: `Region ${i}` },
        ownerCountryId: "SUN",
        population: REGION_POPULATION,
        gdp: 400_000_000 - i * 10_000_000,
        landNeighboringRegionIds: [],
        demographics: [{ groupId: TEST_GROUP_TITULAR, share: 1 }],
      })
    );
    const game = createDiscontentTestGame();
    game.regions.push(...many);

    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.slice(
      prompt.indexOf("## Regions You Can Address"),
      prompt.indexOf("## Rejected Attempts")
    );
    const listed = section.split("\n").filter(l => /^ {2}- \d+ /.test(l)).length;

    expect(listed).toBeLessThanOrEqual(MAX_PROMPT_REGIONS_PER_COUNTRY);
    expect(section).toMatch(/\(\d+ more region\(s\)/);
  });

  it("сортирует регионы страны по недовольству — цель выбирается по нему, а не по id", () => {
    const game = createDiscontentTestGame();
    const prompt = new LLMService(game).generatePrompt().prompt;
    const section = prompt.slice(
      prompt.indexOf("## Regions You Can Address"),
      prompt.indexOf("## Rejected Attempts")
    );
    const values = [...section.matchAll(/discontent (\d+\.\d+)/g)].map(m => Number(m[1]));

    expect(values.length).toBeGreaterThan(1);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });
});
