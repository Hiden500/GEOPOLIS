import { describe, it, expect } from "vitest";
import { applyPrimitiveBatch, restore } from "../PrimitiveEngine";
import { PRIMITIVE_PALETTE } from "../palette";
import { collectChangedPaths } from "../statePaths";
import { PRIMITIVE_VERBS, type Primitive, type PrimitiveVerb } from "../types";
import { primitiveSchema, parsePrimitives } from "../primitiveSchemas";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  ENACT_REFORM_COORDINATE_STEP_MIN,
  ENACT_REFORM_COORDINATE_STEP_MAX,
  ENACT_REFORM_POLITICAL_COST,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  MAX_STRUCTURAL_PRIMITIVES_PER_BATCH,
  REPRESS_SUPPRESSION_MIN,
  REPRESS_SUPPRESSION_MAX,
  GRANT_AUTONOMY_CONCESSION_MIN,
  GRANT_AUTONOMY_CONCESSION_MAX,
} from "@shared/defines/discontent";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_GROUP_LOYAL,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";
import { type GameState } from "@shared/types/GameState";

/**
 * Контракт валидатора примитивов (docs/PRIMITIVES.md §3): validate → compute →
 * apply, reject целиком, палитра эффектов, числа считает движок.
 */

function game(): GameState {
  return createDiscontentTestGame();
}

function discontentOf(state: GameState, regionId: number): number {
  return regionDiscontent(state, state.regions.find(r => r.id === regionId)!)!;
}

function memoryOf(state: GameState, regionId: number, groupId: string) {
  return state.groupImpactMemory.find(m => m.regionId === regionId && m.groupId === groupId);
}

const inciteTitular: Primitive = {
  verb: "incite_unrest",
  sourceCountryId: "USA",
  target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
};

describe("incite_unrest", () => {
  it("поднимает недовольство через смелость группы", () => {
    const state = game();
    const before = discontentOf(state, TEST_REGION_NATIONAL);

    const result = applyPrimitiveBatch(state, [inciteTitular]);

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.emboldenment).toBeGreaterThan(0);
    expect(discontentOf(state, TEST_REGION_NATIONAL)).toBeGreaterThan(before);
  });

  it("отклоняется, когда дистанция «власть ↔ группа» ниже порога", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "incite_unrest",
      sourceCountryId: "USA",
      target: { regionId: TEST_REGION_CONTROL, groupId: TEST_GROUP_LOYAL },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/distance/i);
    expect(state.groupImpactMemory).toHaveLength(0);
  });

  it("отклоняется без указания группы", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "incite_unrest",
      sourceCountryId: "USA",
      target: { regionId: TEST_REGION_NATIONAL },
    }]);
    expect(result.rejected[0]!.reason).toMatch(/requires a target group/);
  });
});

describe("repress", () => {
  it("сбивает недовольство сейчас, но наращивает отчуждение навсегда", () => {
    const state = game();
    const before = discontentOf(state, TEST_REGION_NATIONAL);

    const result = applyPrimitiveBatch(state, [{
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL },
    }]);

    expect(result.rejected).toHaveLength(0);
    expect(discontentOf(state, TEST_REGION_NATIONAL)).toBeLessThan(before);

    const memory = memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!;
    expect(memory.suppression).toBeGreaterThan(0);
    expect(memory.alienation).toBeGreaterThan(0);
  });

  it("требует контроля над регионом — чужая страна отклоняется", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "repress",
      sourceCountryId: "USA",
      target: { regionId: TEST_REGION_NATIONAL },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/does not control/);
  });

  it("качественный хинт интенсивности двигает величину внутри коридора", () => {
    const suppressionFor = (intensity: "mild" | "moderate" | "severe"): number => {
      const state = game();
      applyPrimitiveBatch(state, [{
        verb: "repress", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { intensity },
      }]);
      return memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression;
    };

    const mild = suppressionFor("mild");
    const moderate = suppressionFor("moderate");
    const severe = suppressionFor("severe");

    // Хинт продолжает влиять — но монотонно и в границах коридора, который
    // задают defines. Никакого «ровно втрое за слово severe».
    expect(mild).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(severe);
    expect(mild).toBeGreaterThanOrEqual(REPRESS_SUPPRESSION_MIN);
    expect(severe).toBeLessThanOrEqual(REPRESS_SUPPRESSION_MAX);
  });
});

