import { describe, it, expect } from "vitest";
import { nextRandom } from "@shared/utils/rng";

describe("nextRandom (mulberry32, docs/plans/01_PERSISTENCE_STATE.md)", () => {
  it("возвращает значение в [0, 1)", () => {
    const { value } = nextRandom(42);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });

  it("одинаковый seed даёт одинаковую последовательность", () => {
    const seqA: number[] = [];
    let stateA = 42;
    for (let i = 0; i < 5; i++) {
      const { value, nextState } = nextRandom(stateA);
      seqA.push(value);
      stateA = nextState;
    }

    const seqB: number[] = [];
    let stateB = 42;
    for (let i = 0; i < 5; i++) {
      const { value, nextState } = nextRandom(stateB);
      seqB.push(value);
      stateB = nextState;
    }

    expect(seqA).toEqual(seqB);
  });

  it("разные seed дают разные последовательности", () => {
    const a = nextRandom(1);
    const b = nextRandom(2);
    expect(a.value).not.toBe(b.value);
  });

  it("не мутирует переданное состояние (чистая функция)", () => {
    const state = 123;
    nextRandom(state);
    expect(state).toBe(123);
  });

  it("последовательные вызовы с обновлением состояния не повторяют одно и то же значение", () => {
    const first = nextRandom(7);
    const second = nextRandom(first.nextState);
    expect(second.value).not.toBe(first.value);
  });
});
