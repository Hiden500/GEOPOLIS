import { describe, it, expect } from "vitest";
import { applyPrimitiveTurn, isDuplicatePrimitiveBatch } from "../turnBatch";
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
import { createTestRegion } from "../../test-utils/fixtures";
import { rejectionPromptText } from "../rejections";
import { type RejectedPrimitive } from "../types";

/** Английский рендер причины — тот, что уходит в промт (см. `rejections.ts`). */
const promptTextOf = (rejected: RejectedPrimitive): string =>
  rejectionPromptText(rejected.rejection);

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

  it("в СЛЕДУЮЩЕМ ходу тот же батч применяется снова — защита ключевая, а не глухая", () => {
    const state = game();

    applyPrimitiveTurn(state, [repressRegion], "turn-1");
    const suppressionAfterFirst = memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!
      .suppression;

    // Новый месяц — новый ход: остатки прошлого законный приказ не блокируют.
    state.currentDate = "1946-02-01";
    const second = applyPrimitiveTurn(state, [repressRegion], "turn-2");

    expect(second.duplicate).toBe(false);
    expect(second.applied).toHaveLength(1);
    expect(
      memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression
    ).toBeGreaterThan(suppressionAfterFirst);
  });

  it("ключ отличает ретрай от законной второй попытки: мир один, отчёт разный", () => {
    // Что именно предотвращает КЛЮЧ теперь, когда мир прикрыт бюджетом хода.
    // Мир в обоих случаях одинаков — это делает бюджет. Но повтор с новым
    // ключом выглядит как настоящая попытка: её отказ уходит диагностикой в
    // следующий промт («не долбись в невозможное»), и модель получила бы
    // выговор за то, чего не делала. Ключ отвечает «это тот же запрос».
    const retried = game();
    applyPrimitiveTurn(retried, [repressRegion], "same-key");
    const factsAfterFirst = retried.pendingWorldFacts.length;
    const retry = applyPrimitiveTurn(retried, [repressRegion], "same-key");

    const reordered = game();
    applyPrimitiveTurn(reordered, [repressRegion], "key-1");
    const second = applyPrimitiveTurn(reordered, [repressRegion], "key-2");

    expect(retry.duplicate).toBe(true);
    expect(retry.rejected).toEqual([]);
    expect(retried.pendingWorldFacts).toHaveLength(factsAfterFirst);

    expect(second.duplicate).toBe(false);
    expect(second.rejected).toHaveLength(1);
    expect(promptTextOf(second.rejected[0]!)).toMatch(/per target per turn/);
    expect(reordered.pendingWorldFacts.length).toBeGreaterThan(factsAfterFirst);

    // …и при этом мир у обоих один и тот же: второй удар не лёг ни там, ни там.
    expect(memoryOf(retried, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression).toBe(
      memoryOf(reordered, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression
    );
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

    // Пустые батчи копятся в СВОЁМ кольце (см. следующий тест) — оно кольцевое
    // ровно так же, а кольцо применённых при этом не тронуто.
    expect(state.primitiveNoopBatchKeys).toHaveLength(MAX_PRIMITIVE_BATCH_KEYS);
    expect(state.primitiveBatchKeys).toEqual([]);
    expect(isDuplicatePrimitiveBatch(state, `key-${MAX_PRIMITIVE_BATCH_KEYS + 4}`)).toBe(true);
    expect(isDuplicatePrimitiveBatch(state, "key-0")).toBe(false);
  });

  /**
   * Пустые и целиком отклонённые батчи не вытесняют ключи применённых
   * (разделение колец, 2026-07-26, внешний аудит).
   *
   * Прежний тест фиксировал вытеснение `key-0` пустыми батчами как норму — а
   * это и был дефект: цена вытеснения несимметрична. Потерянный ключ ПУСТОГО
   * батча стоит одной лишней записи диагностики при повторе; потерянный ключ
   * ПРИМЕНЁННОГО означает, что сетевой ретрай применится вторым приказом и мир
   * изменится молча — ровно то, против чего ключ и заведён.
   */
  it("мусорные батчи не вытесняют ключ применённого запроса", () => {
    const state = game();

    const applied = applyPrimitiveTurn(state, [repressRegion], "the-real-order");
    expect(applied.applied).toHaveLength(1);

    // Заведомо невозможные приказы: столько же, сколько вмещает всё кольцо, и
    // ещё немного сверху.
    const impossible: Primitive = {
      verb: "repress",
      sourceCountryId: "USA",
      target: { regionId: TEST_REGION_NATIONAL },
    };
    for (let i = 0; i < MAX_PRIMITIVE_BATCH_KEYS + 5; i++) {
      const spam = applyPrimitiveTurn(state, [impossible], `spam-${i}`);
      expect(spam.applied).toEqual([]);
    }

    expect(isDuplicatePrimitiveBatch(state, "the-real-order")).toBe(true);
    expect(state.primitiveBatchKeys).toEqual(["the-real-order"]);
    expect(state.primitiveNoopBatchKeys).toHaveLength(MAX_PRIMITIVE_BATCH_KEYS);
  });
});

