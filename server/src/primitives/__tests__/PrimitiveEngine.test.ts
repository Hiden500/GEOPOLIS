import { describe, it, expect, vi } from "vitest";
import { type z } from "zod";
import { applyPrimitiveBatch, pushRejectionFact, restore } from "../PrimitiveEngine";
import * as politicsCommands from "../../commands/politics";
import { PRIMITIVE_PALETTE, pathMatchesPaletteEntry } from "../palette";
import { WarService } from "../../services/WarService";
import { collectChangedPaths } from "../statePaths";
import {
  PRIMITIVE_VERBS,
  impactEffectsOf,
  type AppliedEnactReform,
  type AppliedGrantAutonomy,
  type AppliedPrimitive,
  type AppliedSpawnIncident,
  type Primitive,
  type PrimitiveVerb,
} from "../types";
import { primitiveSchema, parsePrimitives, PRIMITIVE_SCHEMAS } from "../primitiveSchemas";
import {
  ideologyDistance,
  regionDiscontent,
  resolveIdeologyCoordinates,
} from "@shared/utils/discontent";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { type ImpactMemoryField } from "@shared/types/politics/Demographics";
import { type IdeologyCoordinates } from "@shared/types/politics/Ideology";
import { ALLY_RELATION_THRESHOLD } from "@shared/defines/diplomacy";
import { allianceThreshold } from "../../simulation/diplomacy/affinity";
import {
  ENACT_REFORM_COORDINATE_STEP_MIN,
  ENACT_REFORM_COORDINATE_STEP_MAX,
  ENACT_REFORM_POLITICAL_COST,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PENDING_REJECTION_FACTS_PER_SOURCE,
  MAX_REJECTION_FACT_LENGTH,
  MAX_PRIMITIVE_ID_LENGTH,
  IMPACT_FIELD_TURN_CEILING,
  REPRESS_SUPPRESSION_MIN,
  REPRESS_SUPPRESSION_MAX,
  GRANT_AUTONOMY_CONCESSION_MIN,
  GRANT_AUTONOMY_CONCESSION_MAX,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
} from "@shared/defines/discontent";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_GROUP_LOYAL,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
  TEST_REGION_CONTROL,
  seedSeparatistDiscontent,
  destabilizeRegion,
  giveAudience,
  giveVassalageLeverage,
  holdTerritoryOf,
  addProxyClientWar,
} from "../../test-utils/discontentFixtures";
import { createTestRegion } from "../../test-utils/fixtures";
import { createGame } from "../../game/CreateGame";
import { type GameState } from "@shared/types/GameState";
import { rejectionPromptText } from "../rejections";
import { type RejectedPrimitive } from "../types";

/** Английский рендер причины — тот, что уходит в промт (см. `rejections.ts`). */
const promptTextOf = (rejected: RejectedPrimitive): string =>
  rejectionPromptText(rejected.rejection);

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

/**
 * Фактическая дельта одного поля памяти у одной группы — прямо из результата
 * примитива, без заглядывания в состояние.
 *
 * Обязательно `toBeDefined`: отсутствие записи означает, что движок о своём
 * эффекте не отчитался, и молча вернуть 0 здесь — значит спрятать ровно тот
 * дефект, ради которого результат и переделан.
 */
function deltaFor(applied: AppliedPrimitive, groupId: string, field: ImpactMemoryField): number {
  const effect = impactEffectsOf(applied).find(e => e.groupId === groupId && e.field === field);
  expect(effect, `${field} for ${groupId} missing from ${JSON.stringify(applied)}`).toBeDefined();
  return effect!.delta;
}

/** Сумма фактических дельт поля по всем затронутым группам. */
function totalDelta(applied: AppliedPrimitive, field: ImpactMemoryField): number {
  return impactEffectsOf(applied)
    .filter(e => e.field === field)
    .reduce((sum, e) => sum + e.delta, 0);
}

function asReform(applied: AppliedPrimitive): AppliedEnactReform {
  expect(applied.verb).toBe("enact_reform");
  return applied as AppliedEnactReform;
}

function asAutonomy(applied: AppliedPrimitive): AppliedGrantAutonomy {
  expect(applied.verb).toBe("grant_autonomy");
  return applied as AppliedGrantAutonomy;
}

function asIncident(applied: AppliedPrimitive): AppliedSpawnIncident {
  expect(applied.verb).toBe("spawn_incident");
  return applied as AppliedSpawnIncident;
}

const inciteTitular: Primitive = {
  verb: "incite_unrest",
  sourceCountryId: "USA",
  target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
};

/**
 * Пары «verb → сценарий, в котором он валиден». Нужны сразу двум проверкам —
 * палитре и полноте отчёта, — поэтому живут в модульной области: список,
 * покрывающий весь алфавит, обязан быть один, иначе новый глагол попадёт в одну
 * проверку и проскочит мимо второй.
 */
/**
 * Сценарий палитры: глагол, примитив и — при необходимости — подготовка мира.
 *
 * `setup` добавлен Милстоуном 1 (сессия жизненного цикла). Структурный
 * `split_country` по построению недостижим на спокойном мире: порог отделения
 * выше порога восстания, и дойти до него можно только накопленным следом
 * воздействий. Это не неудобство теста, а сама механика §6 — распад стоит в
 * КОНЦЕ драматургической дуги, а не доступен с первого хода.
 */
