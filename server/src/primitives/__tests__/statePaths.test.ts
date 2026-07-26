import { describe, it, expect } from "vitest";
import { collectChangedPaths } from "../statePaths";
import { PRIMITIVE_PALETTE } from "../palette";
import { findPaletteViolations } from "../palette";

/**
 * Диф изменённых путей — техническая основа палитры эффектов
 * (docs/PRIMITIVES.md §3, защита №3). Палитра заявлена как рантайм-ГРАНИЦА,
 * поэтому её основа обязана видеть всё, что верб записал, — включая случаи, где
 * записанное значение само по себе выглядит «пустым».
 *
 * Внешний аудит 2026-07-26 исполнил дыру: `leavesEqual` безусловно приравнивал
 * `undefined` и числовой ноль, поэтому появление незаявленного поля со
 * значением 0 (и его исчезновение) в диф не попадало вовсе, и
 * `findPaletteViolations` такое изменение не отклонял. Ни один из пяти
 * обработчиков среза так не пишет, то есть повреждения состояния не было, —
 * но граница с целым классом невидимых записей границей не является.
 */

describe("collectChangedPaths — появление и исчезновение поля", () => {
  it("видит незаявленное числовое поле со значением 0", () => {
    expect(collectChangedPaths({}, { unauthorizedNumericField: 0 }))
      .toEqual(["unauthorizedNumericField"]);
  });

  it("видит удаление такого же поля", () => {
    expect(collectChangedPaths({ unauthorizedNumericField: 0 }, {}))
      .toEqual(["unauthorizedNumericField"]);
  });

  it("видит нулевое поле, добавленное в существующий вложенный объект", () => {
    expect(collectChangedPaths(
      { mapFeatures: [{ id: "f1", type: "protest" }] },
      { mapFeatures: [{ id: "f1", type: "protest", visibleAtZoom: 0 }] }
    )).toEqual(["mapFeatures[*].visibleAtZoom"]);
  });

  it("палитра теперь отклоняет такое изменение, а не пропускает молча", () => {
    const changed = collectChangedPaths({}, { progress: 0 });
    expect(findPaletteViolations("spawn_incident", changed)).toEqual(["progress"]);
  });
});

describe("collectChangedPaths — структурные нули новой записи", () => {
  /**
   * Обратная сторона той же монеты: первое касание пары (регион, группа) заводит
   * запись памяти со ВСЕМИ четырьмя полями в нуле. Если считать их изменениями,
   * verb, объявивший только `emboldenment`, «менял» бы и остальные три, и
   * палитра перестала бы различать что-либо вовсе.
   */
  it("нули свежесозданной записи в диф не попадают, ненулевые поля — попадают", () => {
    const changed = collectChangedPaths(
      { groupImpactMemory: [] },
      {
        groupImpactMemory: [
          { regionId: 187, groupId: "lithuanians",
            suppression: 0, alienation: 0, concession: 0, emboldenment: 0.2 },
        ],
      }
    );

    expect(changed).toEqual([
      "groupImpactMemory[*].emboldenment",
      "groupImpactMemory[*].groupId",
      "groupImpactMemory[*].regionId",
    ]);
    expect(findPaletteViolations("incite_unrest", changed)).toEqual([]);
    // Именно эти три пути палитра `incite_unrest` и объявляет.
    expect([...PRIMITIVE_PALETTE.incite_unrest].sort()).toEqual(changed);
  });

  it("в СУЩЕСТВУЮЩЕЙ записи сдвиг поля с нуля виден как раньше", () => {
    const before = {
      groupImpactMemory: [
        { regionId: 187, groupId: "lithuanians",
          suppression: 0, alienation: 0, concession: 0, emboldenment: 0 },
      ],
    };
    const after = structuredClone(before);
    after.groupImpactMemory[0]!.alienation = 0.14;

    expect(collectChangedPaths(before, after)).toEqual(["groupImpactMemory[*].alienation"]);
  });

  it("удаление записи целиком видно, а её нулевые поля шума не добавляют", () => {
    const changed = collectChangedPaths(
      {
        groupImpactMemory: [
          { regionId: 187, groupId: "lithuanians",
            suppression: 0.3, alienation: 0, concession: 0, emboldenment: 0 },
        ],
      },
      { groupImpactMemory: [] }
    );

    expect(changed).toEqual([
      "groupImpactMemory[*].groupId",
      "groupImpactMemory[*].regionId",
      "groupImpactMemory[*].suppression",
    ]);
  });
});