describe("бюджет хода общий для всех вызовов (docs/PRIMITIVES.md §4)", () => {
  /**
   * Дифференциальная проверка: N отдельных вызовов в одном ходу обязаны дать
   * ТО ЖЕ состояние мира, что один батч из N примитивов.
   *
   * Сравнивается состояние, а не возвращённые флаги. Флаги показывают, что
   * функция что-то ответила; вопрос же в том, разошёлся ли мир. До 2026-07-26
   * счётчики капов жили внутри вызова, и эти две дороги расходились: батч
   * применял один примитив и отклонял девять, а десять запросов применяли все
   * десять и упирали поле памяти в потолок.
   *
   * Оба кольца ключей из сравнения исключены намеренно: ключей ПО ПОСТРОЕНИЮ
   * столько, сколько было запросов, и требовать их совпадения значило бы
   * требовать, чтобы десять запросов притворялись одним.
   */
  function worldWithoutKeys(state: GameState): string {
    return JSON.stringify({ ...state, primitiveBatchKeys: [], primitiveNoopBatchKeys: [] });
  }

  const mildRepress: Primitive = {
    verb: "repress",
    sourceCountryId: "SUN",
    target: { regionId: TEST_REGION_NATIONAL },
    params: { intensity: "mild" },
  };

  it("десять отдельных приказов = один батч из десяти, вплоть до полного снимка мира", () => {
    const batched = game();
    applyPrimitiveTurn(batched, Array.from({ length: 10 }, () => mildRepress), "one-batch");

    const clicked = game();
    for (let i = 0; i < 10; i++) {
      applyPrimitiveTurn(clicked, [mildRepress], `click-${i}`);
    }

    expect(worldWithoutKeys(clicked)).toBe(worldWithoutKeys(batched));

    // И величина именно та, что даёт ОДИН примитив, а не десять сложенных:
    // иначе тест прошёл бы и на двух одинаково сломанных мирах.
    const single = game();
    applyPrimitiveTurn(single, [mildRepress], "single");
    expect(memoryOf(clicked, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression).toBe(
      memoryOf(single, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression
    );
  });

  it("мягкий бюджет хода общий у модели и игрока — не по десять на канал", () => {
    // Одиннадцать РАЗНЫХ целей: кап «один verb на цель» не срабатывает ни разу,
    // режет именно бюджет хода. Регионы одноимённой группы, без соседей —
    // чтобы в игру не вмешивался ни потолок накопления, ни отклик соседей.
    const state = game();
    const extraIds = Array.from({ length: 11 }, (_, i) => 800 + i);
    for (const id of extraIds) {
      state.regions.push(
        createTestRegion({
          id,
          geoJsonId: `TEST-${id}`,
          names: { en: `Extra region ${id}` },
          ownerCountryId: "SUN",
          population: 1_000_000,
          gdp: 400_000_000,
          neighboringRegionIds: [],
          demographics: [{ groupId: TEST_GROUP_TITULAR, share: 1 }],
        })
      );
    }

    const director = applyPrimitiveTurn(
      state,
      extraIds.slice(0, 10).map((regionId): Primitive => ({
        verb: "repress",
        sourceCountryId: "SUN",
        target: { regionId },
        params: { intensity: "mild" },
      })),
      "director"
    );
    expect(director.applied).toHaveLength(10);
    expect(state.primitiveTurnBudget.softUsed).toBe(10);

    // Ход исчерпан — приказ игрока по НЕТРОНУТОЙ цели всё равно не проходит.
    const player = applyPrimitiveTurn(
      state,
      [{ verb: "repress", sourceCountryId: "SUN", target: { regionId: extraIds[10]! } }],
      "player"
    );
    expect(player.applied).toEqual([]);
    expect(promptTextOf(player.rejected[0]!)).toMatch(/At most 10 soft primitives per turn/);
  });

  it("отклонённый примитив ход не тратит — иначе один промах закрывал бы месяц", () => {
    const state = game();
    // Страны нет в партии — предпосылка не выполнена, отказ на фазе validate.
    const impossible: Primitive = {
      verb: "enact_reform",
      sourceCountryId: "XXX",
      target: { countryId: "XXX" },
      params: { politicalDirection: "democratic" },
    };

    const refused = applyPrimitiveTurn(state, [impossible], "miss");
    expect(refused.applied).toEqual([]);
    expect(state.primitiveTurnBudget.structuralUsed).toBe(0);

    // Единственный структурный слот месяца остался у законной реформы.
    const legit = applyPrimitiveTurn(
      state,
      [
        {
          verb: "enact_reform",
          sourceCountryId: "SUN",
          target: { countryId: "SUN" },
          params: { politicalDirection: "democratic" },
        },
      ],
      "reform"
    );
    expect(legit.applied).toHaveLength(1);
  });

  it("бюджет переживает сохранение/загрузку — он в состоянии, а не в памяти процесса", () => {
    const state = game();
    applyPrimitiveTurn(state, [mildRepress], "before-save");

    // Сейв — это JSON состояния и ничего больше (docs/plans/01_PERSISTENCE_STATE.md).
    const loaded: GameState = JSON.parse(JSON.stringify(state));
    const afterLoad = applyPrimitiveTurn(loaded, [mildRepress], "after-load");

    expect(afterLoad.applied).toEqual([]);
    expect(promptTextOf(afterLoad.rejected[0]!)).toMatch(/per target per turn/);
    expect(memoryOf(loaded, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression).toBe(
      memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression
    );
  });

  it("новый месяц обнуляет бюджет сам, без отдельного вызова reset", () => {
    const state = game();
    applyPrimitiveTurn(state, [mildRepress], "january");
    expect(state.primitiveTurnBudget.softUsed).toBe(1);

    state.currentDate = "1946-02-01";
    const february = applyPrimitiveTurn(state, [mildRepress], "february");

    expect(february.applied).toHaveLength(1);
    expect(state.primitiveTurnBudget.date).toBe("1946-02-01");
    expect(state.primitiveTurnBudget.softUsed).toBe(1);
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
      // Каждая запись — свой месяц: кап «один verb на цель за ход» не даст
      // повторить репрессию в том же ходу, и это правильно. Свежее состояние
      // памяти не нужно — важен факт записи, а не её величина.
      state.currentDate = `1946-${String((i % 12) + 1).padStart(2, "0")}-01`;
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