const SCENARIOS: {
  verb: PrimitiveVerb;
  primitive: Primitive;
  setup?: (state: GameState) => void;
}[] = [
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
  {
    verb: "split_country",
    primitive: {
      verb: "split_country", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { intensity: "severe" },
    },
    setup: seedSeparatistDiscontent,
  },
  // Дипломатический блок (Милстоун 1). Цель — USA: `createDiscontentTestGame`
  // держит её второй страной мира, и все четыре глагола двусторонние.
  {
    verb: "diplomacy",
    primitive: {
      verb: "diplomacy", sourceCountryId: "SUN",
      target: { countryId: "USA" }, params: { direction: "improve" },
    },
  },
  {
    verb: "sanction",
    primitive: {
      verb: "sanction", sourceCountryId: "SUN",
      target: { countryId: "USA" }, params: { sanctionType: "trade_embargo" },
    },
  },
  {
    verb: "war",
    primitive: { verb: "war", sourceCountryId: "SUN", target: { countryId: "USA" } },
  },
  {
    verb: "peace",
    primitive: { verb: "peace", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Мир требует идущей войны: без неё предпосылка не выполнена, и сценарий
    // проверял бы отказ вместо палитры.
    setup: state => { new WarService(state).declareWar("SUN", "USA"); },
  },
  // Мягкие воздействия (Милстоун 1).
  {
    verb: "send_aid",
    primitive: { verb: "send_aid", sourceCountryId: "SUN", target: { countryId: "USA" } },
  },
  {
    verb: "capital_flight",
    primitive: {
      verb: "capital_flight", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL },
    },
    // Предпосылка глагола — сломанное доверие: регион спокойнее порога капитал
    // не покидает, и сценарий проверял бы отказ вместо палитры.
    setup: state => { destabilizeRegion(state, TEST_REGION_NATIONAL); },
  },
  {
    verb: "condemn",
    primitive: { verb: "condemn", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Предпосылка — трибуна: без единой связи осуждающего никто не слышит.
    setup: state => { giveAudience(state, "SUN", "USA"); },
  },
  {
    verb: "support_proxy",
    primitive: { verb: "support_proxy", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Три предпосылки сразу: у клиента идёт война, патрон в ней не участвует,
    // между ними есть патронаж. Третья страна нужна именно для второй — иначе
    // единственным противником USA оказался бы сам патрон.
    setup: state => {
      addProxyClientWar(state, "USA");
      giveAudience(state, "SUN", "USA");
    },
  },
  // Структурные глаголы подчинения и поглощения (Милстоун 1).
  {
    verb: "puppet",
    primitive: { verb: "puppet", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Рычаг влияния, а не оккупации: он единственный доступен без войны, и
    // именно он живой на данных 1946 (оккупированных регионов там ноль).
    setup: state => { giveVassalageLeverage(state, "SUN", "USA"); },
  },
  {
    verb: "annex",
    primitive: { verb: "annex", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Аннексировать можно только то, что держишь: без региона под чужим
    // владением и своим контролем сценарий проверял бы отказ вместо палитры.
    setup: state => { holdTerritoryOf(state, "SUN", "USA", TEST_REGION_NEIGHBOUR); },
  },
  {
    verb: "merge_countries",
    primitive: { verb: "merge_countries", sourceCountryId: "SUN", target: { countryId: "USA" } },
    // Поглощается тот, чью внешнюю политику источник уже ведёт, и у цели
    // должна быть земля — иначе объединение не тронуло бы ни одного региона и
    // палитра осталась бы непроверенной на своей главной записи.
    setup: state => {
      const region = state.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!;
      region.ownerCountryId = "USA";
      const usa = state.countries.find(c => c.id === "USA")!;
      usa.capitalRegionId = region.id;
      usa.politics.sovereigntyStatus = "protectorate";
      usa.politics.overlordIds = ["SUN"];
      state.countries.find(c => c.id === "SUN")!.diplomacy.puppets = ["USA"];
    },
  },
  {
    verb: "create_country",
    primitive: {
      verb: "create_country", sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL },
    },
    // Предпосылок у него три, и все выполняет сама фикстура: SUN владеет
    // регионом, у региона есть группа-большинство, и после отделения
    // национальных регионов у метрополии остаётся контрольный.
  },
  // Воздействия, переехавшие из старого канала `actions` (2026-08-02).
  {
    verb: "guarantee",
    primitive: { verb: "guarantee", sourceCountryId: "SUN", target: { countryId: "USA" } },
  },
  {
    verb: "research_shift",
    primitive: {
      verb: "research_shift", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { domain: "armor" },
    },
    // Каталог доменов у фикстуры пуст: предпосылка глагола требует, чтобы домен
    // у страны существовал, и завести его — работа сценария, а не движка.
    setup: state => {
      state.countries.find(c => c.id === "SUN")!.technology.domains = { armor: 0 };
    },
  },
  {
    verb: "production_shift",
    primitive: {
      verb: "production_shift", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { equipmentType: "tanks" },
    },
  },
  {
    verb: "build_extraction",
    primitive: {
      verb: "build_extraction", sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL }, params: { resource: "coal" },
    },
    // Предпосылки стройки выполняет сценарий, и одна из них показательна:
    // мощности фикстуры стоят на ПОТОЛКЕ — ровно как все 2055 пар (регион,
    // ресурс) с депозитом в поставляемом сценарии 1946 (`docs/TODO.md`).
    // Опустить уровень приходится руками, иначе глагол честно отклоняется
    // кодом `extractionAtMaximum` и палитре нечего проверять.
    setup: state => {
      const region = state.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
      region.deposits = { ...region.deposits, coal: 1 };
      region.extraction = { ...region.extraction, coal: 0 };
      state.countries.find(c => c.id === "SUN")!.economy.treasury = 1e12;
    },
  },
];

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
    expect(promptTextOf(result.rejected[0]!)).toMatch(/distance/i);
    expect(state.groupImpactMemory).toHaveLength(0);
  });

  it("без указания группы не проходит СХЕМУ — до движка такой примитив не доезжает", () => {
    // С Милстоуна 1 обязательность группы держит форма глагола, а не
    // предпосылка движка: `incite_unrest` объявлен с целью
    // `{regionId, groupId}`, и запись без группы отклоняется раньше — там же,
    // где отклоняется чужое поле. Проверять это применением батча больше
    // нельзя: такой литерал не компилируется, что и есть смысл правки.
    const parsed = parsePrimitives([
      { verb: "incite_unrest", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL } },
    ]);
    expect(parsed.primitives).toHaveLength(0);
    expect(parsed.invalid[0]!.verb).toBe("incite_unrest");
    expect(parsed.invalid[0]!.reason).toMatch(/groupId/);
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
    expect(promptTextOf(result.rejected[0]!)).toMatch(/does not control/);
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

    // Результат описывает сдвиг целиком: ось, направление, было → стало.
    const reform = asReform(result.applied[0]!);
    expect(reform.ideologyShifts).toHaveLength(1);
    const axis = reform.ideologyShifts[0]!;
    expect(axis.axis).toBe("political");
    expect(axis.direction).toBe("democratic");
    expect(axis.before).toBeCloseTo(-0.9, 10);
    expect(axis.after).toBeCloseTo(after.politics.ideologyCoordinates!.political, 10);
    expect(axis.delta).toBeCloseTo(step, 10);

    // И политическую цену — отдельным полем, а не растворённой в одном скаляре.
    expect(reform.politicalCost.before).toBeCloseTo(supportBefore, 10);
    expect(reform.politicalCost.after).toBeCloseTo(after.politics.governmentSupport, 10);
    expect(reform.politicalCost.delta).toBeCloseTo(-ENACT_REFORM_POLITICAL_COST, 10);
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
    expect(promptTextOf(result.rejected[0]!)).toMatch(/[Gg]overnment support/);
  });

  it("отклоняется без указанного направления", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" },
    }]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/at least one direction/);
  });

  /**
   * Реформа — внутриполитический акт (docs/PRIMITIVES.md §2). До 2026-07-26
   * предпосылка отношение к цели не проверяла вовсе: `SUN` проводил реформу в
   * `USA`, координаты идеологии США уезжали, а политическая цена списывалась
   * у НИХ — то есть платил не тот, кто действует.
   */
  it("отклоняется в чужой стране — реформу нельзя провести извне", () => {
    const state = game();
    const usaBefore = structuredClone(state.countries.find(c => c.id === "USA")!.politics);

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform",
      sourceCountryId: "SUN",
      target: { countryId: "USA" },
      params: { politicalDirection: "authoritarian" },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/cannot enact a reform in/);
    // Ни координат, ни списанной поддержки — reject целиком.
    expect(state.countries.find(c => c.id === "USA")!.politics).toEqual(usaBefore);
  });

  it("цель называется явно: реформа адресуется стране-источнику", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform",
      sourceCountryId: "SUN",
      target: { countryId: "SUN" },
      params: { politicalDirection: "democratic" },
    }]);

    expect(result.rejected).toEqual([]);
    expect(asReform(result.applied[0]!).countryId).toBe("SUN");
  });

  /**
   * Достижимость сдвига (внешний аудит 2026-07-26). До правки реформа в сторону,
   * куда координата уже не движется, ПРОХОДИЛА: списывала 8 поддержки, координату
   * не меняла и сообщала «politics shifted authoritarian». Символическая реформа
   * с ценой и без эффекта нигде не заявлена как механика, поэтому выбран reject —
   * он честнее и дешевле в объяснении игроку (docs/PRIMITIVES.md §2).
   */
  it("отклоняется в недостижимом направлении — цена не списывается за несостоявшийся сдвиг", () => {
    const state = game();
    state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates =
      { economic: -0.95, political: -1 };
    const supportBefore = state.countries.find(c => c.id === "SUN")!.politics.governmentSupport;

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { politicalDirection: "authoritarian" },
    }]);

    expect(result.applied).toEqual([]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/would not move anything/);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/political axis is already at -1\.00/);

    const after = state.countries.find(c => c.id === "SUN")!.politics;
    expect(after.governmentSupport).toBe(supportBefore);
    expect(after.ideologyCoordinates).toEqual({ economic: -0.95, political: -1 });
  });

  it("реформа отклоняется целиком, если недостижима хотя бы одна из двух осей", () => {
    const state = game();
    // Экономическая ось двигаться может, политическая — уже на краю.
    state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates =
      { economic: -0.5, political: -1 };

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" },
      params: { economicDirection: "right", politicalDirection: "authoritarian" },
    }]);

    // «Полусобытий» не бывает: экономическую ось тоже не двигаем.
    expect(result.applied).toEqual([]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/political axis is already at -1\.00/);
    expect(state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates)
      .toEqual({ economic: -0.5, political: -1 });
  });

  it("противоположное направление от края спектра проходит — упёрта сторона, не ось", () => {
    const state = game();
    state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates =
      { economic: -0.95, political: -1 };

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { politicalDirection: "democratic" },
    }]);

    expect(result.rejected).toEqual([]);
    expect(asReform(result.applied[0]!).ideologyShifts[0]!.delta).toBeGreaterThan(0);
  });
});

