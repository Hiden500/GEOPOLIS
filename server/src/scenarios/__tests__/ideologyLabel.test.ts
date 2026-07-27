import { describe, it, expect } from "vitest";
import {
  ECONOMIC_BANDS,
  POLITICAL_BANDS,
  bandFor,
  type IdeologyBand,
} from "@shared/defines/ideologyBands";
import { resolveIdeologyLabel } from "@shared/utils/ideologyLabel";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";
import { IDEOLOGY_AXIS_MAX, IDEOLOGY_AXIS_MIN } from "@shared/types/politics/Ideology";
import { createGame } from "../../game/CreateGame";

/**
 * Каталог зон проверяется СВОЙСТВАМИ, а не снимком: списка «страна → ожидаемый
 * ярлык» здесь нет намеренно. Такой список пришлось бы переписывать при каждом
 * уточнении координат — а координаты 1946 ещё уточняются (docs/TODO.md), — и
 * он проверял бы совпадение данных с самими собой, а не работу механизма.
 */
describe("шкалы идеологии покрывают спектр", () => {
  it.each([
    ["экономическая", ECONOMIC_BANDS],
    ["политическая", POLITICAL_BANDS],
  ])("%s: ступени смыкаются, покрывают [-1,1] и не перекрываются", (_label, bands) => {
    expect(bands[0]!.from).toBe(IDEOLOGY_AXIS_MIN);
    expect(bands[bands.length - 1]!.to).toBe(IDEOLOGY_AXIS_MAX);

    const gaps = bands
      .slice(1)
      .map((band, i) => ({ prev: bands[i]!.to, next: band.from }))
      .filter(pair => pair.prev !== pair.next);
    expect(gaps).toEqual([]);
  });

  it.each([
    ["экономическая", ECONOMIC_BANDS],
    ["политическая", POLITICAL_BANDS],
  ])("%s: ключи ступеней уникальны", (_label, bands) => {
    expect(new Set(bands.map(b => b.key)).size).toBe(bands.length);
  });

  it("любая точка шкалы попадает ровно в одну ступень", () => {
    const bands: readonly IdeologyBand[] = ECONOMIC_BANDS;
    // Шаг мельче самой узкой ступени, плюс сами границы — там ошибка
    // полуоткрытого интервала и живёт.
    const probes = [
      ...Array.from({ length: 201 }, (_, i) => -1 + i * 0.01),
      ...bands.map(b => b.from),
      ...bands.map(b => b.to),
    ];
    for (const value of probes) {
      const matching = bands.filter(b => value >= b.from && value < b.to);
      // Верхняя граница оси не входит ни в один полуоткрытый интервал —
      // для неё bandFor обязан вернуть последнюю ступень, а не ничего.
      expect(matching.length).toBeLessThanOrEqual(1);
      expect(bandFor(bands, value)).toBeDefined();
    }
  });

  it("координата за пределами шкалы прижимается к краю, а не теряется", () => {
    expect(bandFor(ECONOMIC_BANDS, -5)).toBe(ECONOMIC_BANDS[0]);
    expect(bandFor(ECONOMIC_BANDS, 5)).toBe(ECONOMIC_BANDS[ECONOMIC_BANDS.length - 1]);
    expect(bandFor(ECONOMIC_BANDS, IDEOLOGY_AXIS_MAX)).toBe(
      ECONOMIC_BANDS[ECONOMIC_BANDS.length - 1]
    );
  });
});

describe("ярлык выбирается якорем, потом ступенями", () => {
  const anchor = (id: string, economic: number, political: number, radius: number): IdeologyAnchor => ({
    id,
    center: { economic, political },
    radius,
    name: { en: id },
  });

  it("точка внутри радиуса получает имя якоря", () => {
    const label = resolveIdeologyLabel({ economic: -0.9, political: -0.9 }, [
      anchor("state_socialism", -0.9, -0.91, 0.14),
    ]);
    expect(label.kind).toBe("anchor");
    expect(label.kind === "anchor" && label.anchor.id).toBe("state_socialism");
  });

  it("точка вне радиуса получает склейку ступеней", () => {
    const label = resolveIdeologyLabel({ economic: 0.35, political: -0.9 }, [
      anchor("state_socialism", -0.9, -0.91, 0.14),
    ]);
    expect(label.kind).toBe("bands");
  });

  it("при двух накрывающих якорях побеждает БЛИЖАЙШИЙ, а не первый в списке", () => {
    const point = { economic: 0, political: 0 };
    const far = anchor("far", 0.3, 0, 0.5);
    const near = anchor("near", 0.05, 0, 0.5);

    // Оба порядка дают один результат: иначе ярлык зависел бы от порядка
    // записей в файле данных, то есть от случайности.
    for (const anchors of [[far, near], [near, far]]) {
      const label = resolveIdeologyLabel(point, anchors);
      expect(label.kind === "anchor" && label.anchor.id).toBe("near");
    }
  });

  it("пустой каталог — рабочее состояние, а не отказ", () => {
    const label = resolveIdeologyLabel({ economic: 0, political: 0 }, []);
    expect(label.kind).toBe("bands");
  });

  it("точка ровно на границе радиуса накрывается якорем", () => {
    const label = resolveIdeologyLabel({ economic: 0.1, political: 0 }, [
      anchor("edge", 0, 0, 0.1),
    ]);
    expect(label.kind).toBe("anchor");
  });
});

describe("каталог 1946 на боевых данных", () => {
  it("загружается в состояние партии и покрывает страны с координатами", () => {
    const game = createGame("1946", "SUN", "ru", 1);

    expect(game.ideologyAnchors.length).toBeGreaterThan(0);
    expect(new Set(game.ideologyAnchors.map(a => a.id)).size).toBe(game.ideologyAnchors.length);

    // Каждая страна с координатами получает НЕПУСТОЙ ярлык одного из двух
    // видов. Конкретные имена не проверяются: они меняются с уточнением
    // координат, а вот «ярлык есть у каждого» — свойство механизма.
    const withCoordinates = game.countries.filter(c => c.politics.ideologyCoordinates);
    expect(withCoordinates.length).toBeGreaterThan(0);

    for (const country of withCoordinates) {
      const label = resolveIdeologyLabel(country.politics.ideologyCoordinates!, game.ideologyAnchors);
      if (label.kind === "anchor") {
        expect(label.anchor.name.en).toBeTruthy();
      } else {
        expect(label.economic.key).toBeTruthy();
        expect(label.political.key).toBeTruthy();
      }
    }
  });

  it("каждый якорь каталога имеет имя на обеих локалях", () => {
    const game = createGame("1946", "SUN", "ru", 1);
    const missing = game.ideologyAnchors.filter(a => !a.name.en || !a.name.ru);
    expect(missing.map(a => a.id)).toEqual([]);
  });

  it("якоря каталога не перекрываются центрами друг друга", () => {
    // Перекрытие радиусов допустимо (побеждает ближайший), но якорь, чей ЦЕНТР
    // лежит внутри другого якоря, недостижим ни для одной точки.
    const game = createGame("1946", "SUN", "ru", 1);
    const swallowed = game.ideologyAnchors.filter(a =>
      game.ideologyAnchors.some(
        other =>
          other.id !== a.id &&
          Math.hypot(
            a.center.economic - other.center.economic,
            a.center.political - other.center.political
          ) < other.radius
      )
    );
    expect(swallowed.map(a => a.id)).toEqual([]);
  });
});
