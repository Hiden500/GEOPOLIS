import { describe, it, expect } from "vitest";
import {
  type PairStanding,
  structuralAffinity,
  allianceThreshold,
  allianceBreakThreshold,
  relationDriftStep,
  driftedRelation,
} from "./affinity";
import {
  RELATION_SCALE_MIN,
  RELATION_SCALE_MAX,
  RELATION_DRIFT_CAP,
  RIVAL_RELATION_THRESHOLD,
} from "@shared/defines/diplomacy";

/**
 * Четыре инварианта модификатора — на самих КОНСТАНТАХ, а не на одном удачном
 * примере. Каждый проверяется сеткой по всей области определения: дистанция и
 * давление живут в [0,1], поэтому «все входы» здесь буквально перебираются с
 * достаточным шагом плюс отдельно крайние точки.
 *
 * Тест сознательно не знает конкретных значений констант: он утверждает
 * СВОЙСТВА, которые обязаны пережить любую перекалибровку. Перекалибровка,
 * которая их нарушит, вернёт запрет на союз — тем же по сути, что снятый гейт,
 * только выраженный числом.
 */

const STEPS = 11;
const GRID = Array.from({ length: STEPS }, (_, i) => i / (STEPS - 1));

function standing(overrides: Partial<PairStanding> = {}): PairStanding {
  return {
    ideologyDistance: 0,
    contact: 0,
    dependency: 0,
    commonEnemyPressure: 0,
    atWarWithEachOther: false,
    ...overrides,
  };
}

/** Все сочетания входов, кроме флага войны, — для поиска максимумов/минимумов. */
function everyStanding(atWarWithEachOther = false): PairStanding[] {
  const all: PairStanding[] = [];
  for (const ideologyDistance of GRID) {
    for (const contact of GRID) {
      for (const dependency of GRID) {
        for (const commonEnemyPressure of GRID) {
          all.push({ ideologyDistance, contact, dependency, commonEnemyPressure, atWarWithEachOther });
        }
      }
    }
  }
  return all;
}

describe("инвариант 1: союз возможен для любой пары", () => {
  it("порог согласия никогда не достаёт до края шкалы", () => {
    for (const ideologyDistance of GRID) {
      for (const pressure of GRID) {
        expect(allianceThreshold(ideologyDistance, pressure)).toBeLessThan(RELATION_SCALE_MAX);
      }
    }
  });

  it("порог согласия остаётся положительным — союз не выдаётся даром", () => {
    for (const ideologyDistance of GRID) {
      for (const pressure of GRID) {
        expect(allianceThreshold(ideologyDistance, pressure)).toBeGreaterThan(0);
      }
    }
  });
});

describe("инвариант 2: тик не создаёт союз, который сам же снимает", () => {
  it("порог согласия строго выше порога распада при любых входах", () => {
    for (const ideologyDistance of GRID) {
      const breakAt = allianceBreakThreshold(ideologyDistance);
      for (const pressure of GRID) {
        expect(allianceThreshold(ideologyDistance, pressure)).toBeGreaterThan(breakAt);
      }
    }
  });
});

describe("инвариант 3: мир не сваливается в блоки без причины", () => {
  it("максимум тяготения без общего врага ниже минимума порога без общего врага", () => {
    const peaceful = everyStanding().filter(s => s.commonEnemyPressure === 0);
    const maxAffinity = Math.max(...peaceful.map(structuralAffinity));
    const minThreshold = Math.min(...GRID.map(d => allianceThreshold(d, 0)));

    expect(maxAffinity).toBeLessThan(minThreshold);
  });
});

describe("инвариант 4: общий враг перевешивает идеологическую вражду", () => {
  const antipodes = standing({ ideologyDistance: 1, contact: 1 });

  it("тяготение антиподов при полном давлении выше их порога согласия", () => {
    const withEnemy = structuralAffinity({ ...antipodes, commonEnemyPressure: 1 });
    expect(withEnemy).toBeGreaterThan(allianceThreshold(1, 1));
  });

  it("без общего врага тяготение антиподов ниже их порога распада", () => {
    const withoutEnemy = structuralAffinity({ ...antipodes, commonEnemyPressure: 0 });
    expect(withoutEnemy).toBeLessThan(allianceBreakThreshold(1));
  });

  it("тяготение родственных без врага ВЫШЕ их порога распада — их союз держится", () => {
    const kindred = structuralAffinity(standing({ ideologyDistance: 0, contact: 1 }));
    expect(kindred).toBeGreaterThan(allianceBreakThreshold(0));
  });
});

