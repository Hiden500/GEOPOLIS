import { describe, it, expect } from "vitest";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { PRIMITIVE_PALETTE } from "../palette";
import { collectChangedPaths } from "../statePaths";
import { PRIMITIVE_VERBS, type Primitive, type PrimitiveVerb } from "../types";
import { primitiveSchema, parsePrimitives } from "../primitiveSchemas";
import { regionDiscontent } from "@shared/utils/discontent";
import {
  ENACT_REFORM_COORDINATE_STEP,
  ENACT_REFORM_POLITICAL_COST,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  MAX_STRUCTURAL_PRIMITIVES_PER_BATCH,
  PRIMITIVE_INTENSITY_MULTIPLIER,
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

  it("качественный хинт интенсивности меняет величину — и только он", () => {
    const mild = game();
    const severe = game();

    applyPrimitiveBatch(mild, [{
      verb: "repress", sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL }, params: { intensity: "mild" },
    }]);
    applyPrimitiveBatch(severe, [{
      verb: "repress", sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL }, params: { intensity: "severe" },
    }]);

    const mildMemory = memoryOf(mild, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!;
    const severeMemory = memoryOf(severe, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!;
    expect(severeMemory.suppression / mildMemory.suppression).toBeCloseTo(
      PRIMITIVE_INTENSITY_MULTIPLIER["severe"]! / PRIMITIVE_INTENSITY_MULTIPLIER["mild"]!,
      10
    );
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
    expect(after.politics.ideologyCoordinates!.political).toBeCloseTo(-0.9 + ENACT_REFORM_COORDINATE_STEP, 10);
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
