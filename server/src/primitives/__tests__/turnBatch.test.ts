import { describe, it, expect } from "vitest";
import { applyPrimitiveTurn, isDuplicatePrimitiveBatch } from "../turnBatch";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { type Primitive } from "../types";
import { type GameState } from "@shared/types/GameState";
import { getText } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveOutcomeLine } from "@shared/types/politics/PrimitiveOutcome";
import {
  MAX_PRIMITIVE_BATCH_KEYS,
  PLACE_HISTORY_MAX_ENTRIES,
} from "@shared/defines/discontent";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_GROUP_LOYAL,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
} from "../../test-utils/discontentFixtures";

/**
 * Граница хода примитивов (docs/CONCEPT.md §7.2, docs/PRIMITIVES.md §4):
 * idempotency, локализуемый отклик из фактических величин, история места.
 */

function game(): GameState {
  return createDiscontentTestGame();
}

const repressRegion: Primitive = {
  verb: "repress",
  sourceCountryId: "SUN",
  target: { regionId: TEST_REGION_NATIONAL },
  params: { intensity: "severe" },
};

const grantAutonomy: Primitive = {
  verb: "grant_autonomy",
  sourceCountryId: "SUN",
  target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
  params: { intensity: "severe" },
};

/** Полный снимок мира — сравнение состояний целиком, а не выборочных полей. */
function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function memoryOf(state: GameState, regionId: number, groupId: string) {
  return state.groupImpactMemory.find(m => m.regionId === regionId && m.groupId === groupId);
}

describe("applyPrimitiveTurn — idempotency на ход (docs/CONCEPT.md §7.2)", () => {
  it("повторный батч с тем же ключом не меняет мир ВООБЩЕ", () => {
    const state = game();

    const first = applyPrimitiveTurn(state, [repressRegion], "turn-1");
    expect(first.duplicate).toBe(false);
    expect(first.applied).toHaveLength(1);

    // Снимок берётся ПОСЛЕ первого применения: инвариант не «ничего не
    // произошло», а «второй вызов ничего не добавил».
    const afterFirst = snapshot(state);
    const second = applyPrimitiveTurn(state, [repressRegion], "turn-1");

    expect(second.duplicate).toBe(true);
    expect(second.applied).toEqual([]);
    expect(snapshot(state)).toBe(afterFirst);
  });

  it("без ключа-дубля тот же батч применяется снова — защита ключевая, а не глухая", () => {
    const state = game();

    applyPrimitiveTurn(state, [repressRegion], "turn-1");
    const suppressionAfterFirst = memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!
      .suppression;

    const second = applyPrimitiveTurn(state, [repressRegion], "turn-2");

    expect(second.duplicate).toBe(false);
    expect(second.applied).toHaveLength(1);
    expect(
      memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression
    ).toBeGreaterThan(suppressionAfterFirst);
  });

  it("цена отсутствия защиты названа числом: два прямых вызова движка складываются", () => {
    // Тест фиксирует, ЧТО именно предотвращает ключ, — иначе «дубль не
    // применился» доказывает лишь то, что функция что-то вернула.
    const guarded = game();
    applyPrimitiveTurn(guarded, [repressRegion], "same-key");
    applyPrimitiveTurn(guarded, [repressRegion], "same-key");

    const unguarded = game();
    applyPrimitiveBatch(unguarded, [repressRegion]);
    applyPrimitiveBatch(unguarded, [repressRegion]);

    const guardedSuppression = memoryOf(guarded, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!
      .suppression;
    const unguardedSuppression = memoryOf(unguarded, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!
      .suppression;

    expect(unguardedSuppression).toBeGreaterThan(guardedSuppression);
  });

  it("ключ пишется даже когда весь батч отклонён — повтор не плодит диагностику", () => {
    const state = game();
    const impossible: Primitive = {
      verb: "repress",
      sourceCountryId: "USA",
      target: { regionId: TEST_REGION_NATIONAL },
    };

    const first = applyPrimitiveTurn(state, [impossible], "rejected-batch");
    expect(first.applied).toEqual([]);
    expect(first.rejected).toHaveLength(1);
    const factsAfterFirst = state.pendingWorldFacts.length;

    const second = applyPrimitiveTurn(state, [impossible], "rejected-batch");
    expect(second.duplicate).toBe(true);
    expect(state.pendingWorldFacts).toHaveLength(factsAfterFirst);
  });

  it("журнал ключей кольцевой — не растёт бесконечно в сейве", () => {
    const state = game();
    for (let i = 0; i < MAX_PRIMITIVE_BATCH_KEYS + 5; i++) {
      applyPrimitiveTurn(state, [], `key-${i}`);
    }

    expect(state.primitiveBatchKeys).toHaveLength(MAX_PRIMITIVE_BATCH_KEYS);
    expect(isDuplicatePrimitiveBatch(state, `key-${MAX_PRIMITIVE_BATCH_KEYS + 4}`)).toBe(true);
    expect(isDuplicatePrimitiveBatch(state, "key-0")).toBe(false);
  });
});

describe("отклик игроку строится из фактических величин (docs/PRIMITIVES.md §4)", () => {
  /** Пара «поле + локализованное имя цели», как её видит игрок в тексте. */
  function reportedPairs(details: readonly PrimitiveOutcomeLine[]): string[] {
    return details
      .filter(d => d.key.startsWith("impact"))
      .map(d => `${d.key.split(".")[1]}:${getText(d.names?.group, "en")}`)
      .sort();
  }

  it("ни одна затронутая пара (цель, поле) не пропадает из текста", () => {
    const state = game();
    const result = applyPrimitiveTurn(state, [repressRegion], "k");

    const applied = result.applied[0]!;
    expect(applied.verb).toBe("repress");
    const expected = (applied as { targetEffects: { field: string; groupId: string }[] })
      .targetEffects.map(e => {
        const names = state.ethnicGroups.find(g => g.id === e.groupId)?.names;
        return `${e.field}:${getText(names, "en")}`;
      })
      .sort();

    expect(reportedPairs(result.outcomes[0]!.details)).toEqual(expected);
  });

  it("цель с нулевой дельтой названа нулевой, а не умолчана", () => {
    const state = game();
    // Загоняем титульную группу в потолок обоих полей репрессии заранее —
    // тогда следующая репрессия по ней не сдвинет ничего.
    state.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 1,
      alienation: 1,
      concession: 0,
      emboldenment: 0,
    });

    const result = applyPrimitiveTurn(state, [repressRegion], "k");
    const details = result.outcomes[0]!.details;

    const titularName = getText(
      state.ethnicGroups.find(g => g.id === TEST_GROUP_TITULAR)!.names,
      "en"
    );
    const titularLines = details.filter(
      d => getText(d.names?.group, "en") === titularName
    );

    expect(titularLines.length).toBeGreaterThan(0);
    expect(titularLines.every(d => d.key.endsWith(".unchanged"))).toBe(true);
    // …и при этом сдвинувшаяся группа по-прежнему в тексте есть.
    const loyalName = getText(state.ethnicGroups.find(g => g.id === TEST_GROUP_LOYAL)!.names, "en");
    expect(
      details.some(d => getText(d.names?.group, "en") === loyalName && d.key.endsWith(".changed"))
    ).toBe(true);
  });

  it("нулевой отклик соседей называется отсутствием отклика, а не молчанием", () => {
    const state = game();
    // Поле уступки титульной группы под потолком: дать нечего, значит и соседям
    // отзываться не на что.
    state.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 1,
      emboldenment: 0,
    });

    const result = applyPrimitiveTurn(state, [grantAutonomy], "k");
    const details = result.outcomes[0]!.details;

    expect(details.some(d => d.key === "grantAutonomy.noNeighbourResponse")).toBe(true);
  });

  it("реформа отчитывается фактическим сдвигом координаты и уплаченной ценой", () => {
    const state = game();
    const before = state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates!.political;

    const result = applyPrimitiveTurn(
      state,
      [
        {
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic", intensity: "severe" },
        },
      ],
      "k"
    );

    const after = state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates!.political;
    expect(after).toBeGreaterThan(before);

    const details = result.outcomes[0]!.details;
    expect(details.some(d => d.key === "reform.democratic.changed")).toBe(true);
    expect(details.some(d => d.key === "reform.cost")).toBe(true);

    // Опубликованное «стало» обязано совпасть с состоянием мира: именно это
    // число уходит в текст игроку.
    const shift = details.find(d => d.key === "reform.democratic.changed")!;
    expect(shift.values!.after).toBe(after.toFixed(2));
  });
});