describe("grant_autonomy", () => {
  it("снижает недовольство в регионе и делает ту же группу смелее у соседей", () => {
    const state = game();
    const beforeTarget = discontentOf(state, TEST_REGION_NATIONAL);
    const beforeNeighbour = discontentOf(state, TEST_REGION_NEIGHBOUR);

    const result = applyPrimitiveBatch(state, [{
      verb: "grant_autonomy",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    }]);

    expect(result.rejected).toHaveLength(0);
    expect(discontentOf(state, TEST_REGION_NATIONAL)).toBeLessThan(beforeTarget);
    expect(discontentOf(state, TEST_REGION_NEIGHBOUR)).toBeGreaterThan(beforeNeighbour);
    expect(memoryOf(state, TEST_REGION_NEIGHBOUR, TEST_GROUP_TITULAR)!.emboldenment).toBeGreaterThan(0);
  });
});

describe("enact_reform", () => {
  it("двигает координаты власти и списывает политическую цену", () => {
    const state = game();
    const country = state.countries.find(c => c.id === "SUN")!;
    const supportBefore = country.politics.governmentSupport;
    const before = discontentOf(state, TEST_REGION_NATIONAL);

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform",
      sourceCountryId: "SUN",
      target: { countryId: "SUN" },
      params: { politicalDirection: "democratic" },
    }]);

    expect(result.rejected).toHaveLength(0);
    const after = state.countries.find(c => c.id === "SUN")!;
    const step = after.politics.ideologyCoordinates!.political - (-0.9);
    // Величина шага — дело движка (мандат правительства), поэтому проверяется
    // коридор и совпадение с заявленной магнитудой, а не конкретное число.
    expect(step).toBeGreaterThanOrEqual(ENACT_REFORM_COORDINATE_STEP_MIN);
    expect(step).toBeLessThanOrEqual(ENACT_REFORM_COORDINATE_STEP_MAX);
    expect(result.applied[0]!.magnitude).toBeCloseTo(step, 10);
    expect(after.politics.governmentSupport).toBeCloseTo(supportBefore - ENACT_REFORM_POLITICAL_COST, 10);
    expect(discontentOf(state, TEST_REGION_NATIONAL)).toBeLessThan(before);
  });


  it("отклоняется без политического капитала — цена настоящая", () => {
    const state = game();
    state.countries.find(c => c.id === "SUN")!.politics.governmentSupport =
      ENACT_REFORM_MIN_GOVERNMENT_SUPPORT - 1;

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { politicalDirection: "democratic" },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/[Gg]overnment support/);
  });

  it("отклоняется без указанного направления", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" },
    }]);
    expect(result.rejected[0]!.reason).toMatch(/at least one direction/);
  });
});

describe("spawn_incident", () => {
  it("создаёт объект на карте нужного типа в напряжённом регионе", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "spawn_incident",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL },
      params: { incidentKind: "uprising" },
    }]);

    expect(result.rejected).toHaveLength(0);
    expect(state.mapFeatures).toHaveLength(1);
    expect(state.mapFeatures[0]!.type).toBe("uprising");
    expect(state.mapFeatures[0]!.regionId).toBe(TEST_REGION_NATIONAL);
  });

  it("отклоняется в спокойном регионе — инцидент растёт из контекста, не из пустоты", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_CONTROL },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/below the .* threshold/);
    expect(state.mapFeatures).toHaveLength(0);
  });
});

