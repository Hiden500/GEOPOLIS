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
  it("создание записи — ОДНО заявление (маркер), а не поля нового объекта", () => {
    // Милстоун 1, сессия жизненного цикла: появление элемента массива со
    // стабильным ключом отмечается маркером `[+]`, и внутрь него диф не
    // заходит. Палитра защищает СУЩЕСТВУЮЩЕЕ состояние от побочных эффектов;
    // форму объекта, который глагол вправе создать, whitelist описывать не
    // должен — иначе он превращается в копию определения типа.
    const changed = collectChangedPaths(
      { groupImpactMemory: [] },
      {
        groupImpactMemory: [
          { regionId: 187, groupId: "lithuanians",
            suppression: 0.3, alienation: 0, concession: 0, emboldenment: 0 },
        ],
      }
    );

    expect(changed).toEqual(["groupImpactMemory[+]"]);
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

  it("удаление записи — ОДНО заявление (маркер), а не россыпь её полей", () => {
    const changed = collectChangedPaths(
      {
        groupImpactMemory: [
          { regionId: 187, groupId: "lithuanians",
            suppression: 0.3, alienation: 0, concession: 0, emboldenment: 0 },
        ],
      },
      { groupImpactMemory: [] }
    );

    // Милстоун 1, сессия жизненного цикла: элементы сопоставляются по
    // стабильному ключу, поэтому пропавший элемент опознан как пропавший и
    // внутрь него диф не заходит. До этого маркер ДОБАВЛЯЛСЯ к полям
    // удалённой записи, и отказ палитры перечислял пути, которые не менялись.
    expect(changed).toEqual(["groupImpactMemory[-]"]);
  });

  it("перестановка элементов изменением НЕ считается", () => {
    // Прямое следствие сопоставления по ключу: до него обмен местами двух
    // записей метил изменёнными все поля обеих.
    const a = { regionId: 187, groupId: "lithuanians",
      suppression: 0.3, alienation: 0, concession: 0, emboldenment: 0 };
    const b = { regionId: 68, groupId: "estonians",
      suppression: 0, alienation: 0.2, concession: 0, emboldenment: 0 };

    expect(
      collectChangedPaths({ groupImpactMemory: [a, b] }, { groupImpactMemory: [b, a] })
    ).toEqual([]);
  });

  it("удаление из СЕРЕДИНЫ не метит изменённым хвост", () => {
    const first = { id: "mf-1", type: "protest", tags: ["a"] };
    const second = { id: "mf-2", type: "uprising", tags: ["b"] };
    const third = { id: "mf-3", type: "border_dispute", tags: ["c"] };

    // Хвост (`mf-3`) не менялся ни одним полем — и в дифе его быть не должно.
    // Позиционное сравнение метило бы `type` и `tags[*]`, а на массиве тегов
    // выставляло бы ещё и ложный маркер удаления.
    expect(
      collectChangedPaths(
        { mapFeatures: [first, second, third] },
        { mapFeatures: [first, third] }
      )
    ).toEqual(["mapFeatures[-]"]);
  });
});