describe("spawn_incident", () => {
  /** Доводит недовольство целевого региона выше порога восстания. */
  function boiling(): GameState {
    const state = game();
    state.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: 0.6,
    });
    expect(discontentOf(state, TEST_REGION_NATIONAL))
      .toBeGreaterThanOrEqual(SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT);
    return state;
  }

  /** Делает соседа региона чужой территорией — спорная граница появляется. */
  function withForeignNeighbour(state: GameState, ownerId = "USA"): GameState {
    state.regions.find(r => r.id === TEST_REGION_NEIGHBOUR)!.ownerCountryId = ownerId;
    return state;
  }

  it("создаёт объект на карте нужного типа в напряжённом регионе", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "spawn_incident",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL },
      params: { incidentKind: "protest" },
    }]);

    expect(result.rejected).toHaveLength(0);
    expect(state.mapFeatures).toHaveLength(1);
    expect(state.mapFeatures[0]!.type).toBe("protest");
    expect(state.mapFeatures[0]!.regionId).toBe(TEST_REGION_NATIONAL);
    // id созданного объекта — в результате: нарратив ссылается на него, а не ищет.
    expect(asIncident(result.applied[0]!).mapFeatureId).toBe(state.mapFeatures[0]!.id);
    expect(asIncident(result.applied[0]!).incidentKind).toBe("protest");
  });

  it("отклоняется в спокойном регионе — инцидент растёт из контекста, не из пустоты", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [{
      verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_CONTROL },
    }]);

    expect(result.applied).toHaveLength(0);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/below the .* threshold/);
    expect(state.mapFeatures).toHaveLength(0);
  });

  /**
   * Внешний аудит 2026-07-26: `incidentKind` использовался ТОЛЬКО при создании
   * объекта, а валидатор проверял один общий порог недовольства. На одном и том
   * же состоянии проходили все три вида с одинаковой величиной — то есть модель
   * качественным параметром превращала внутреннее напряжение в пограничный спор.
   */
  describe("вид инцидента различается предпосылками, а не только типом объекта", () => {
    it("восстание требует большего недовольства, чем протест", () => {
      const state = game();
      const discontent = discontentOf(state, TEST_REGION_NATIONAL);
      // Регион заведомо между двумя порогами — иначе тест ничего не различает.
      expect(discontent).toBeLessThan(SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT);

      const protest = applyPrimitiveBatch(game(), [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "protest" },
      }]);
      const uprising = applyPrimitiveBatch(state, [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "uprising" },
      }]);

      expect(protest.applied).toHaveLength(1);
      expect(uprising.applied).toHaveLength(0);
      expect(promptTextOf(uprising.rejected[0]!)).toMatch(/an uprising needs/);
      expect(state.mapFeatures).toHaveLength(0);
    });

    it("восстание проходит в кипящем регионе", () => {
      const state = boiling();

      const result = applyPrimitiveBatch(state, [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "uprising" },
      }]);

      expect(result.rejected).toEqual([]);
      expect(state.mapFeatures[0]!.type).toBe("uprising");
    });

    it("пограничный спор отклоняется там, где спорной границы нет", () => {
      // Оба соседних региона фикстуры принадлежат SUN — спорить не с кем,
      // при том что недовольства на протест хватает.
      const state = game();

      const result = applyPrimitiveBatch(state, [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "border_dispute" },
      }]);

      expect(result.applied).toEqual([]);
      expect(promptTextOf(result.rejected[0]!)).toMatch(/no border a dispute could be about/);
      expect(state.mapFeatures).toHaveLength(0);
    });

    it("пограничный спор проходит у чужой границы и называет вторую сторону", () => {
      const state = withForeignNeighbour(game());

      const result = applyPrimitiveBatch(state, [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "border_dispute" },
      }]);

      expect(result.rejected).toEqual([]);
      const incident = asIncident(result.applied[0]!);
      expect(incident.disputedWithCountryId).toBe("USA");
      expect(incident.summary).toContain("against USA");
    });

    it("пограничный спор с союзником отклоняется — граница есть, спор бессмысленен", () => {
      const state = withForeignNeighbour(game());
      state.countries.find(c => c.id === "SUN")!.diplomacy.allies.push("USA");

      const result = applyPrimitiveBatch(state, [{
        verb: "spawn_incident", sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "border_dispute" },
      }]);

      expect(result.applied).toEqual([]);
      expect(promptTextOf(result.rejected[0]!)).toMatch(/by an ally/);
    });

    /**
     * Мерка союзничества у предпосылки — ТА ЖЕ, что у дипломатии: попарный
     * `allianceThreshold`, а не плоские `ALLY_RELATION_THRESHOLD`, стоявшие
     * здесь до 2026-08-09.
     *
     * Проверяется СВОЙСТВО, а не число: одно и то же значение отношений судится
     * по-разному в зависимости от идеологической дистанции пары. Значение взято
     * ровно на старой плоской мерке, поэтому возврат к ней ломает вторую
     * половину теста — распознать пару она не способна по построению.
     *
     * Координаты антипода выведены из координат самой фикстуры зеркалом, а не
     * назначены числом: тест обязан следовать за фикстурой, а не за её снимком.
     */
    it("союзнический порог попарный: одни и те же отношения отсекают спор с родственным режимом и пропускают с антиподом", () => {
      const kindred = resolveIdeologyCoordinates(
        game().countries.find(c => c.id === "SUN")!.politics
      );
      const antipode: IdeologyCoordinates = {
        economic: -kindred.economic,
        political: -kindred.political,
      };
      const relation = ALLY_RELATION_THRESHOLD;

      // Фикстура обязана СТРАДДЛИТЬ порог, иначе обе половины теста меряют одно
      // и то же. Общего врага у пары нет — отсюда второй аргумент.
      const barFor = (c: IdeologyCoordinates): number =>
        allianceThreshold(ideologyDistance(kindred, c), 0);
      expect(barFor(kindred)).toBeLessThanOrEqual(relation);
      expect(barFor(antipode)).toBeGreaterThan(relation);

      const dispute = (coordinates: IdeologyCoordinates) => {
        const state = withForeignNeighbour(game());
        state.countries.find(c => c.id === "USA")!.politics.ideologyCoordinates = coordinates;
        state.countries.find(c => c.id === "SUN")!.diplomacy.relations["USA"] = relation;
        return applyPrimitiveBatch(state, [{
          verb: "spawn_incident", sourceCountryId: "SUN",
          target: { regionId: TEST_REGION_NATIONAL }, params: { incidentKind: "border_dispute" },
        }]);
      };

      // Родственный режим при таких отношениях уже союзник — спорить не о чем.
      const withKindred = dispute(kindred);
      expect(withKindred.applied).toEqual([]);
      expect(promptTextOf(withKindred.rejected[0]!)).toMatch(/by an ally/);

      // Антипод при ТЕХ ЖЕ отношениях союзником ещё не считается — спор осмыслен.
      const withAntipode = dispute(antipode);
      expect(withAntipode.rejected).toEqual([]);
      expect(asIncident(withAntipode.applied[0]!).disputedWithCountryId).toBe("USA");
    });

    /**
     * Порог восстания обязан быть ДОСТИЖИМ в реальном сценарии, иначе вид
     * `uprising` просто мёртв, — и не должен быть доступен ПОВСЕМЕСТНО, иначе
     * он выдаётся «за так».
     *
     * ФОРМУЛИРОВКА ИЗМЕНЕНА 2026-07-27, решение пользователя. Прежняя редакция
     * требовала «недоступно НИ В ОДНОМ регионе» и держалась на том, что мир был
     * размечен на 1%: четырнадцать регионов с пиком 0.6320 при пороге 0.65.
     * Расширение разметки до 504 регионов вывело Южный Сахалин (55% японского
     * населения под советской властью) на 0.6716 — и это не дефект данных, а
     * историчная горячая точка. Требование «нигде» было отпечатком бедного
     * датасета, а не свойством механики: в реальном 1946 во Вьетнаме и
     * Индонезии уже шли бои.
     *
     * Что охраняется теперь: горячих точек — ЕДИНИЦЫ, доля от размеченного
     * мира, а не абсолютное число (иначе следующее расширение датасета снова
     * сделает тест ложным). Список печатается в сообщении об ошибке, поэтому
     * молча открыть десять точек нельзя — падение назовёт каждую.
     *
     * Порог 0.65 при этом НЕ двигался: он остаётся плейсхолдером под калибровку
     * (`shared/src/defines/discontent.ts`), и подгонять его под данные значило бы
     * повторять ту же ошибку с другой стороны.
     */
    it("на данных 1946 восстание доступно лишь в единичных горячих точках, а обычный регион подводится цепочкой", () => {
      /** Все регионы, у которых недовольство вообще определено (есть демо-разметка). */
      const scored = (state: GameState) =>
        state.regions
          .map(r => ({ id: r.id, discontent: regionDiscontent(state, r) }))
          .filter((r): r is { id: number; discontent: number } => r.discontent !== undefined);

      const alone = createGame("1946", "SUN", "ru", 1);
      const annotated = scored(alone);
      // Пустой список молча выполнил бы любое утверждение о доле.
      expect(annotated.length).toBeGreaterThan(0);

      const hot = annotated
        .filter(r => r.discontent >= SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT)
        .sort((a, b) => b.discontent - a.discontent);
      /** Доля, а не число: кап обязан пережить расширение разметки. */
      const hotCap = Math.max(1, Math.ceil(annotated.length * 0.02));
      expect(
        hot.length,
        `горячих точек ${hot.length} при капе ${hotCap} из ${annotated.length} размеченных: ` +
          hot.map(r => `${r.id} (${r.discontent.toFixed(4)})`).join(", ")
      ).toBeLessThanOrEqual(hotCap);

      // Обычный регион — самый напряжённый из ХОЛОДНЫХ: именно на нём проверяется,
      // что без подготовки восстание не выдаётся, а цепочка §4 к нему подводит.
      const cold = annotated.filter(r => r.discontent < SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT);
      expect(cold.length).toBeGreaterThan(0);
      const peak = cold.reduce((a, b) => (b.discontent > a.discontent ? b : a));

      const straight = applyPrimitiveBatch(alone, [{
        verb: "spawn_incident", sourceCountryId: "USA",
        target: { regionId: peak.id }, params: { incidentKind: "uprising" },
      }]);
      expect(straight.applied).toEqual([]);
      expect(promptTextOf(straight.rejected[0]!)).toMatch(/an uprising needs/);

      // Цепочка §4 подводит мир к восстанию там же, где он к нему ближе всего.
      const chained = createGame("1946", "SUN", "ru", 1);
      const peakRegion = chained.regions.find(r => r.id === peak.id)!;
      const dominant = [...peakRegion.demographics!].sort((a, b) => b.share - a.share)[0]!.groupId;
      const result = applyPrimitiveBatch(chained, [
        {
          verb: "incite_unrest", sourceCountryId: "USA",
          target: { regionId: peak.id, groupId: dominant }, params: { intensity: "severe" },
        },
        {
          verb: "spawn_incident", sourceCountryId: "USA",
          target: { regionId: peak.id }, params: { incidentKind: "uprising" },
        },
      ]);

      expect(result.rejected).toEqual([]);
      expect(result.applied.map(a => a.verb)).toEqual(["incite_unrest", "spawn_incident"]);
      expect(regionDiscontent(chained, peakRegion)!)
        .toBeGreaterThanOrEqual(SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT);
    });

    /**
     * Вторая половина того же свойства: горячая точка — исключение, а не
     * правило. Без этой проверки кап из теста выше выполнялся бы и в мире, где
     * восстание недоступно вообще нигде, то есть охранял бы только одну
     * границу из двух.
     */
    it("горячая точка остаётся исключением: подавляющее большинство регионов к восстанию не готово", () => {
      const game = createGame("1946", "SUN", "ru", 1);
      const scored = game.regions
        .map(r => regionDiscontent(game, r))
        .filter((d): d is number => d !== undefined);
      expect(scored.length).toBeGreaterThan(0);

      const ready = scored.filter(d => d >= SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT).length;
      expect(ready / scored.length).toBeLessThan(0.05);
    });

    it("вид не заявлен — протест: самый слабый вид, а не самый удобный", () => {
      const result = applyPrimitiveBatch(game(), [{
        verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
      }]);

      expect(asIncident(result.applied[0]!).incidentKind).toBe("protest");
      expect(asIncident(result.applied[0]!).disputedWithCountryId).toBeUndefined();
    });
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
    // Бюджет хода отклонённым примитивом не тратится — счётчики обязаны
    // остаться нулевыми, а не просто «примерно теми же».
    expect(state.primitiveTurnBudget).toEqual(snapshot.primitiveTurnBudget);
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

  it("структурный примитив исполняется последним, каким бы ни был порядок в ответе", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      { verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" }, params: { politicalDirection: "democratic" } },
      inciteTitular,
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied.map(a => a.verb)).toEqual(["incite_unrest", "enact_reform"]);
  });

  /**
   * Отказ структурного примитива отклоняет ВЕСЬ батч (docs/PRIMITIVES.md §3,
   * «структурные — весь ответ reject»; найдено внешним аудитом 2026-07-26).
   *
   * До правки движок делал ровно обратное: структурный валидируется последним,
   * поэтому мягкие того же ответа уже лежали на клоне и коммитились вместе с
   * ним. Ответ «поднять волнения + провести реформу» применял волнения и
   * оставлял мир в состоянии, которого модель не предлагала.
   */
  describe("отказ структурного примитива отклоняет весь батч", () => {
    /** Реформа без направления — отказ на предпосылке, а не на капе. */
    const invalidReform: Primitive = {
      verb: "enact_reform",
      sourceCountryId: "SUN",
      target: { countryId: "SUN" },
    };

    it("валидный мягкий примитив рядом с невалидным структурным не применяется", () => {
      const state = game();
      const before = structuredClone(state);

      const result = applyPrimitiveBatch(state, [inciteTitular, invalidReform]);

      expect(result.applied).toEqual([]);
      // Мир не тронут ВООБЩЕ: сравнение по полному снимку, а не по одному полю,
      // — «полусобытия» не бывает ни в одном канале состояния.
      expect({ ...state, pendingWorldFacts: [], primitiveTurnBudget: before.primitiveTurnBudget })
        .toEqual({ ...before, pendingWorldFacts: [] });

      // Причина отказа мягкого называет виновника, а не выглядит его
      // собственной ошибкой: модель обязана чинить структурный, а не волнения.
      const rolledBack = result.rejected.find(r => r.verb === "incite_unrest")!;
      expect(promptTextOf(rolledBack)).toMatch(/Rolled back: the structural enact_reform/);
      expect(promptTextOf(result.rejected.find(r => r.verb === "enact_reform")!))
        .toMatch(/at least one direction/);
    });

    it("ход не списан: слот структурного и цель мягкого свободны после отката", () => {
      const state = game();
      applyPrimitiveBatch(state, [inciteTitular, invalidReform]);

      // Бюджет остался пустым — тратит только ПРИМЕНЁННЫЙ примитив, а после
      // отката применённых нет ни одного.
      expect(state.primitiveTurnBudget.softUsed).toBe(0);
      expect(state.primitiveTurnBudget.structuralUsed).toBe(0);
      expect(state.primitiveTurnBudget.targetUses).toEqual({});

      // И это проверяемо поведением, а не только числом: тот же мягкий
      // примитив следом проходит, хотя цель «уже была занята» в откаченном батче.
      const retry = applyPrimitiveBatch(state, [inciteTitular]);
      expect(retry.applied).toHaveLength(1);
    });

    it("второй структурный, отклонённый капом хода, уносит батч так же", () => {
      // Цена решения, названная тестом: отказ по КАПУ — не ошибка формы, но
      // «весь ответ reject» действует и здесь, без оговорок.
      const state = game();

      const result = applyPrimitiveBatch(state, [
        { verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" }, params: { politicalDirection: "democratic" } },
        { verb: "enact_reform", sourceCountryId: "SUN", target: { countryId: "SUN" }, params: { economicDirection: "right" } },
        inciteTitular,
      ]);

      expect(result.applied).toEqual([]);
      expect(result.rejected.some(r =>
        new RegExp(`At most ${MAX_STRUCTURAL_PRIMITIVES_PER_TURN} structural`).test(promptTextOf(r))
      )).toBe(true);
      // Откачены обе половины уже применённого: и мягкий, и первый структурный.
      expect(result.rejected.filter(r => /^Rolled back/.test(promptTextOf(r))).map(r => r.verb).sort())
        .toEqual(["enact_reform", "incite_unrest"]);
    });
  });

  it("одна цель — один verb за ход: батч из десяти одинаковых применяет один", () => {
    const state = game();
    const spam: Primitive[] = Array.from({ length: 10 }, () => ({
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
      params: { intensity: "mild" },
    }));

    const result = applyPrimitiveBatch(state, spam);

    // Бюджет мягких примитивов (10) батч не превышает — значит, отсекает именно
    // кап на цель, а не общий лимит.
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(9);
    for (const rejection of result.rejected) {
      expect(promptTextOf(rejection)).toMatch(/per target per turn/);
      // Диагностика называет саму цель, а не только факт дубля, — и называет её
      // ЧЕЛОВЕЧЕСКИМ именем: та же причина уходит игроку, а сырой `lithuanians`
      // рядом с локализованным именем региона выдавал идентификатор кода за имя
      // (docs/PRIMITIVES.md §3, Милстоун 1).
      expect(promptTextOf(rejection)).toContain(`region ${TEST_REGION_NATIONAL}`);
      expect(promptTextOf(rejection)).toContain(titularName(state));
      expect(promptTextOf(rejection)).not.toContain(TEST_GROUP_TITULAR);
    }

    // И главное: поле памяти получило ровно один удар, а не десять. Именно так
    // обходился коридор магнитуды — не величиной, а частотой.
    const single = game();
    applyPrimitiveBatch(single, [spam[0]!]);
    expect(memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression)
      .toBeCloseTo(memoryOf(single, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression, 12);
  });

  it("тот же verb по РАЗНЫМ целям проходит целиком — кап не запрещает законное", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      // Разные группы в одном регионе — разные цели.
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_LOYAL } },
      // Та же группа в соседнем регионе — тоже другая цель.
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NEIGHBOUR, groupId: TEST_GROUP_TITULAR } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(3);
  });

  it("РАЗНЫЕ глаголы по одной цели проходят — кап считает пары «глагол + цель»", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { verb: "grant_autonomy", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { ...inciteTitular },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(3);
  });

  it("приказ по региону занимает цели всех его групп — точечный дубль следом отклоняется", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      // Без названной группы repress бьёт по ВСЕМ группам региона…
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
      // …поэтому точечный удар по одной из них — второй удар по той же паре.
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(promptTextOf(result.rejected[0]!)).toContain(titularName(state));
  });

  it("цель занимает только ПРИМЕНЁННЫЙ примитив — откаченный её не запирает", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      // Первый отклоняется на предпосылке (нет контроля) — цель остаётся свободной.
      { verb: "repress", sourceCountryId: "USA", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
    ]);

    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    // Причина — настоящая (нет контроля), а не «дубль»: невозможный примитив не
    // должен маскировать свою диагностику капом.
    expect(promptTextOf(result.rejected[0]!)).toMatch(/does not control/);
  });

  it("кап накопления не мешает законным комбинациям по разным полям и парам", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      // Разные поля одной пары: подавление+отчуждение, уступка, смелость.
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { verb: "grant_autonomy", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_LOYAL } },
      { ...inciteTitular },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(3);
  });

  /**
   * Документированная §4 цепочка «`incite_unrest` → `spawn_incident`»: два
   * РАЗНЫХ глагола пишут в одно поле одной пары (инцидент бьёт по доминанту
   * региона, а он же и подстрекаемый). Кап накопления считает величину, а не
   * число примитивов, поэтому цепочка проходит целиком — сумма помещается в
   * коридор поля. Кап, ключуемый парой «цель + поле», отсекал бы её.
   */
  it("цепочка incite_unrest → spawn_incident по одной группе остаётся законной", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      { ...inciteTitular, params: { intensity: "severe" } },
      { verb: "spawn_incident", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied.map(a => a.verb)).toEqual(["incite_unrest", "spawn_incident"]);
    expect(memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.emboldenment)
      .toBeLessThanOrEqual(IMPACT_FIELD_TURN_CEILING.emboldenment);
  });

  it("уступки в двух соседних регионах проходят обе — побочка не запирает цель", () => {
    const state = game();

    const result = applyPrimitiveBatch(state, [
      { verb: "grant_autonomy", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR } },
      { verb: "grant_autonomy", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NEIGHBOUR, groupId: TEST_GROUP_TITULAR } },
    ]);

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
    // Каждый регион получил и свою уступку, и отклик на уступку соседа.
    for (const regionId of [TEST_REGION_NATIONAL, TEST_REGION_NEIGHBOUR]) {
      const memory = memoryOf(state, regionId, TEST_GROUP_TITULAR)!;
      expect(memory.concession).toBeGreaterThan(0);
      expect(memory.emboldenment).toBeGreaterThan(0);
    }
  });

  it("уступка группе с полем на потолке не поднимает соседей вовсе", () => {
    const state = game();
    state.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0,
      alienation: 0,
      concession: 1,
      emboldenment: 0,
    });

    const result = applyPrimitiveBatch(state, [{
      verb: "grant_autonomy",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    }]);

    // Фактически не дали ничего — и отклик соседей обязан это отражать, а не
    // выдавать пол коридора за жест, которого не было.
    const autonomy = asAutonomy(result.applied[0]!);
    expect(deltaFor(autonomy, TEST_GROUP_TITULAR, "concession")).toBe(0);
    expect(autonomy.neighbourEffects).toEqual([]);
    expect(memoryOf(state, TEST_REGION_NEIGHBOUR, TEST_GROUP_TITULAR)).toBeUndefined();
    // И резюме молчит о соседях, вместо прежнего безусловного «took heart».
    expect(autonomy.summary).not.toMatch(/took heart|responded/);
    expect(autonomy.summary).toMatch(/no kindred community in neighbouring regions moved/);
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

