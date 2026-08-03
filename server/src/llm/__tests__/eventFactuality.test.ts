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
    proposedPrimitives: 0,
    appliedPrimitives: 0,
    rejectedPrimitives: 0,
    proposedLegacyActions: 0,
    ...overrides,
  };
}

describe("deriveEventFactuality", () => {
  it("ответ без предложений к движку — чистый нарратив, подтверждать нечего", () => {
    expect(deriveEventFactuality(counts())).toBe("unconfirmed");
  });

  it("всё предложенное применено — подтверждено", () => {
    expect(
      deriveEventFactuality(counts({ proposedPrimitives: 3, appliedPrimitives: 3 }))
    ).toBe("confirmed");
  });

  it("отклонён хотя бы один примитив — подтверждено частично", () => {
    expect(
      deriveEventFactuality(
        counts({ proposedPrimitives: 2, appliedPrimitives: 1, rejectedPrimitives: 1 })
      )
    ).toBe("partial");
  });

  it("массив НЕСУЩЕСТВУЮЩЕГО канала `actions` не даёт «подтверждено»", () => {
    // Ответ, попросивший движок о канале, которого нет, чего-то от него ХОТЕЛ —
    // и не получил. Считать такой текст неоспоримым значило бы аттестовать
    // заголовок «Эльзас присоединён» при движке, отвергнувшем всё содержимое.
    expect(
      deriveEventFactuality(
        counts({ proposedPrimitives: 1, appliedPrimitives: 1, proposedLegacyActions: 2 })
      )
    ).toBe("partial");
  });

  it("ответ ТОЛЬКО из `actions` тоже не «чистый нарратив»", () => {
    // Иначе ответ, весь смысл которого движок отверг, получал бы ту же отметку,
    // что честный текст без единого приказа.
    expect(deriveEventFactuality(counts({ proposedLegacyActions: 3 }))).toBe("partial");
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
