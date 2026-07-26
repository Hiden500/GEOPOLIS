import { describe, it, expect } from "vitest";
import { type Country } from "@shared/types/Country";
import { createTestCountry } from "../../test-utils/fixtures";
import {
  magnitudeFromState,
  coerciveCapacity,
  repressSuppressionFactor,
  repressAlienationFactor,
  concessionFactor,
  neighbourEmboldenment,
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
  GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MIN,
  GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MAX,
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
 *
 * Список каналов выводится из САМОГО модуля констант, а не копируется в тест.
 * До 2026-07-26 покрытие проверялось сверкой множества, построенного из
 * таблицы, с захардкоженным списком тех же имён: такой тест ловил удаление
 * строки, но не появление НОВОГО канала без строки. Следствие было
 * наблюдаемым — седьмой коридор `GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_*` строки
 * не имел, и ровно через него прошёл обход коридора накоплением.
 */

/** Константы шкал, у которых парного `_MIN` нет и быть не должно. */
const UNPAIRED = new Set(["COUNTRY_POLITICS_SCALE_MAX"]);

// Через `Record<string, unknown>`: `Object.entries` над модулем даёт union
// литеральных типов каждой константы, и предикат по нему не строится.
const NUMERIC_DEFINES = Object.entries(defines as Record<string, unknown>).filter(
  (entry): entry is [string, number] => typeof entry[1] === "number"
);

function namesWithSuffix(suffix: string): string[] {
  return NUMERIC_DEFINES.map(([name]) => name).filter(n => n.endsWith(suffix) && !UNPAIRED.has(n));
}

function valueOf(name: string): number | undefined {
  return NUMERIC_DEFINES.find(([n]) => n === name)?.[1];
}

/** Каждый `*_MIN` модуля с его парой — включая осиротевшие (max === undefined). */
const CORRIDORS = namesWithSuffix("_MIN").map(name => {
  const stem = name.slice(0, -"_MIN".length);
  return { stem, min: valueOf(name)!, max: valueOf(`${stem}_MAX`) };
});

/** Стемы полноценных коридоров — эталон покрытия для таблицы каналов. */
const CORRIDOR_STEMS = CORRIDORS.filter(c => c.max !== undefined).map(c => c.stem);

function countryWithPolitics(overrides: Partial<Country["politics"]>): Country {
  const base = createTestCountry({ id: "SUN" });
  return { ...base, politics: { ...base.politics, ...overrides } };
}

/**
 * Канал, чью позицию в коридоре выбирает качественный хинт: как получить
 * `stateFactor` при схлопывании и при живом состоянии.
 */
interface HintedChannel {
  /** Имя пары констант коридора — ключ сверки с модулем `defines`. */
  stem: string;
  name: string;
  min: number;
  max: number;
  /** Состояние, в котором коридор обязан схлопнуться (`stateFactor === 0`). */
  collapsed: () => number;
  /** Любое состояние, где коридор открыт (`stateFactor > 0`) — контроль. */
  open: () => number;
}

const HINTED_CHANNELS: HintedChannel[] = [
  {
    stem: "REPRESS_SUPPRESSION",
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
    stem: "REPRESS_ALIENATION",
    name: "repress · alienation (legitimacy = максимум шкалы)",
    min: REPRESS_ALIENATION_MIN,
    max: REPRESS_ALIENATION_MAX,
    collapsed: () => repressAlienationFactor(0.88, COUNTRY_POLITICS_SCALE_MAX),
    open: () => repressAlienationFactor(0.88, COUNTRY_POLITICS_SCALE_MAX / 2),
  },
  {
    stem: "GRANT_AUTONOMY_CONCESSION",
    name: "grant_autonomy · concession (legitimacy = 0)",
    min: GRANT_AUTONOMY_CONCESSION_MIN,
    max: GRANT_AUTONOMY_CONCESSION_MAX,
    collapsed: () => concessionFactor(0.88, undefined, 0),
    open: () => concessionFactor(0.88, undefined, COUNTRY_POLITICS_SCALE_MAX / 2),
  },
  {
    stem: "GRANT_AUTONOMY_CONCESSION",
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
    stem: "INCITE_UNREST_EMBOLDENMENT",
    name: "incite_unrest (дистанция ровно на пороге предпосылки)",
    min: INCITE_UNREST_EMBOLDENMENT_MIN,
    max: INCITE_UNREST_EMBOLDENMENT_MAX,
    collapsed: () => inciteFactor(INCITE_UNREST_MIN_DISTANCE),
    open: () => inciteFactor((INCITE_UNREST_MIN_DISTANCE + 1) / 2),
  },
  {
    stem: "SPAWN_INCIDENT_EMBOLDENMENT",
    name: "spawn_incident (недовольство ровно на пороге предпосылки)",
    min: SPAWN_INCIDENT_EMBOLDENMENT_MIN,
    max: SPAWN_INCIDENT_EMBOLDENMENT_MAX,
    collapsed: () => incidentFactor(SPAWN_INCIDENT_MIN_DISCONTENT),
    open: () => incidentFactor((SPAWN_INCIDENT_MIN_DISCONTENT + 1) / 2),
  },
  {
    stem: "ENACT_REFORM_COORDINATE_STEP",
    name: "enact_reform (поддержка ровно на пороге предпосылки)",
    min: ENACT_REFORM_COORDINATE_STEP_MIN,
    max: ENACT_REFORM_COORDINATE_STEP_MAX,
    collapsed: () => reformMandateFactor(ENACT_REFORM_MIN_GOVERNMENT_SUPPORT),
    open: () => reformMandateFactor(COUNTRY_POLITICS_SCALE_MAX),
  },
];

/**
 * Канал, до которого хинт не доходит вовсе: позицию в коридоре выбирает
 * фактическая величина уже применённого эффекта. Схлопывание для него не
 * «достижимо», а тождественно — проверять надо не его, а невозможность хинта
 * попасть внутрь и границы самого коридора.
 */
interface UnhintedChannel {
  stem: string;
  name: string;
  min: number;
  max: number;
  /** Функция коридора: единственный аргумент — величина из состояния. */
  fn: (stateValue: number) => number;
  /** Значение входа, при котором эффекта нет вовсе. */
  silent: number;
  /** Вход, насыщающий коридор до `max`. */
  saturating: number;
}

const UNHINTED_CHANNELS: UnhintedChannel[] = [
  {
    stem: "GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT",
    name: "grant_autonomy · отклик соседей (вход — фактическая уступка, не хинт)",
    min: GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MIN,
    max: GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_MAX,
    fn: neighbourEmboldenment,
    silent: 0,
    saturating: GRANT_AUTONOMY_CONCESSION_MAX,
  },
];

describe("таблица каналов магнитуды выведена из модуля констант", () => {
  it("каждый коридор `*_MIN`/`*_MAX` представлен строкой таблицы", () => {
    const covered = new Set([
      ...HINTED_CHANNELS.map(c => c.stem),
      ...UNHINTED_CHANNELS.map(c => c.stem),
    ]);

    // Эталон — сам модуль defines, а не копия его имён в тесте: новый коридор
    // без строки в таблице обязан ронять именно эту проверку.
    expect([...covered].sort()).toEqual([...new Set(CORRIDOR_STEMS)].sort());
  });

  it.each([...HINTED_CHANNELS, ...UNHINTED_CHANNELS])(
    "$name: MIN/MAX строки совпадают с константами своего коридора",
    (channel) => {
      expect(channel.min).toBe(valueOf(`${channel.stem}_MIN`));
      expect(channel.max).toBe(valueOf(`${channel.stem}_MAX`));
    }
  );
});

describe("схлопывание коридора достижимо у КАЖДОГО канала с хинтом", () => {
  it.each(HINTED_CHANNELS)("$name: stateFactor схлопывается в ноль", (channel) => {
    expect(channel.collapsed()).toBe(0);
  });

  it.each(HINTED_CHANNELS)("$name: в схлопнутом состоянии severe === mild === MIN", (channel) => {
    const factor = channel.collapsed();
    const mild = magnitudeFromState(channel.min, channel.max, factor, "mild");
    const severe = magnitudeFromState(channel.min, channel.max, factor, "severe");

    expect(severe).toBeCloseTo(mild, 12);
    expect(severe).toBeCloseTo(channel.min, 12);
  });

  it.each(HINTED_CHANNELS)("$name: в живом состоянии коридор открыт и хинт снова значит", (channel) => {
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
  it.each(HINTED_CHANNELS)("$name: отношение severe/mild не константа", (channel) => {
    const ratio = (factor: number): number =>
      magnitudeFromState(channel.min, channel.max, factor, "severe") /
      magnitudeFromState(channel.min, channel.max, factor, "mild");

    expect(ratio(channel.open())).not.toBeCloseTo(ratio(channel.collapsed()), 6);
  });
});

describe("канал без хинта: позицию в коридоре выбирает состояние, не модель", () => {
  it.each(UNHINTED_CHANNELS)("$name: сигнатура не принимает интенсивность", (channel) => {
    // Не риторика: единственный аргумент — величина из состояния. Появление
    // второго (хинта) обязано уронить эту проверку до того, как «LLM не влияет
    // на число» станет неправдой ещё в одном месте.
    expect(channel.fn.length).toBe(1);
  });

  it.each(UNHINTED_CHANNELS)("$name: нулевой вход даёт ноль, а не пол коридора", (channel) => {
    expect(channel.fn(channel.silent)).toBe(0);
  });

  it.each(UNHINTED_CHANNELS)("$name: коридор проходится входом от MIN до MAX", (channel) => {
    const faint = channel.fn(channel.saturating / 4);
    const full = channel.fn(channel.saturating);

    expect(faint).toBeGreaterThanOrEqual(channel.min);
    expect(faint).toBeLessThan(full);
    expect(full).toBeCloseTo(channel.max, 12);
  });

  it.each(UNHINTED_CHANNELS)("$name: вход сверх насыщения не выталкивает за MAX", (channel) => {
    expect(channel.fn(channel.saturating * 10)).toBeCloseTo(channel.max, 12);
  });
});

/**
 * Коридоры заданы парами независимых констант, и калибровка правит их руками.
 * Переставленная пара (`MIN > MAX`) даёт коридор отрицательной ширины: `severe`
 * начинает выдавать МЕНЬШЕ `mild`, все клампы формально соблюдены, ни один
 * поведенческий тест не падает. Поэтому пары проверяются как пары.
 */
describe("коридоры магнитуды: пары MIN/MAX согласованы", () => {
  it("каждая константа коридора имеет пару", () => {
    expect(CORRIDORS.length).toBeGreaterThan(0);
    // Ни одного осиротевшего `_MIN`…
    expect(CORRIDORS.filter(c => c.max === undefined).map(c => c.stem)).toEqual([]);
    // …и ни одного осиротевшего `_MAX`. Список непарных константа-шкал явный:
    // новая непарная константа обязана падать здесь и получать осознанное
    // решение, а не молча выпадать из проверки.
    const stems = new Set(CORRIDORS.map(c => c.stem));
    expect(namesWithSuffix("_MAX").filter(n => !stems.has(n.slice(0, -"_MAX".length)))).toEqual([]);
  });

  it.each(CORRIDORS)("$stem: MIN < MAX и оба конечны", ({ min, max }) => {
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(min).toBeLessThan(max!);
  });
});