/**
 * Третий обход коридора магнитуды (найден ревью 2026-07-26): не величиной и не
 * повтором одного примитива по одной цели, а СХОДИМОСТЬЮ побочных эффектов.
 *
 * Отклик соседей у `grant_autonomy` намеренно не входит в ключи капа «один verb
 * на цель за ход» — иначе уступка в двух соседних регионах стала бы
 * невозможной. Но на кольце «хаб + N со-этнических соседей» каждая уступка —
 * отдельная законная цель, счётчик не срабатывает ни разу, а все записи
 * сходятся в ОДНУ пару (регион, группа) и упирают её в потолок 1.0.
 *
 * До правки: синтетическое кольцо давало ровно 1.0 и на 5 × `severe`, и на
 * 10 × `mild` (хинт переставал влиять — канал соседей его не принимает);
 * реальное кольцо вокруг региона 192 сценария 1946 — 0.738 при `severe` и
 * 0.613 при `mild`, тогда как сильнейший ОДИНОЧНЫЙ примитив по этому полю
 * (`incite_unrest(severe)`) даёт там 0.20.
 */
/** Локализованное имя титульной группы — то, что попадает в причину отказа. */
function titularName(state: GameState): string {
  return getText(state.ethnicGroups.find(g => g.id === TEST_GROUP_TITULAR)!.names, LLM_LOCALE);
}

