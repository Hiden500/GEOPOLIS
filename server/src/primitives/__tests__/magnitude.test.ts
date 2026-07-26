import { describe, it, expect } from "vitest";
import { type Country } from "@shared/types/Country";
import { createTestCountry } from "../../test-utils/fixtures";
import {
  magnitudeFromState,
  coerciveCapacity,
  repressSuppressionFactor,
  repressAlienationFactor,
  concessionFactor,
  inciteFactor,
  incidentFactor,
  reformMandateFactor,
} from "../magnitude";
import * as defines from "@shared/defines/discontent";
import {
  COUNTRY_POLITICS_SCALE_MAX,
  INCITE_UNREST_MIN_DISTANCE,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  REPRESS_SUPPRESSION_MIN,
  REPRESS_SUPPRESSION_MAX,
  REPRESS_ALIENATION_MIN,
  REPRESS_ALIENATION_MAX,
  GRANT_AUTONOMY_CONCESSION_MIN,
  GRANT_AUTONOMY_CONCESSION_MAX,
  INCITE_UNREST_EMBOLDENMENT_MIN,
  INCITE_UNREST_EMBOLDENMENT_MAX,
  SPAWN_INCIDENT_EMBOLDENMENT_MIN,
  SPAWN_INCIDENT_EMBOLDENMENT_MAX,
  ENACT_REFORM_COORDINATE_STEP_MIN,
  ENACT_REFORM_COORDINATE_STEP_MAX,
} from "@shared/defines/discontent";

/**
 * Свойство, ради которого построен коридор магнитуды (docs/PRIMITIVES.md §1
 * «хинт клампится», §3 «LLM не влияет на число никогда»): при `stateFactor → 0`
 * коридор схлопывается в `MIN`, и `severe` перестаёт отличаться от `mild`.
 *
 * Утверждение стоит в шапке `magnitude.ts` про ВСЕ каналы — значит, оно обязано
 * быть проверяемым для всех, а не для тех, где оно удобно. Канал, у которого
 * схлопывание недостижимо ни в каком мире, отдаёт модели гарантированную долю
 * коридора в любой партии: коридор для него — декорация. Именно так и было у
 * `repress·alienation` до калибровки 2026-07-26 (жёсткий пол 0.35 в `stateFactor`
 * при `share = 0`, запрещённой схемой демографии).
 */

function countryWithPolitics(overrides: Partial<Country["politics"]>): Country {
  const base = createTestCountry({ id: "SUN" });
  return { ...base, politics: { ...base.politics, ...overrides } };
}

/** Канал: как получить `stateFactor` при схлопывании и при живом состоянии. */
interface Channel {
  name: string;
  min: number;
  max: number;
  /** Состояние, в котором коридор обязан схлопнуться (`stateFactor === 0`). */
  collapsed: () => number;
  /** Любое состояние, где коридор открыт (`stateFactor > 0`) — контроль. */
  open: () => number;
}

const CHANNELS: Channel[] = [
  {
    name: "repress · suppression (stability = legitimacy = 0)",
    min: REPRESS_SUPPRESSION_MIN,
    max: REPRESS_SUPPRESSION_MAX,
    collapsed: () =>
      repressSuppressionFactor(
        coerciveCapacity(countryWithPolitics({ stability: 0, legitimacy: 0 })),
        0.88
      ),
    open: () =>
      repressSuppressionFactor(
        coerciveCapacity(countryWithPolitics({ stability: 70, legitimacy: 60 })),
        0.88
      ),
  },
  {
    name: "repress · alienation (legitimacy = максимум шкалы)",
    min: REPRESS_ALIENATION_MIN,
    max: REPRESS_ALIENATION_MAX,
    collapsed: () => repressAlienationFactor(0.88, COUNTRY_POLITICS_SCALE_MAX),
    open: () => repressAlienationFactor(0.88, COUNTRY_POLITICS_SCALE_MAX / 2),
  },
  {
    name: "grant_autonomy · concession (legitimacy = 0)",
    min: GRANT_AUTONOMY_CONCESSION_MIN,
    max: GRANT_AUTONOMY_CONCESSION_MAX,
    collapsed: () => concessionFactor(0.88, undefined, 0),
    open: () => concessionFactor(0.88, undefined, COUNTRY_POLITICS_SCALE_MAX / 2),
  },
  {
    name: "grant_autonomy · concession (alienation = 1)",
    min: GRANT_AUTONOMY_CONCESSION_MIN,
    max: GRANT_AUTONOMY_CONCESSION_MAX,
    collapsed: () =>
      concessionFactor(
        0.88,
        { regionId: 1, groupId: "g", suppression: 0, alienation: 1, concession: 0, emboldenment: 0 },
        COUNTRY_POLITICS_SCALE_MAX
      ),
    open: () =>
      concessionFactor(
        0.88,
        { regionId: 1, groupId: "g", suppression: 0, alienation: 0, concession: 0, emboldenment: 0 },
        COUNTRY_POLITICS_SCALE_MAX
      ),
  },
  {
    name: "incite_unrest (дистанция ровно на пороге предпосылки)",
    min: INCITE_UNREST_EMBOLDENMENT_MIN,
    max: INCITE_UNREST_EMBOLDENMENT_MAX,
    collapsed: () => inciteFactor(INCITE_UNREST_MIN_DISTANCE),
    open: () => inciteFactor((INCITE_UNREST_MIN_DISTANCE + 1) / 2),
  },
  {
    name: "spawn_incident (недовольство ровно на пороге предпосылки)",
    min: SPAWN_INCIDENT_EMBOLDENMENT_MIN,
    max: SPAWN_INCIDENT_EMBOLDENMENT_MAX,
    collapsed: () => incidentFactor(SPAWN_INCIDENT_MIN_DISCONTENT),
    open: () => incidentFactor((SPAWN_INCIDENT_MIN_DISCONTENT + 1) / 2),
  },
  {
    name: "enact_reform (поддержка ровно на пороге предпосылки)",
    min: ENACT_REFORM_COORDINATE_STEP_MIN,
    max: ENACT_REFORM_COORDINATE_STEP_MAX,
    collapsed: () => reformMandateFactor(ENACT_REFORM_MIN_GOVERNMENT_SUPPORT),
    open: () => reformMandateFactor(COUNTRY_POLITICS_SCALE_MAX),
  },
];