describe("контракт батча", () => {
  it("отклонённый примитив не оставляет следа в состоянии (reject целиком)", () => {
    const state = game();
    const snapshot = structuredClone(state);

    const result = applyPrimitiveBatch(state, [{
      verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL },
    }]);

    expect(result.rejected).toHaveLength(1);
    // Единственная разрешённая разница — диагностический факт об отказе.
    expect(state.pendingWorldFacts).toHaveLength(1);
    expect(state.pendingWorldFacts[0]!.kind).toBe("primitive_rejected");
    state.pendingWorldFacts = [];
    expect(state).toEqual(snapshot);
  });

  it("валидный примитив применяется рядом с отклонённым (мягкий класс комбинируется)", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      inciteTitular,
      { verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } },
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("каждый следующий примитив видит эффект предыдущего (предпосылки пересчитываются)", () => {
    const spawnIncident: Primitive = {
      verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
    };
    const grantAutonomy: Primitive = {
      verb: "grant_autonomy", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
    };

    // Сам по себе инцидент в этом регионе проходит: недовольство выше порога.
    const alone = game();
    expect(applyPrimitiveBatch(alone, [spawnIncident]).applied).toHaveLength(1);

    // Уступка, применённая первой, сбивает недовольство под порог — и тот же
    // самый инцидент следом уже отклоняется. Предпосылка считается по
    // актуальному состоянию, а не по состоянию начала батча.
    const afterConcession = game();
    const result = applyPrimitiveBatch(afterConcession, [grantAutonomy, spawnIncident]);

    expect(result.applied.map(a => a.verb)).toEqual(["grant_autonomy"]);
    expect(result.rejected[0]!.verb).toBe("spawn_incident");
    expect(afterConcession.mapFeatures).toHaveLength(0);
  });

  it("структурный примитив исполняется последним и не более одного за ответ", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      { verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" }, params: { politicalDirection: "democratic" } },
      { verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" }, params: { economicDirection: "right" } },
      inciteTitular,
    ]);

    expect(result.applied.map(a => a.verb)).toEqual(["incite_unrest", "enact_reform"]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason)
      .toMatch(new RegExp(`At most ${MAX_STRUCTURAL_PRIMITIVES_PER_BATCH} structural`));
  });

  it("каждое отклонение даёт диагностический факт с причиной", () => {
    const state = game();

    applyPrimitiveBatch(state, [{
      verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL },
    }]);

    const fact = state.pendingWorldFacts.find(f => f.kind === "primitive_rejected")!;
    expect(fact.countryId).toBe("USA");
    expect(fact.text).toContain("repress");
  });
});

describe("палитра эффектов (docs/PRIMITIVES.md §3, защита №3)", () => {
  // Пары «verb → сценарий, в котором он валиден» — палитру нельзя проверить
  // на отклонённом примитиве, он ничего не меняет.
  const SCENARIOS: { verb: PrimitiveVerb; primitive: Primitive }[] = [
    { verb: "incite_unrest", primitive: inciteTitular },
    {
      verb: "repress",
      primitive: { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
    },
    {
      verb: "grant_autonomy",
      primitive: {
        verb: "grant_autonomy", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
      },
    },
    {
      verb: "enact_reform",
      primitive: {
        verb: "enact_reform", sourceCountryId: "SUN",
        target: { countryId: "SUN" }, params: { politicalDirection: "democratic" },
      },
    },
    {
      verb: "spawn_incident",
      primitive: {
        verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
      },
    },
  ];

  it("сценарий покрывает каждый verb алфавита — новый глагол не проскочит мимо проверки", () => {
    expect(SCENARIOS.map(s => s.verb).sort()).toEqual([...PRIMITIVE_VERBS].sort());
  });

  it.each(SCENARIOS)("$verb меняет только задекларированные пути состояния", ({ verb, primitive }) => {
    const state = game();
    const before = structuredClone(state);

    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.applied).toHaveLength(1);

    // Диагностика отказов — не эффект примитива, её палитра не описывает.
    state.pendingWorldFacts = before.pendingWorldFacts;

    const changed = collectChangedPaths(before, state);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.filter(p => !PRIMITIVE_PALETTE[verb].includes(p))).toEqual([]);
  });

  it("рантайм-проверка кусается: эффект вне палитры откатывает примитив целиком", () => {
    const state = game();
    const original = PRIMITIVE_PALETTE.repress;
    // Сужаем палитру так, что законный эффект перестаёт быть законным —
    // движок обязан откатить примитив, а не применить его «почти».
    (PRIMITIVE_PALETTE as Record<PrimitiveVerb, readonly string[]>).repress = [
      "groupImpactMemory[*].regionId",
      "groupImpactMemory[*].groupId",
    ];

    try {
      const result = applyPrimitiveBatch(state, [{
        verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
      }]);

      expect(result.applied).toHaveLength(0);
      expect(result.rejected[0]!.reason).toMatch(/outside the repress palette/);
      expect(state.groupImpactMemory).toHaveLength(0);
    } finally {
      (PRIMITIVE_PALETTE as Record<PrimitiveVerb, readonly string[]>).repress = original;
    }
  });
});