describe("кольцо соседей: побочный эффект не обходит коридор частотой", () => {
  const RING_HUB = 900;
  const RING_SHARE = 0.88;

  function ringRegion(id: number, neighbours: number[]): ReturnType<typeof createTestRegion> {
    return createTestRegion({
      id,
      geoJsonId: `TEST-${id}`,
      names: { en: `Ring region ${id}` },
      ownerCountryId: "SUN",
      population: 1_000_000,
      gdp: 400_000_000,
      landNeighboringRegionIds: neighbours,
      demographics: [
        { groupId: TEST_GROUP_TITULAR, share: RING_SHARE },
        { groupId: TEST_GROUP_LOYAL, share: 1 - RING_SHARE },
      ],
    });
  }

  /** Хаб и `spokes` соседей: каждая уступка соседу отзывается в хабе. */
  function ringGame(spokes: number): { state: GameState; spokeIds: number[] } {
    const state = game();
    const spokeIds = Array.from({ length: spokes }, (_, i) => RING_HUB + 1 + i);
    state.regions.push(ringRegion(RING_HUB, spokeIds));
    for (const id of spokeIds) state.regions.push(ringRegion(id, [RING_HUB]));
    return { state, spokeIds };
  }

  const RINGS = [
    { spokes: 5, intensity: "severe" as const },
    { spokes: 10, intensity: "mild" as const },
  ];

  it.each(RINGS)(
    "синтетическое кольцо: $spokes × grant_autonomy($intensity) не доводит хаб до потолка",
    ({ spokes, intensity }) => {
      const { state, spokeIds } = ringGame(spokes);

      const result = applyPrimitiveBatch(
        state,
        spokeIds.map((regionId): Primitive => ({
          verb: "grant_autonomy",
          sourceCountryId: "SUN",
          target: { regionId, groupId: TEST_GROUP_TITULAR },
          params: { intensity },
        }))
      );

      const hub = memoryOf(state, RING_HUB, TEST_GROUP_TITULAR)!;
      expect(hub.emboldenment).toBeLessThanOrEqual(IMPACT_FIELD_TURN_CEILING.emboldenment);
      // Хотя бы одна уступка обязана пройти: кап режет накопление, а не глагол.
      expect(result.applied.length).toBeGreaterThan(0);
      expect(result.rejected.length).toBeGreaterThan(0);
      for (const rejection of result.rejected) {
        expect(promptTextOf(rejection)).toMatch(/Turn impact ceiling/);
        expect(promptTextOf(rejection)).toContain(`region ${RING_HUB}`);
      }
    }
  );

  /**
   * То же кольцо, но не синтетическое: в сценарии 1946 берётся настоящий
   * регион СССР, у которого не меньше пяти соседей с группой `russians`.
   *
   * Хаб ищется ПО СВОЙСТВУ, а не по числовому id (был литерал 192 —
   * латвийский Земгале). Позиционный `id` сдвигается при любом изменении
   * числа регионов где угодно раньше по порядку сборки: 2026-08-08 сборка
   * мира сдвинула Земгале на 190, а на 192 оказалось Монако — тест упал,
   * и правильно. Литерал чинить литералом бессмысленно, он протухнет снова.
   */
  it("реальное кольцо соседей (сценарий 1946) не доводит хаб до потолка", () => {
    const GROUP = "russians";
    const state = createGame("1946", "SUN", "ru", 1);

    const hasGroup = (id: number) =>
      state.regions.find(r => r.id === id)?.demographics?.some(d => d.groupId === GROUP);
    const hub = state.regions.find(
      r => r.ownerCountryId === "SUN" && r.landNeighboringRegionIds.filter(hasGroup).length >= 5
    );
    // Если разметка датасета поедет, тест обязан сказать об этом, а не тихо
    // проверять пустой батч: такого хаба в сценарии 1946 обязано существовать.
    expect(hub).toBeDefined();
    const HUB_ID = hub!.id;
    const ring = hub!.landNeighboringRegionIds.filter(hasGroup);
    expect(ring.length).toBeGreaterThanOrEqual(5);

    const result = applyPrimitiveBatch(
      state,
      ring.map((regionId): Primitive => ({
        verb: "grant_autonomy",
        sourceCountryId: "SUN",
        target: { regionId, groupId: GROUP },
        params: { intensity: "severe" },
      }))
    );

    const memory = memoryOf(state, HUB_ID, GROUP)!;
    expect(memory.emboldenment).toBeLessThanOrEqual(IMPACT_FIELD_TURN_CEILING.emboldenment);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/Turn impact ceiling/);
  });

  it("кап накопления держится и при смягчении капа «verb на цель»", () => {
    // Тот же обход в другой форме: один и тот же глагол по одной паре, но
    // счётчик целей не тронут — режет только накопление. Проверяется прямым
    // вызовом бюджета через ДВА разных глагола, пишущих одно поле одной пары.
    const { state, spokeIds } = ringGame(3);
    const batch: Primitive[] = [
      ...spokeIds.map((regionId): Primitive => ({
        verb: "grant_autonomy",
        sourceCountryId: "SUN",
        target: { regionId, groupId: TEST_GROUP_TITULAR },
        params: { intensity: "severe" },
      })),
      {
        verb: "incite_unrest",
        sourceCountryId: "USA",
        target: { regionId: RING_HUB, groupId: TEST_GROUP_TITULAR },
        params: { intensity: "severe" },
      },
    ];

    applyPrimitiveBatch(state, batch);

    // Складываются эффекты РАЗНЫХ глаголов — прямой и побочный, — и сумма всё
    // равно остаётся в коридоре поля.
    expect(memoryOf(state, RING_HUB, TEST_GROUP_TITULAR)!.emboldenment)
      .toBeLessThanOrEqual(IMPACT_FIELD_TURN_CEILING.emboldenment);
  });
});

describe("палитра эффектов (docs/PRIMITIVES.md §3, защита №3)", () => {
  it("сценарий покрывает каждый verb алфавита — новый глагол не проскочит мимо проверки", () => {
    expect(SCENARIOS.map(s => s.verb).sort()).toEqual([...PRIMITIVE_VERBS].sort());
  });

  it.each(SCENARIOS)("$verb меняет только задекларированные пути состояния", ({ verb, primitive, setup }) => {
    const state = game();
    setup?.(state);
    const before = structuredClone(state);

    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.applied).toHaveLength(1);

    // Диагностика отказов и бухгалтерия хода — не эффекты примитива, палитра
    // их не описывает (обе пишутся границей хода после commit'а).
    state.pendingWorldFacts = before.pendingWorldFacts;
    state.primitiveTurnBudget = before.primitiveTurnBudget;

    const changed = collectChangedPaths(before, state);
    expect(changed.length).toBeGreaterThan(0);
    // Сверяется ТЕМ ЖЕ матчером, каким палитру проверяет движок, а не
    // строковым равенством (исправлено Милстоуном 1). Прежнее `includes`
    // работало лишь потому, что ни один из шести глаголов не писал в словари:
    // запись-шаблон `relations.{*}` дословному сравнению не равна никогда, и
    // первый же дипломатический глагол валил бы тест на разнице между
    // проверкой и её имитацией.
    expect(
      changed.filter(p => !PRIMITIVE_PALETTE[verb].some(entry => pathMatchesPaletteEntry(entry, p)))
    ).toEqual([]);
  });

  it("рантайм-проверка кусается: эффект вне палитры откатывает примитив целиком", () => {
    const state = game();
    const original = PRIMITIVE_PALETTE.repress;
    // Сужаем палитру так, что законный эффект перестаёт быть законным —
    // движок обязан откатить примитив, а не применить его «почти».
    // Пустая палитра: законный эффект перестаёт быть законным целиком, включая
    // само появление записи памяти.
    (PRIMITIVE_PALETTE as Record<PrimitiveVerb, readonly string[]>).repress = [];

    try {
      const result = applyPrimitiveBatch(state, [{
        verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
      }]);

      expect(result.applied).toHaveLength(0);
      expect(promptTextOf(result.rejected[0]!)).toMatch(/outside the repress palette/);
      expect(state.groupImpactMemory).toHaveLength(0);
    } finally {
      (PRIMITIVE_PALETTE as Record<PrimitiveVerb, readonly string[]>).repress = original;
    }
  });
});