describe("схлопывание коридора достижимо у КАЖДОГО канала", () => {
  it("таблица покрывает все шесть каналов магнитуды", () => {
    // Канал уступки представлен дважды (два независимых входа схлопывания),
    // поэтому считаем уникальные глаголо-каналы, а не строки.
    const channels = new Set(CHANNELS.map(c => c.name.split(" (")[0]));
    expect([...channels].sort()).toEqual([
      "enact_reform",
      "grant_autonomy · concession",
      "incite_unrest",
      "repress · alienation",
      "repress · suppression",
      "spawn_incident",
    ]);
  });

  it.each(CHANNELS)("$name: stateFactor схлопывается в ноль", (channel) => {
    expect(channel.collapsed()).toBe(0);
  });

  it.each(CHANNELS)("$name: в схлопнутом состоянии severe === mild === MIN", (channel) => {
    const factor = channel.collapsed();
    const mild = magnitudeFromState(channel.min, channel.max, factor, "mild");
    const severe = magnitudeFromState(channel.min, channel.max, factor, "severe");

    expect(severe).toBeCloseTo(mild, 12);
    expect(severe).toBeCloseTo(channel.min, 12);
  });

  it.each(CHANNELS)("$name: в живом состоянии коридор открыт и хинт снова значит", (channel) => {
    const factor = channel.open();
    expect(factor).toBeGreaterThan(0);

    const mild = magnitudeFromState(channel.min, channel.max, factor, "mild");
    const severe = magnitudeFromState(channel.min, channel.max, factor, "severe");
    expect(severe).toBeGreaterThan(mild);
    expect(severe).toBeLessThanOrEqual(channel.max);
  });

  /**
   * Ключевая разница между «коридором от состояния» и старым «константа ×
   * множитель хинта»: во втором отношение `severe/mild` одно и то же в любом
   * мире. Здесь оно обязано меняться вместе с состоянием.
   */
  it.each(CHANNELS)("$name: отношение severe/mild не константа", (channel) => {
    const ratio = (factor: number): number =>
      magnitudeFromState(channel.min, channel.max, factor, "severe") /
      magnitudeFromState(channel.min, channel.max, factor, "mild");

    expect(ratio(channel.open())).not.toBeCloseTo(ratio(channel.collapsed()), 6);
  });
});

/**
 * Коридоры заданы парами независимых констант, и калибровка правит их руками.
 * Переставленная пара (`MIN > MAX`) даёт коридор отрицательной ширины: `severe`
 * начинает выдавать МЕНЬШЕ `mild`, все клампы формально соблюдены, ни один
 * поведенческий тест не падает. Поэтому пары проверяются как пары.
 */
describe("коридоры магнитуды: пары MIN/MAX согласованы", () => {
  /**
   * Константы шкал, у которых парного `_MIN` нет и быть не должно. Список
   * явный: новая непарная константа обязана падать здесь и получать осознанное
   * решение, а не молча выпадать из проверки.
   */
  const UNPAIRED = new Set(["COUNTRY_POLITICS_SCALE_MAX"]);

  // Через `Record<string, unknown>`: `Object.entries` над модулем даёт union
  // литеральных типов каждой константы, и предикат по нему не строится.
  const numeric = Object.entries(defines as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number"
  );
  const suffixed = (suffix: string): string[] =>
    numeric.map(([name]) => name).filter(n => n.endsWith(suffix) && !UNPAIRED.has(n));

  const pairs = suffixed("_MIN").map(name => {
    const stem = name.slice(0, -"_MIN".length);
    const min = numeric.find(([n]) => n === name)![1];
    const max = numeric.find(([n]) => n === `${stem}_MAX`)?.[1];
    return { stem, min, max };
  });

  it("каждая константа коридора имеет пару", () => {
    expect(pairs.length).toBeGreaterThan(0);
    // Ни одного осиротевшего `_MIN`…
    expect(pairs.filter(p => p.max === undefined).map(p => p.stem)).toEqual([]);
    // …и ни одного осиротевшего `_MAX`.
    const stems = new Set(pairs.map(p => p.stem));
    expect(suffixed("_MAX").filter(n => !stems.has(n.slice(0, -"_MAX".length)))).toEqual([]);
  });

  it.each(pairs)("$stem: MIN < MAX и оба конечны", ({ min, max }) => {
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(min).toBeLessThan(max!);
  });
});