describe("числа — движок, не LLM (docs/PRIMITIVES.md §1)", () => {
  it("схема примитива не принимает ни одного числового параметра величины", () => {
    const withMagnitude = {
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL },
      params: { intensity: "severe", magnitude: 0.9 },
    };

    expect(primitiveSchema.safeParse(withMagnitude).success).toBe(false);
  });

  it("params допускает только качественные перечисления", () => {
    const { primitives, invalid } = parsePrimitives([
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: 187 }, params: { intensity: "mild" } },
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: 187 }, params: { intensity: 0.7 } },
    ]);

    expect(primitives).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.index).toBe(1);
  });

  it("магнитуду возвращает движок, и она не приходит из входа", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
    }]);

    expect(result.applied[0]!.magnitude).toBeGreaterThan(0);
  });
});

/**
 * Центральное требование среза (docs/PRIMITIVES.md §1: «magnitude — величину
 * эффекта считает движок ИЗ СОСТОЯНИЯ + params, хинт клампится»).
 *
 * Каждый тест ниже держит `params` НЕИЗМЕННЫМИ и меняет ровно одно свойство
 * состояния мира. Если движок вернул ту же величину — состояние в расчёт не
 * входит, и алфавит примитивов снова «константа × слово модели».
 */
describe("магнитуда зависит от состояния (одинаковые params → разные числа)", () => {
  /** Величина, о которой движок отчитался после применения одного примитива. */
  function magnitudeOf(state: GameState, primitive: Primitive): number {
    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.rejected, JSON.stringify(result.rejected)).toHaveLength(0);
    return result.applied[0]!.magnitude;
  }

  const repressTitular: Primitive = {
    verb: "repress",
    sourceCountryId: "SUN",
    target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
  };

  it("repress: разваливающаяся власть подавляет слабее уверенной", () => {
    const strong = game();
    const weak = game();
    const politicsOf = (s: GameState) => s.countries.find(c => c.id === "SUN")!.politics;
    politicsOf(weak).stability = politicsOf(strong).stability / 2;
    politicsOf(weak).legitimacy = politicsOf(strong).legitimacy / 2;

    expect(magnitudeOf(weak, repressTitular)).toBeLessThan(magnitudeOf(strong, repressTitular));
  });

  it("repress: доминанта подавить труднее, чем малое меньшинство", () => {
    const dominant = game();
    const minority = game();
    // Одна и та же группа, разная доля в регионе — больше ничего не меняется.
    const demographics = minority.regions.find(r => r.id === TEST_REGION_NATIONAL)!.demographics!;
    demographics.find(d => d.groupId === TEST_GROUP_TITULAR)!.share = 0.1;
    demographics.find(d => d.groupId === TEST_GROUP_LOYAL)!.share = 0.9;

    expect(magnitudeOf(dominant, repressTitular)).toBeLessThan(magnitudeOf(minority, repressTitular));
  });

  it("repress: без способности применить силу хинт перестаёт что-либо значить", () => {
    const suppressionAt = (intensity: "mild" | "severe"): number => {
      const state = game();
      const politics = state.countries.find(c => c.id === "SUN")!.politics;
      politics.stability = 0;
      politics.legitimacy = 0;
      return magnitudeOf(state, { ...repressTitular, params: { intensity } });
    };

    // Коридор схлопнулся в пол — «severe» больше не даёт ничего сверх «mild».
    expect(suppressionAt("severe")).toBeCloseTo(suppressionAt("mild"), 10);
    expect(suppressionAt("severe")).toBeCloseTo(REPRESS_SUPPRESSION_MIN, 10);
  });

  const grantTitular: Primitive = {
    verb: "grant_autonomy",
    sourceCountryId: "SUN",
    target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
  };

  it("grant_autonomy: уступка отчуждённой группе стоит меньше, чем не обиженной", () => {
    const trusting = game();
    const alienated = game();
    alienated.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0.8,
      concession: 0,
      emboldenment: 0,
    });

    expect(magnitudeOf(alienated, grantTitular)).toBeLessThan(magnitudeOf(trusting, grantTitular));
  });

  it("grant_autonomy: уступка меньшинству мельче уступки доминанту", () => {
    const dominant = game();
    const minority = game();
    const demographics = minority.regions.find(r => r.id === TEST_REGION_NATIONAL)!.demographics!;
    demographics.find(d => d.groupId === TEST_GROUP_TITULAR)!.share = 0.1;
    demographics.find(d => d.groupId === TEST_GROUP_LOYAL)!.share = 0.9;

    const small = magnitudeOf(minority, grantTitular);
    const large = magnitudeOf(dominant, grantTitular);
    expect(small).toBeLessThan(large);
    expect(small).toBeGreaterThanOrEqual(GRANT_AUTONOMY_CONCESSION_MIN);
    expect(large).toBeLessThanOrEqual(GRANT_AUTONOMY_CONCESSION_MAX);
  });

  it("incite_unrest: чем шире идеологический разрыв, тем горючее материал", () => {
    const wide = game();
    const narrow = game();
    // Разрыв уже, но всё ещё выше порога предпосылки — примитив проходит оба раза.
    narrow.ethnicGroups.find(g => g.id === TEST_GROUP_TITULAR)!.desiredIdeology =
      { economic: -0.5, political: 0.1 };

    expect(magnitudeOf(narrow, inciteTitular)).toBeLessThan(magnitudeOf(wide, inciteTitular));
  });

  const incidentInNational: Primitive = {
    verb: "spawn_incident",
    sourceCountryId: "SUN",
    target: { regionId: TEST_REGION_NATIONAL },
  };

  it("spawn_incident: кипящий регион даёт событие крупнее, чем едва перешедший порог", () => {
    const calm = game();
    const boiling = game();
    boiling.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: 0.6,
    });

    expect(magnitudeOf(calm, incidentInNational))
      .toBeLessThan(magnitudeOf(boiling, incidentInNational));
  });

  const reformDemocratic: Primitive = {
    verb: "enact_reform",
    sourceCountryId: "SUN",
    target: { countryId: "SUN" },
    params: { politicalDirection: "democratic" },
  };

  it("enact_reform: широкий мандат продавливает более глубокий сдвиг", () => {
    const weakMandate = game();
    const strongMandate = game();
    strongMandate.countries.find(c => c.id === "SUN")!.politics.governmentSupport = 95;

    const shallow = magnitudeOf(weakMandate, reformDemocratic);
    const deep = magnitudeOf(strongMandate, reformDemocratic);
    expect(shallow).toBeLessThan(deep);
    expect(shallow).toBeGreaterThanOrEqual(ENACT_REFORM_COORDINATE_STEP_MIN);
    expect(deep).toBeLessThanOrEqual(ENACT_REFORM_COORDINATE_STEP_MAX);
  });
});

