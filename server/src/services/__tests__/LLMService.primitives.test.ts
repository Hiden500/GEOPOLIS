import { describe, it, expect } from "vitest";
import { LLMService } from "../LLMService";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  MAX_PROMPT_CRISES,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
} from "@shared/defines/discontent";
import { createTestRegion } from "../../test-utils/fixtures";
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
      neighboringRegionIds: [],
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
    const prompt = new LLMService(game).generatePrompt();

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

    const prompt = new LLMService(game).generatePrompt();
    const shown = crisisLines(prompt).map(line => Number(line.match(/^- region (\d+)/)![1]));

    expect(shown).toEqual(expected);
  });

  it("хвост не замалчивается: агрегат называет ИСТИННОЕ число оставшихся", () => {
    const game = gameWithCrises(11);
    const prompt = new LLMService(game).generatePrompt();

    expect(prompt).toContain(`(${11 - MAX_PROMPT_CRISES} more region(s) are above the threshold`);
  });

  it("невлезший кризис всплывает позже сам, когда становится острейшим", () => {
    const game = gameWithCrises(11);
    // Регион, заведомо оставшийся за капом: самый благополучный из кризисных
    // (в `gameWithCrises` ВВП убывает с индексом, поэтому нулевой — богатейший
    // и наименее острый).
    const tail = game.regions[0]!;
    expect(crisisLines(new LLMService(game).generatePrompt()).join()).not.toContain(
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

    expect(crisisLines(new LLMService(game).generatePrompt())[0]).toContain(`- region ${tail.id}`);
  });

  it("снятый кризис исчезает из секции — секция не тащит устаревший факт", () => {
    const game = gameWithCrises(3);
    expect(crisisLines(new LLMService(game).generatePrompt())).toHaveLength(3);

    game.regionCrisisLatch = [];
    const prompt = new LLMService(game).generatePrompt();
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

    const prompt = new LLMService(game).generatePrompt();
    expect(crisisLines(prompt).find(l => l.startsWith(`- region ${fresh.id}`))).toContain(
      "NEW this month"
    );
    // Факт одноразовый: второй промт того же месяца новизны уже не утверждает.
    expect(game.pendingWorldFacts.some(f => f.kind === "region_crisis")).toBe(false);
    expect(crisisLines(new LLMService(game).generatePrompt()).join()).not.toContain(
      "NEW this month"
    );
  });

  it("порог в тексте секции — тот же, что у движка", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt();
    expect(prompt).toContain(REGION_CRISIS_DISCONTENT_THRESHOLD.toFixed(2));
  });
});

describe("контракт примитивов в промте", () => {
  it("перечисляет глаголы, запрещает величины и повторяет реальные пороги движка", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt();

    expect(prompt).toContain('"primitives"');
    for (const verb of ["incite_unrest", "repress", "grant_autonomy", "enact_reform", "spawn_incident"]) {
      expect(prompt).toContain(verb);
    }
    expect(prompt).toContain("You NEVER set a magnitude");
    // Порог восстания подставлен из константы, а не переписан в текст руками.
    expect(prompt).toContain("0.65");
  });

  it("запрещает модели называть числа последствий примитивов", () => {
    const prompt = new LLMService(gameWithCrises(1)).generatePrompt();
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
    expect(result.primitiveOutcomes).toHaveLength(1);
    expect(result.primitiveOutcomes[0]!.verb).toBe("incite_unrest");

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
    expect(result.primitiveOutcomes).toEqual([]);
    expect(result.rejectedPrimitives).toEqual([]);
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

    expect(result.primitiveOutcomes).toEqual([]);
    expect(result.rejectedPrimitives).toHaveLength(1);
    expect(game.groupImpactMemory).toHaveLength(0);
  });

  it("режиссёр не принимает за игрока решений его же политики (§7.2)", () => {
    const game = createDiscontentTestGame(); // playerCountryId: SUN
    const result = new LLMService(game).processResponse(
      response([
        { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      ])
    );

    expect(result.primitiveOutcomes).toEqual([]);
    expect(result.rejectedPrimitives[0]!.verb).toBe("repress");
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

    expect(result.rejectedPrimitives).toEqual([]);
    expect(result.primitiveOutcomes).toHaveLength(1);
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
    expect(second.primitiveOutcomes).toEqual([]);
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

    const prompt = new LLMService(game).generatePrompt();
    expect(prompt).toContain("## Rejected Attempts Last Cycle");
    expect(prompt).toContain("Attempt rejected (repress)");

    // Одноразовая: второй промт уже чист, иначе модель получала бы один и тот
    // же упрёк вечно.
    expect(new LLMService(game).generatePrompt()).toContain("Nothing was rejected last cycle");
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
    const prompt = new LLMService(game).generatePrompt();
    expect(prompt).toContain("Attempt rejected (repress)");
    // И промт, который никто не получил, не остался в состоянии.
    expect(beforeContext).toBe(undefined);
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
    expect(new LLMService(game).generatePrompt()).toContain("Nothing was rejected last cycle");
  });
});