describe("история места (docs/CONCEPT.md §5.6)", () => {
  it("применённый примитив оставляет запись в регионе, где произошёл", () => {
    const state = game();
    applyPrimitiveTurn(state, [repressRegion], "k");

    const history = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!.placeHistory!;
    expect(history).toHaveLength(1);
    expect(history[0]!.verb).toBe("repress");
    expect(history[0]!.date).toBe(state.currentDate);
    expect(history[0]!.line.key).toBe("repress.headline");
  });

  it("уступка оставляет у соседа СВОЮ запись — эхо, а не ту же уступку", () => {
    const state = game();
    const result = applyPrimitiveTurn(state, [grantAutonomy], "k");

    // Предпосылка теста: отклик соседей вообще был (иначе проверять нечего).
    const applied = result.applied[0] as { neighbourEffects: unknown[] };
    expect(applied.neighbourEffects.length).toBeGreaterThan(0);

    const neighbourHistory = state.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!.placeHistory!;
    expect(neighbourHistory).toHaveLength(1);
    expect(neighbourHistory[0]!.line.key).toBe("grantAutonomy.echoInPlace");

    const targetHistory = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!.placeHistory!;
    expect(targetHistory[0]!.line.key).toBe("grantAutonomy.headline");
  });

  it("реформа не приписывается никакому месту — у неё его нет", () => {
    const state = game();
    applyPrimitiveTurn(
      state,
      [
        {
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ],
      "k"
    );

    expect(state.regions.every(r => (r.placeHistory ?? []).length === 0)).toBe(true);
  });

  it("история места капируется — сейв не растёт монотонно", () => {
    const state = game();
    for (let i = 0; i < PLACE_HISTORY_MAX_ENTRIES + 4; i++) {
      // Свежее состояние памяти не нужно: важен факт записи, а не её величина.
      applyPrimitiveTurn(state, [repressRegion], `key-${i}`);
    }

    const history = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!.placeHistory!;
    expect(history).toHaveLength(PLACE_HISTORY_MAX_ENTRIES);
  });

  it("отклонённый примитив истории места не оставляет", () => {
    const state = game();
    applyPrimitiveTurn(
      state,
      [{ verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } }],
      "k"
    );

    expect(state.regions.find(r => r.id === TEST_REGION_NATIONAL)!.placeHistory).toBeUndefined();
  });
});