/**
 * Атомарный commit не должен обесценивать ссылки, взятые ДО вызова: сессия B
 * будет звать движок из роутов и LLMService посреди хода, держа в руках
 * `const region = game.regions.find(...)`. До 2026-07-26 commit делал
 * `Object.assign(game, structuredClone(game))` и подменял идентичность всех
 * верхнеуровневых объектов — запись в такую ссылку терялась молча.
 */
describe("commit не отрывает ссылки от состояния", () => {
  it("объекты и массивы состояния переживают применённый батч", () => {
    const state = game();
    const region = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
    const country = state.countries.find(c => c.id === "SUN")!;
    const regions = state.regions;
    const memory = state.groupImpactMemory;

    const result = applyPrimitiveBatch(state, [inciteTitular]);
    expect(result.applied).toHaveLength(1);

    expect(state.regions).toBe(regions);
    expect(state.groupImpactMemory).toBe(memory);
    expect(state.regions.find(r => r.id === TEST_REGION_NATIONAL)).toBe(region);
    expect(state.countries.find(c => c.id === "SUN")).toBe(country);
    // И запись через старую ссылку по-прежнему видна движку.
    region.population += 1;
    expect(regionDiscontent(state, state.regions.find(r => r.id === TEST_REGION_NATIONAL)!))
      .toBe(regionDiscontent(state, region));
  });

  it("пустой батч не трогает состояние вообще", () => {
    const state = game();
    const region = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
    const snapshot = structuredClone(state);

    const result = applyPrimitiveBatch(state, []);

    expect(result).toEqual({ applied: [], rejected: [] });
    expect(state).toEqual(snapshot);
    expect(state.regions.find(r => r.id === TEST_REGION_NATIONAL)).toBe(region);
  });

  it("перенос состояния удаляет ключи, которых в источнике больше нет", () => {
    const target = game();
    const source = structuredClone(target);
    target.lastTurnReport = {
      fromDate: "1946-01-01",
      toDate: "1946-02-01",
      months: 1,
      changes: [],
      completedGoalIds: [],
    };
    delete (source as Partial<GameState>).lastTurnReport;

    restore(target, source);

    expect("lastTurnReport" in target).toBe(false);
  });
});