describe("кандидатный набор точен, а не приблизителен", () => {
  it("пара без канала связи не достаёт ни до порога союза, ни до порога соперничества", () => {
    // На этом держится право тика не обходить все 12 246 пар мира: пропущенная
    // пара по построению не может пересечь ни один порог.
    const contactless = everyStanding().filter(
      s => s.contact === 0 && s.dependency === 0 && s.commonEnemyPressure === 0
    );
    const reach = Math.max(...contactless.map(s => Math.abs(structuralAffinity(s))));
    const minAlliance = Math.min(...GRID.map(d => allianceThreshold(d, 0)));

    expect(reach).toBeLessThan(minAlliance);
    expect(-reach).toBeGreaterThan(RIVAL_RELATION_THRESHOLD);
  });
});

describe("форма модификатора", () => {
  it("порог согласия растёт с идеологической дистанцией", () => {
    for (const pressure of GRID) {
      const rising = GRID.map(d => allianceThreshold(d, pressure));
      for (let i = 1; i < rising.length; i++) {
        expect(rising[i]!).toBeGreaterThan(rising[i - 1]!);
      }
    }
  });

  it("порог согласия падает с давлением общего врага", () => {
    for (const ideologyDistance of GRID) {
      const falling = GRID.map(p => allianceThreshold(ideologyDistance, p));
      for (let i = 1; i < falling.length; i++) {
        expect(falling[i]!).toBeLessThan(falling[i - 1]!);
      }
    }
  });

  it("тяготение падает с идеологической дистанцией и меняет знак у середины", () => {
    const at = (d: number): number => structuralAffinity(standing({ ideologyDistance: d, contact: 1 }));
    expect(at(0)).toBeGreaterThan(0);
    expect(at(1)).toBeLessThan(0);
    for (const d of GRID.slice(1)) {
      expect(at(d)).toBeLessThan(at(d - 1 / (STEPS - 1)));
    }
  });

  it("соседство усиливает и притяжение, и отталкивание, а не только дружбу", () => {
    const kindredNear = structuralAffinity(standing({ ideologyDistance: 0, contact: 1 }));
    const kindredFar = structuralAffinity(standing({ ideologyDistance: 0, contact: 0 }));
    const hostileNear = structuralAffinity(standing({ ideologyDistance: 1, contact: 1 }));
    const hostileFar = structuralAffinity(standing({ ideologyDistance: 1, contact: 0 }));

    expect(kindredNear).toBeGreaterThan(kindredFar);
    expect(hostileNear).toBeLessThan(hostileFar);
  });

  it("идущая между сторонами война уводит тяготение в зону соперничества", () => {
    const warring = everyStanding(true).filter(s => s.commonEnemyPressure === 0);
    for (const s of warring) {
      expect(structuralAffinity(s)).toBeLessThan(0);
    }
  });

  it("тяготение не выходит за шкалу отношений", () => {
    for (const s of [...everyStanding(false), ...everyStanding(true)]) {
      const value = structuralAffinity(s);
      expect(value).toBeGreaterThanOrEqual(RELATION_SCALE_MIN);
      expect(value).toBeLessThanOrEqual(RELATION_SCALE_MAX);
    }
  });
});

describe("дрейф", () => {
  it("шаг не превышает потолка ни в какую сторону", () => {
    expect(relationDriftStep(RELATION_SCALE_MIN, RELATION_SCALE_MAX)).toBe(RELATION_DRIFT_CAP);
    expect(relationDriftStep(RELATION_SCALE_MAX, RELATION_SCALE_MIN)).toBe(-RELATION_DRIFT_CAP);
  });

  it("на цели останавливается", () => {
    expect(driftedRelation(42, 42)).toBe(42);
  });

  it("замедляется по мере приближения к цели", () => {
    expect(Math.abs(relationDriftStep(0, 10))).toBeLessThan(Math.abs(relationDriftStep(0, 60)));
  });

  it("никогда не выводит отношения за шкалу", () => {
    for (const current of [RELATION_SCALE_MIN, 0, RELATION_SCALE_MAX]) {
      for (const target of [RELATION_SCALE_MIN, 0, RELATION_SCALE_MAX]) {
        const next = driftedRelation(current, target);
        expect(next).toBeGreaterThanOrEqual(RELATION_SCALE_MIN);
        expect(next).toBeLessThanOrEqual(RELATION_SCALE_MAX);
      }
    }
  });
});