describe("диагностика отказов ограничена сверху (docs/PRIMITIVES.md §4)", () => {
  /** Отказ на предпосылке: USA регионом не владеет. */
  const impossible: Primitive = {
    verb: "repress",
    sourceCountryId: "USA",
    target: { regionId: TEST_REGION_NATIONAL },
  };

  function rejectionFacts(state: GameState) {
    return state.pendingWorldFacts.filter(f => f.kind === "primitive_rejected");
  }

  it("подробных записей не больше капа, а хвост назван одной строкой", () => {
    // Факты вычищаются только генерацией промта, а пишутся на каждый отказ:
    // без капа 50 отклонённых приказов раздували следующий промт с 13 118 до
    // 41 086 символов (замер ревью 2026-07-26).
    const state = game();
    for (let i = 0; i < MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 9; i++) {
      applyPrimitiveBatch(state, [impossible]);
    }

    const facts = rejectionFacts(state);
    expect(facts).toHaveLength(MAX_PENDING_REJECTION_FACTS_PER_SOURCE + 1);
    expect(
      facts.slice(0, MAX_PENDING_REJECTION_FACTS_PER_SOURCE).every(f => f.text.startsWith("Attempt rejected"))
    ).toBe(true);
    // Хвост не замалчивается (иначе читалось бы как «отказов ровно столько»),
    // но и не копится: одна строка на любое число сверх капа.
    expect(facts.at(-1)!.text).toContain("further rejected player attempts are not listed");
  });

  it("полный законный ход помещается в подробные записи целиком", () => {
    // Кап выведен из капов хода, а не выбран: столько отказов даёт один ход,
    // отклонённый до последнего примитива. Резать диагностику здесь нечего.
    const state = game();
    applyPrimitiveBatch(
      state,
      Array.from({ length: MAX_PENDING_REJECTION_FACTS_PER_SOURCE }, () => impossible)
    );

    const facts = rejectionFacts(state);
    expect(facts).toHaveLength(MAX_PENDING_REJECTION_FACTS_PER_SOURCE);
    expect(facts.every(f => f.text.startsWith("Attempt rejected"))).toBe(true);
  });

  it("длина ОДНОЙ записи ограничена, и обрезка помечена", () => {
    // Вторая половина границы секции. Кап ЧИСЛА записей её не давал: причина
    // отказа собирается и из НЕИЗВЕСТНЫХ полей — `.strict()` называет
    // нераспознанный ключ, а имена ключей в теле запроса не ограничены ничем.
    const state = game();
    pushRejectionFact(state, "primitive_rejected", {
      countryId: "USA",
      text: `Attempt rejected (repress): ${"y".repeat(MAX_REJECTION_FACT_LENGTH * 3)}`,
    });

    const fact = rejectionFacts(state)[0]!;
    expect(fact.text).toHaveLength(MAX_REJECTION_FACT_LENGTH);
    // Метка обязательна: молча обрезанная причина читается моделью как полная,
    // и она чинит названную часть примитива, не узнав про неназванную.
    expect(fact.text.endsWith("… (truncated)")).toBe(true);
  });

  it("причина ПОД капом не трогается: граница выше диагностики, а не поперёк неё", () => {
    const state = game();
    const intact = `Attempt rejected (repress): ${"y".repeat(MAX_REJECTION_FACT_LENGTH - 40)}`;
    expect(intact.length).toBeLessThanOrEqual(MAX_REJECTION_FACT_LENGTH);

    pushRejectionFact(state, "primitive_rejected", { countryId: "USA", text: intact });

    expect(rejectionFacts(state)[0]!.text).toBe(intact);
  });

  it("идентификатор сверх границы длины схему не проходит", () => {
    const overLong = {
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: "x".repeat(MAX_PRIMITIVE_ID_LENGTH + 1) },
    };
    expect(primitiveSchema.safeParse(overLong).success).toBe(false);

    // …а живой идентификатор сценария проходит: граница выше данных, а не под них.
    expect(
      primitiveSchema.safeParse({
        verb: "repress",
        sourceCountryId: "SUN",
        target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
      }).success
    ).toBe(true);
  });
});

/**
 * Числовые листья ветки `params` — обходом фактического Zod-узла, а не
 * перечислением полей руками (docs/TODO.md, «хвосты Милстоуна 1»: прежний
 * тест проверял ровно один `params` из восемнадцати).
 *
 * Незнакомый узел — СТОП, а не молчаливый пропуск: тот же принцип, что у
 * `outsideCellReconciliation` в `milestone1Contracts.test.ts` («классификация,
 * а не фильтр»). Список контейнеров и терминалов ниже — фактическое устройство
 * сегодняшних `params`-схем (`primitiveSchemas.ts`): `.optional()` вокруг
 * объекта, поля — строки/перечисления/литералы. Схема заведёт узел, которого
 * здесь нет (`z.record`, `z.union` и т.п.), — обход бросит исключение вместо
 * того, чтобы тихо признать его «не числом».
 */
const TERMINAL_NON_NUMERIC_ZOD_NODES = new Set([
  "string", "boolean", "bigint", "date", "literal", "enum", "nan",
  "undefined", "null", "void", "any", "unknown", "never",
]);

