import { describe, it, expect } from "vitest";
import { deriveEventFactuality, type ResponseApplicationCounts } from "../eventFactuality";

/**
 * Классификация текста события по фактическому результату (docs/PRIMITIVES.md
 * §3, решение пользователя 2026-07-27).
 *
 * Проверяется не «функция возвращает строку», а её ЕДИНСТВЕННОЕ обещание: без
 * фактического применения слово «подтверждено» получить нельзя ни одним
 * сочетанием чисел.
 */
function counts(overrides: Partial<ResponseApplicationCounts> = {}): ResponseApplicationCounts {
  return {
    proposedActions: 0,
    appliedActions: 0,
    rejectedActions: 0,
    proposedPrimitives: 0,
    appliedPrimitives: 0,
    rejectedPrimitives: 0,
    ...overrides,
  };
}

describe("deriveEventFactuality", () => {
  it("ответ без предложений к движку — чистый нарратив, подтверждать нечего", () => {
    expect(deriveEventFactuality(counts())).toBe("unconfirmed");
  });

  it("всё предложенное применено — подтверждено (оба канала)", () => {
    expect(
      deriveEventFactuality(
        counts({
          proposedActions: 2,
          appliedActions: 2,
          proposedPrimitives: 3,
          appliedPrimitives: 3,
        })
      )
    ).toBe("confirmed");
  });

  it("отклонён хотя бы один примитив — подтверждено частично", () => {
    expect(
      deriveEventFactuality(
        counts({ proposedPrimitives: 2, appliedPrimitives: 1, rejectedPrimitives: 1 })
      )
    ).toBe("partial");
  });

  it("отклонено действие СТАРОГО канала — тоже частично", () => {
    // Иначе `annex`, отклонённый как нереализованный, оставлял бы событию
    // отметку «подтверждено» при заголовке «Эльзас присоединён».
    expect(
      deriveEventFactuality(
        counts({
          proposedActions: 2,
          appliedActions: 1,
          rejectedActions: 1,
          proposedPrimitives: 1,
          appliedPrimitives: 1,
        })
      )
    ).toBe("partial");
  });

  it("примитив исчез без записи об отказе — всё равно не подтверждено", () => {
    // Второй, независимый признак: «отказов ноль» само по себе подтверждением
    // не считается. Потерянный где-то в конвейере примитив обязан давать
    // `partial`, а не `confirmed` — направление отказа выбрано в пользу
    // недоверия.
    expect(
      deriveEventFactuality(counts({ proposedPrimitives: 3, appliedPrimitives: 2 }))
    ).toBe("partial");
  });

  it("повтор батча (idempotency): предложено, не применено ничего — не подтверждено", () => {
    expect(
      deriveEventFactuality(
        counts({ proposedPrimitives: 2, appliedPrimitives: 0, rejectedPrimitives: 1 })
      )
    ).toBe("partial");
  });
});