function numericParamPaths(schema: z.ZodTypeAny, path: readonly string[] = []): string[] {
  const nodeType = (schema as unknown as { def: { type: string } }).def.type;
  const at = path.join(".") || "(params)";

  if (nodeType === "number") return [at];

  if (nodeType === "optional" || nodeType === "nullable" || nodeType === "default") {
    const inner = (schema as unknown as { unwrap(): z.ZodTypeAny }).unwrap();
    return numericParamPaths(inner, path);
  }

  if (nodeType === "object") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    return Object.entries(shape).flatMap(([key, value]) =>
      numericParamPaths(value as z.ZodTypeAny, [...path, key])
    );
  }

  if (nodeType === "array") {
    const element = (schema as unknown as { def: { element: z.ZodTypeAny } }).def.element;
    return numericParamPaths(element, [...path, "[]"]);
  }

  if (TERMINAL_NON_NUMERIC_ZOD_NODES.has(nodeType)) return [];

  throw new Error(
    `numericParamPaths: неклассифицированный узел Zod "${nodeType}" на ${at} — ` +
    "классифицируй явно (числовой лист / контейнер / точно не число), не фильтруй молча."
  );
}

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

  it("ни одна ветка params ни одного глагола алфавита не несёт числового поля", () => {
    // Обход РЕЕСТРА, а не список глаголов руками: `PRIMITIVE_SCHEMAS` —
    // `Record<PrimitiveVerb, …>` (проверено тестом «реестр схем покрывает весь
    // алфавит», `milestone1Contracts.test.ts`), поэтому глагол, добавленный в
    // алфавит и забытый в реестре, не компилируется ещё до этого теста. Обход
    // здесь идёт по фактическим ЗАПИСЯМ реестра — новый глагол алфавита
    // попадает под проверку сам, без правки этого файла.
    const offenders = Object.entries(PRIMITIVE_SCHEMAS).flatMap(([verb, schema]) => {
      const paramsField = (schema as z.ZodObject<z.ZodRawShape>).shape.params;
      return numericParamPaths(paramsField as z.ZodTypeAny).map(path => `${verb}.params.${path}`);
    });

    expect(offenders).toEqual([]);
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

    expect(totalDelta(result.applied[0]!, "suppression")).toBeGreaterThan(0);
  });

  /**
   * «Числа правдивые, не выдуманные» (docs/PRIMITIVES.md §4) — в том числе на
   * насыщенном поле. Движок обязан отчитываться тем, что ЛЕГЛО, а не тем, что
   * посчитала фаза Compute: по этому числу сессия B будет писать нарратив.
   */
  it("на насыщенном поле магнитуда — фактическая дельта, а не посчитанная", () => {
    const saturated = game();
    saturated.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 0.98,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });
    const repressTitular: Primitive = {
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    };

    const fresh = game();
    const intended = deltaFor(
      applyPrimitiveBatch(fresh, [repressTitular]).applied[0]!, TEST_GROUP_TITULAR, "suppression"
    );
    const result = applyPrimitiveBatch(saturated, [repressTitular]);

    // Компьют посчитал бы то же самое, что и на чистом поле…
    expect(intended).toBeGreaterThan(0.1);
    // …но прижилось ровно 0.02 до потолка, и отчитаться движок обязан этим.
    const applied = result.applied[0]!;
    expect(deltaFor(applied, TEST_GROUP_TITULAR, "suppression")).toBeCloseTo(0.02, 10);
    // Пара «было → стало» тоже настоящая: по ней нарратив скажет «дошло до потолка».
    const suppression = impactEffectsOf(applied).find(e => e.field === "suppression")!;
    expect(suppression.before).toBeCloseTo(0.98, 10);
    expect(suppression.after).toBeCloseTo(1, 10);
    expect(memoryOf(saturated, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.suppression)
      .toBeCloseTo(1, 10);
  });

  /**
   * Скрытых эффектов не бывает (внешний аудит 2026-07-26).
   *
   * Прежняя формулировка этого теста ЗАКРЕПЛЯЛА дефект как ожидаемое поведение:
   * она проверяла, что при `magnitude === 0` отчуждение всё равно набралось, —
   * то есть что примитив изменил состояние мимо публикуемого результата. Теперь
   * требование обратное: всё, что применилось, обязано быть в результате, и
   * нулевой канал обязан быть назван нулевым, а не замолчан.
   */
  it("подавление на потолке: ноль назван нулём, а отчуждение — не спрятано", () => {
    const state = game();
    state.groupImpactMemory.push({
      regionId: TEST_REGION_NATIONAL,
      groupId: TEST_GROUP_TITULAR,
      suppression: 1,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    });

    const result = applyPrimitiveBatch(state, [{
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    }]);

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0]!;

    // Подавлять было уже некуда — и это сказано прямо, а не выведено из молчания.
    expect(deltaFor(applied, TEST_GROUP_TITULAR, "suppression")).toBe(0);
    expect(applied.summary).toContain("suppression unchanged");

    // Отчуждение при этом набралось — и оно в результате, с реальными числами.
    const alienation = deltaFor(applied, TEST_GROUP_TITULAR, "alienation");
    expect(alienation).toBeGreaterThan(0);
    expect(alienation)
      .toBeCloseTo(memoryOf(state, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR)!.alienation, 10);
    expect(applied.summary).toContain("alienation");
  });

  /**
   * Общее требование ко всем глаголам: множество фактических изменений памяти
   * воздействий совпадает с множеством, о котором отчитался движок. Это тот же
   * инвариант, который движок проверяет в рантайме, — но проверенный снаружи,
   * на каждом verb, а не только на том, где о нём вспомнили.
   */
  // Список глаголов ВЫВОДИТСЯ из палитры, а не перечисляется руками: глагол,
  // который пишет в память воздействий, попадает под проверку сам, а тот, что
  // не пишет (реформа, раскол), не заставляет её ждать изменений, которых по
  // контракту не будет.
  it.each(
    PRIMITIVE_VERBS.filter(v =>
      PRIMITIVE_PALETTE[v].some(path => path.startsWith("groupImpactMemory"))
    )
  )(
    "%s: отчёт покрывает каждое фактическое изменение памяти",
    (verb) => {
      const scenario = SCENARIOS.find(s => s.verb === verb)!;
      const state = game();
      scenario.setup?.(state);
      const before = structuredClone(state.groupImpactMemory);

      const result = applyPrimitiveBatch(state, [scenario.primitive]);
      expect(result.applied).toHaveLength(1);

      const actual = new Set<string>();
      for (const memory of state.groupImpactMemory) {
        const was = before.find(m => m.regionId === memory.regionId && m.groupId === memory.groupId);
        for (const field of ["suppression", "alienation", "concession", "emboldenment"] as const) {
          if (memory[field] !== (was?.[field] ?? 0)) {
            actual.add(`${memory.regionId}/${memory.groupId}/${field}`);
          }
        }
      }
      const reported = new Set(
        impactEffectsOf(result.applied[0]!)
          .filter(e => e.delta !== 0)
          .map(e => `${e.regionId}/${e.groupId}/${e.field}`)
      );

      expect(actual.size).toBeGreaterThan(0);
      expect([...reported].sort()).toEqual([...actual].sort());
    }
  );

  /**
   * Рантайм-сверка отчёта с дифом памяти обязана КУСАТЬСЯ, а не выглядеть
   * реализованной (внешнее ревью 2026-07-26: у палитры такой тест есть, у сверки
   * не было — механизм работал только на честном слове).
   *
   * Ломается командный слой, а не движок: команда применяет ровно то же, но
   * возвращает искажённый `applied`. Так дефект и выглядел бы в жизни —
   * обработчик движка честно перекладывает в результат то, что ему вернули, и
   * недоотчёта не замечает. Палитра такой случай не ловит вовсе: изменённые пути
   * состояния остаются законными.
   */
  function withDistortedImpactReport(
    distort: (applied: politicsCommands.AppliedImpact) => politicsCommands.AppliedImpact,
    body: () => void
  ): void {
    const original = politicsCommands.addGroupImpact;
    const spy = vi
      .spyOn(politicsCommands, "addGroupImpact")
      .mockImplementation((...args: Parameters<typeof politicsCommands.addGroupImpact>) => {
        const result = original(...args);
        return result.success ? { ...result, applied: distort(result.applied ?? {}) } : result;
      });
    try {
      body();
    } finally {
      spy.mockRestore();
    }
  }

  const repressRegion: Primitive = {
    verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL },
  };

  it("сверка кусается: скрытый эффект откатывает примитив целиком", () => {
    const state = game();

    withDistortedImpactReport(
      // Отчуждение применилось, но из отчёта команды выпало.
      ({ alienation: _hidden, ...rest }) => rest,
      () => {
        const result = applyPrimitiveBatch(state, [repressRegion]);

        expect(result.applied).toEqual([]);
        expect(promptTextOf(result.rejected[0]!)).toMatch(/disagrees with what it changed/);
        expect(promptTextOf(result.rejected[0]!)).toMatch(new RegExp(`impact:${TEST_REGION_NATIONAL}/[^.]+\.alienation`));
        expect(promptTextOf(result.rejected[0]!)).toMatch(/reported 0\.000, actually 0\.1/);
        // Откат целиком: применённого следа в мире не осталось.
        expect(state.groupImpactMemory).toHaveLength(0);
      }
    );
  });

  it("сверка кусается: выдуманный эффект тоже откатывает примитив целиком", () => {
    const state = game();

    withDistortedImpactReport(
      // Канал, которого команда не трогала: опубликован, но не произошёл.
      // Палитра его пропускает — `concession` у `repress` в состоянии не менялся.
      applied => ({ ...applied, concession: 0.5 }),
      () => {
        const result = applyPrimitiveBatch(state, [repressRegion]);

        expect(result.applied).toEqual([]);
        expect(promptTextOf(result.rejected[0]!)).toMatch(new RegExp(`impact:${TEST_REGION_NATIONAL}/[^.]+\.concession`));
        expect(promptTextOf(result.rejected[0]!)).toMatch(/reported 0\.500, actually 0\.000/);
        expect(state.groupImpactMemory).toHaveLength(0);
      }
    );
  });

  it("сверка кусается: подменённая величина при верном наборе ключей", () => {
    const state = game();

    withDistortedImpactReport(
      // Ключи те же, число другое — ровно та ложь, которую набор ключей не ловит.
      applied => ({ ...applied, suppression: 0.001 }),
      () => {
        const result = applyPrimitiveBatch(state, [repressRegion]);

        expect(result.applied).toEqual([]);
        expect(promptTextOf(result.rejected[0]!)).toMatch(new RegExp(`impact:${TEST_REGION_NATIONAL}/[^.]+\.suppression`));
        expect(promptTextOf(result.rejected[0]!)).toMatch(/reported 0\.001, actually 0\.[1-9]/);
        expect(state.groupImpactMemory).toHaveLength(0);
      }
    );
  });

  /**
   * «По результату можно построить правдивое описание, НЕ заглядывая в
   * состояние» — центральное требование внешнего аудита к форме результата.
   * Проверяется буквально: каждое опубликованное `after` совпадает с тем, что
   * реально лежит в мире после commit'а.
   */
  it.each(SCENARIOS)("$verb: опубликованное «стало» совпадает с состоянием мира", ({ primitive, setup }) => {
    const state = game();
    setup?.(state);
    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.applied).toHaveLength(1);
    const applied = result.applied[0]!;

    for (const effect of impactEffectsOf(applied)) {
      expect(memoryOf(state, effect.regionId, effect.groupId)![effect.field])
        .toBeCloseTo(effect.after, 12);
      expect(effect.after - effect.before).toBeCloseTo(effect.delta, 12);
    }

    if (applied.verb === "enact_reform") {
      const politics = state.countries.find(c => c.id === applied.countryId)!.politics;
      for (const shift of applied.ideologyShifts) {
        expect(politics.ideologyCoordinates![shift.axis]).toBeCloseTo(shift.after, 12);
      }
      expect(politics.governmentSupport).toBeCloseTo(applied.politicalCost.after, 12);
    }
    if (applied.verb === "spawn_incident") {
      expect(state.mapFeatures.some(f => f.id === applied.mapFeatureId)).toBe(true);
    }
  });

  /**
   * Резюме не вправе УМОЛЧАТЬ о цели, по которой эффекта не было (внешнее ревью
   * 2026-07-26). Гранулярность правдивости — пара (цель, поле), а не поле:
   * прежний текст называл ноль нулём только тогда, когда поле не сдвинулось ни у
   * кого, и достаточно было сдвинуться одному, чтобы остальные исчезли из текста.
   *
   * Проверяется структурно и на всех глаголах сразу: каждый факт из результата
   * даёт ровно одно «for <цель>» в тексте. Пропажа любой цели роняет счёт.
   */
  it.each(SCENARIOS)("$verb: резюме называет каждую пару (цель, поле) из результата", ({ primitive, setup }) => {
    const state = game();
    // Подготовка сценария идёт ПЕРВОЙ: у `peace` она заводит войну, без которой
    // предпосылка не выполнена и тест мерил бы отказ вместо резюме.
    setup?.(state);
    // Насыщаются ровно те два канала, которые недовольство ПОДНИМАЮТ: тогда у
    // каждого глагола появляется хотя бы одна нулевая пара (у `repress` —
    // отчуждение, у `grant_autonomy` — отклик соседа), и при этом ни одна
    // предпосылка по недовольству не отсекает примитив. Насыщать заодно
    // `suppression`/`concession` нельзя: они недовольство давят, и
    // `spawn_incident` перестал бы проходить порог.
    for (const region of state.regions) {
      for (const share of region.demographics ?? []) {
        // Пару, которую уже завела подготовка сценария, не дублируем: две
        // записи на одну (регион, группу) — не состояние мира, и первая из них
        // молча победила бы во всех чтениях.
        const seeded = state.groupImpactMemory.some(
          m => m.regionId === region.id && m.groupId === share.groupId
        );
        if (seeded) continue;
        state.groupImpactMemory.push({
          regionId: region.id, groupId: share.groupId,
          suppression: 0, alienation: 1, concession: 0, emboldenment: 1,
        });
      }
    }

    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.rejected).toEqual([]);
    const applied = result.applied[0]!;

    const mentions = (applied.summary.match(/ for /g) ?? []).length;
    expect(mentions).toBe(impactEffectsOf(applied).length);
  });

  /**
   * Тот же инвариант на боевых данных и в той форме, в которой его нашёл
   * рецензент: `repress` по региону целиком, где доминант стоит на потолке
   * обоих полей. Прежний текст не упоминал его ВООБЩЕ — «suppression +0.420
   * for russians, +0.424 for latvians, +0.424 for jews», — и сессия, пишущая
   * по нему нарратив, сказала бы, что репрессия обрушилась на доминанта.
   *
   * Регион ищется ПО СВОЙСТВУ (первый регион игрока с доминантом больше
   * половины). Был литерал `187`; позиционный id сдвигается при изменении
   * числа регионов, и после сборки мира 2026-08-08 на 187 оказался латвийский
   * Vidzeme вместо литовского региона, названного в комментарии, — тест
   * продолжал проходить, описывая уже не тот регион.
   */
  it("на данных 1946 резюме называет доминанта, по которому удар не прошёл", () => {
    const state = createGame("1946", "SUN", "ru", 1);
    const region = state.regions.find(
      r => r.ownerCountryId === "SUN"
        && (r.demographics?.length ?? 0) > 1
        && Math.max(...r.demographics!.map(d => d.share)) > 0.5
    )!;
    expect(region).toBeDefined();
    const dominant = [...region.demographics!].sort((a, b) => b.share - a.share)[0]!;
    expect(dominant.share).toBeGreaterThan(0.5);
    state.groupImpactMemory.push({
      regionId: region.id, groupId: dominant.groupId,
      suppression: 1, alienation: 1, concession: 0, emboldenment: 0,
    });

    const result = applyPrimitiveBatch(state, [{
      verb: "repress", sourceCountryId: region.ownerCountryId, target: { regionId: region.id },
    }]);
    expect(result.rejected).toEqual([]);
    const applied = result.applied[0]!;

    // Оба канала доминанта — фактические нули…
    expect(deltaFor(applied, dominant.groupId, "suppression")).toBe(0);
    expect(deltaFor(applied, dominant.groupId, "alienation")).toBe(0);

    // …и текст называет их обоих, а не выбрасывает вслед за нулём.
    const label = getText(
      state.ethnicGroups.find(g => g.id === dominant.groupId)!.names, LLM_LOCALE
    );
    expect(applied.summary).toContain(`suppression unchanged for ${label}`);
    expect(applied.summary).toContain(`alienation unchanged for ${label}`);
    // Заголовок тоже считается от дельт, а не от состава региона.
    expect(applied.summary).toContain("(1 unaffected)");
    // Сырой идентификатор группы наружу не уходит — рядом локализованный регион.
    expect(label).not.toBe(dominant.groupId);
    expect(applied.summary).not.toContain(dominant.groupId);
  });

  it("неконечная поддержка правительства не уезжает в координаты идеологии", () => {
    const state = game();
    state.countries.find(c => c.id === "SUN")!.politics.governmentSupport = Number.NaN;

    const result = applyPrimitiveBatch(state, [{
      verb: "enact_reform", sourceCountryId: "SUN",
      target: { countryId: "SUN" }, params: { politicalDirection: "democratic" },
    }]);

    // Предпосылка `NaN < 25` ложна и примитив её проходит — ловит его командный
    // слой, а не валидатор. Без этой ловушки NaN-шаг уехал бы в координаты, и
    // недовольство всех регионов SUN стало бы NaN.
    expect(result.applied).toHaveLength(0);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/finite/i);
    expect(Number.isNaN(discontentOf(state, TEST_REGION_NATIONAL))).toBe(false);
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
  /**
   * Фактическая величина ОДНОГО канала, о которой движок отчитался после
   * применения одного примитива. Канал называется явно: у `repress` их два, и
   * прежний общий скаляр молча выбирал за тест, какой из них считать «величиной».
   */
  function magnitudeOf(
    state: GameState,
    primitive: Primitive,
    groupId: string,
    field: ImpactMemoryField
  ): number {
    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.rejected, JSON.stringify(result.rejected)).toHaveLength(0);
    return deltaFor(result.applied[0]!, groupId, field);
  }

  /** Фактический сдвиг оси реформы — тот же смысл, другой канал состояния. */
  function reformShiftOf(state: GameState, primitive: Primitive): number {
    const result = applyPrimitiveBatch(state, [primitive]);
    expect(result.rejected, JSON.stringify(result.rejected)).toHaveLength(0);
    return Math.abs(asReform(result.applied[0]!).ideologyShifts[0]!.delta);
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

    expect(magnitudeOf(weak, repressTitular, TEST_GROUP_TITULAR, "suppression"))
      .toBeLessThan(magnitudeOf(strong, repressTitular, TEST_GROUP_TITULAR, "suppression"));
  });

  it("repress: доминанта подавить труднее, чем малое меньшинство", () => {
    const dominant = game();
    const minority = game();
    // Одна и та же группа, разная доля в регионе — больше ничего не меняется.
    const demographics = minority.regions.find(r => r.id === TEST_REGION_NATIONAL)!.demographics!;
    demographics.find(d => d.groupId === TEST_GROUP_TITULAR)!.share = 0.1;
    demographics.find(d => d.groupId === TEST_GROUP_LOYAL)!.share = 0.9;

    expect(magnitudeOf(dominant, repressTitular, TEST_GROUP_TITULAR, "suppression"))
      .toBeLessThan(magnitudeOf(minority, repressTitular, TEST_GROUP_TITULAR, "suppression"));
  });

  it("repress: без способности применить силу хинт перестаёт что-либо значить", () => {
    const suppressionAt = (intensity: "mild" | "severe"): number => {
      const state = game();
      const politics = state.countries.find(c => c.id === "SUN")!.politics;
      politics.stability = 0;
      politics.legitimacy = 0;
      return magnitudeOf(
        state, { ...repressTitular, params: { intensity } }, TEST_GROUP_TITULAR, "suppression"
      );
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

    expect(magnitudeOf(alienated, grantTitular, TEST_GROUP_TITULAR, "concession"))
      .toBeLessThan(magnitudeOf(trusting, grantTitular, TEST_GROUP_TITULAR, "concession"));
  });

  it("grant_autonomy: уступка меньшинству мельче уступки доминанту", () => {
    const dominant = game();
    const minority = game();
    const demographics = minority.regions.find(r => r.id === TEST_REGION_NATIONAL)!.demographics!;
    demographics.find(d => d.groupId === TEST_GROUP_TITULAR)!.share = 0.1;
    demographics.find(d => d.groupId === TEST_GROUP_LOYAL)!.share = 0.9;

    const small = magnitudeOf(minority, grantTitular, TEST_GROUP_TITULAR, "concession");
    const large = magnitudeOf(dominant, grantTitular, TEST_GROUP_TITULAR, "concession");
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

    expect(magnitudeOf(narrow, inciteTitular, TEST_GROUP_TITULAR, "emboldenment"))
      .toBeLessThan(magnitudeOf(wide, inciteTitular, TEST_GROUP_TITULAR, "emboldenment"));
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

    expect(magnitudeOf(calm, incidentInNational, TEST_GROUP_TITULAR, "emboldenment"))
      .toBeLessThan(magnitudeOf(boiling, incidentInNational, TEST_GROUP_TITULAR, "emboldenment"));
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

    const shallow = reformShiftOf(weakMandate, reformDemocratic);
    const deep = reformShiftOf(strongMandate, reformDemocratic);
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

  it("перенос сохраняет идентичность элемента, ПЕРЕЕХАВШЕГО в другую позицию", () => {
    // Милстоун 1, сессия жизненного цикла. Раньше идентичность держалась
    // позиционно, и глагол, вставивший страну в середину ростера, молча
    // переселял бы взятую ранее ссылку на СОСЕДНЮЮ страну: запись через неё
    // уходила бы не туда, а чтение отдавало бы чужие числа.
    const target = game();
    const sun = target.countries.find(c => c.id === "SUN")!;
    const usa = target.countries.find(c => c.id === "USA")!;

    const source = structuredClone(target);
    // Источник: тот же состав в ДРУГОМ порядке — ровно то, что делает вставка
    // осколка в отсортированный ростер.
    source.countries.reverse();
    source.countries.find(c => c.id === "SUN")!.politics.stability = 11;
    expect(source.countries[0]!.id).not.toBe(target.countries[0]!.id);

    restore(target, source);

    // Тот же объект, хотя его индекс изменился, — и он несёт новое значение.
    expect(target.countries.find(c => c.id === "SUN")).toBe(sun);
    expect(sun.politics.stability).toBe(11);
    expect(target.countries.find(c => c.id === "USA")).toBe(usa);
  });

  it("перенос удаляет элемент, которого в источнике нет, не трогая соседей", () => {
    const target = game();
    const sun = target.countries.find(c => c.id === "SUN")!;

    const source = structuredClone(target);
    source.countries = source.countries.filter(c => c.id !== "USA");

    restore(target, source);

    expect(target.countries.map(c => c.id)).toEqual(["SUN"]);
    expect(target.countries[0]).toBe(sun);
  });
});
