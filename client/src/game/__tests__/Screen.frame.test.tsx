// @vitest-environment happy-dom
/**
 * РАСКЛАДКА ИГРОВОГО ЭКРАНА: рама и поверхности приклеены к краю оболочки.
 *
 * КЛАСС ДЕФЕКТА. ШАПКИ не было на экране вообще: `ShapedBar` ставил корню
 * панели ИНЛАЙНОВЫЙ `position: relative`, а инлайновый стиль сильнее любого
 * правила таблицы — поэтому `.shapka { position: absolute; top: 0 }` не мог
 * выиграть никогда. Панель оставалась в обычном потоке ПОСЛЕ контейнера карты,
 * тот занимает всю оболочку, и рама уезжала под нижний край окна (замер в живой
 * партии 2026-08-09: `y = 1080` при `innerHeight = 1080`). Игрок не видел ни
 * одного ПРИБОРА и не мог открыть ни один ТОМ.
 *
 * Почему прежняя приёмка это пропустила: мерили переполнение ВНУТРИ панели, а
 * не её положение НА ЭКРАНЕ. Отсюда предмет этого файла — именно положение.
 *
 * Границы, названные честно. Проверяются ВЫЧИСЛЕННЫЕ свойства, а не пиксели:
 * движка раскладки у happy-dom нет, `getBoundingClientRect` в нём всегда нули,
 * и никакой тест в `npm test` не может измерить, где панель оказалась. Но
 * причина дефекта была ровно в вычисленном свойстве: `relative` вместо
 * `absolute`. Что при `absolute` от края панель действительно попадает в окно,
 * проверяется замером в живом приложении и в отчёте, а не здесь.
 *
 * Чтобы это работало, `vitest.config.ts` РЕАЛЬНО подключает CSS-модули к
 * документу теста (по умолчанию vitest их выбрасывает).
 */
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAP_MODE_ORDER } from "../model";
import styles from "../Screen.module.css";
import { renderScreen } from "../../test/screenHarness";

afterEach(cleanup);

/** Единственный узел с этим классом модуля. Нет — тест обязан сказать, какого. */
function one(container: HTMLElement, className: string, what: string): HTMLElement {
  const found = container.querySelectorAll<HTMLElement>(`.${className}`);
  expect(found.length, `${what}: узлов с классом ${className} — ${found.length}`).toBe(1);
  return found[0];
}

/*
 * Проверка окружения. Без неё весь файл превращается в зелёный шум: если
 * CSS-модули не подключены, `getComputedStyle` возвращает пустоту, и любое
 * сравнение с ней сойдётся само с собой.
 */
describe("окружение проверки раскладки", () => {
  it("таблицы стилей действительно применяются", () => {
    const { container } = renderScreen("powers");
    const hod = one(container, styles.hod, "ХОД");

    expect(getComputedStyle(hod).position, "CSS-модули не подключены к документу").toBe("absolute");
  });
});

describe("рама приклеена к краю окна", () => {
  /*
   * ШАПКА — левый верхний угол. Это и есть тот самый дефект: `top`/`left`
   * ничего не значат, пока панель `relative` в потоке.
   */
  it("ШАПКА стоит от левого верхнего угла оболочки", () => {
    const { container } = renderScreen("powers");
    const shapka = one(container, styles.shapka, "ШАПКА");
    const cs = getComputedStyle(shapka);

    expect(cs.position, "ШАПКА не приклеена: панель уедет туда, куда её вынесет поток").toBe(
      "absolute",
    );
    expect(cs.top).toBe("0px");
    expect(cs.left).toBe("0px");
  });

  it("ХОД стоит от правого верхнего угла оболочки", () => {
    const { container } = renderScreen("powers");
    const cs = getComputedStyle(one(container, styles.hod, "ХОД"));

    expect(cs.position).toBe("absolute");
    expect(cs.top).toBe("0px");
    expect(cs.right).toBe("0px");
  });

  /*
   * Отдельная проверка ПРИЧИНЫ, а не только следствия. Инлайновый стиль на
   * корне панели — единственное, чем таблицу раскладки перебить нельзя;
   * вернётся он — вернётся и дефект, поэтому запрет проверяется прямо.
   */
  it("корень панели рамы не носит инлайнового position", () => {
    const { container } = renderScreen("powers");
    const shapka = one(container, styles.shapka, "ШАПКА");

    expect(
      shapka.style.position,
      "инлайновый position сильнее любого класса — размещать панель станет нечем",
    ).toBe("");
  });

  /*
   * Поверхности, прижатые к низу. Здесь проверяется только «не в потоке»:
   * их отступы заданы токеном `--frame-gap` из глобальной таблицы, а она в
   * тестах не подключена — сравнивать пиксели было бы сравнением с пустотой.
   */
  it.each([
    ["ПОЛОСА", () => styles.polosa],
    ["ЛИСТ", () => styles.bottom],
    ["правый столбец с РЕЖИМАМИ", () => styles.rightStack],
  ])("%s вынесена из потока и позиционируется от края", (what, className) => {
    const { container } = renderScreen("powers", "1");
    const cs = getComputedStyle(one(container, className(), what));

    expect(cs.position, `${what} в обычном потоке — её вынесет за край экрана`).toBe("absolute");
  });
});

describe("РЕЖИМЫ не дышат при переключении", () => {
  it("проверяет непустой список режимов — иначе проверка ничего не значит", () => {
    expect(MAP_MODE_ORDER.length).toBeGreaterThan(1);
  });

  /*
   * Свойство: место под ЛЕГЕНДУ отведено в КАЖДОМ режиме. Высоту панели тест
   * измерить не может (движка раскладки нет), но причина скачка была не в
   * пикселях: у «Держав» — режима по умолчанию — легенды нет, коробка
   * рендерилась по условию, элемента в разметке не было вовсе, и `min-height`,
   * добавленный против дыхания панели, применять было НЕ К ЧЕМУ. Замер в живой
   * партии 2026-08-09: 64px против 99px, верхний край скакал на 35px.
   */
  it("коробка легенды есть во всех режимах и резервирует одну и ту же высоту", () => {
    const reserved = new Map<string, string>();

    for (const mode of MAP_MODE_ORDER) {
      const { container } = renderScreen(mode);
      const box = one(container, styles.legenda, `коробка легенды в режиме ${mode}`);
      const min = getComputedStyle(box).minHeight;

      expect(min, `в режиме ${mode} место под легенду не зарезервировано`).not.toBe("");
      expect(min, `в режиме ${mode} место под легенду не зарезервировано`).not.toBe("0px");
      expect(min).not.toBe("auto");
      reserved.set(mode, min);
      cleanup();
    }

    expect(new Set(reserved.values()), `резерв разошёлся по режимам: ${[...reserved]}`).toHaveProperty(
      "size",
      1,
    );
  });

  /*
   * Пустая коробка не должна быть слышна: список из нуля пунктов скринридер
   * объявлять не обязан, и имени активного режима ему хватает и без легенды.
   */
  it("пустая коробка легенды скрыта от скринридера, непустая названа режимом", () => {
    const withoutLegend = renderScreen("powers");
    const empty = one(withoutLegend.container, styles.legenda, "коробка легенды «Держав»");

    expect(empty.children.length).toBe(0);
    expect(empty.getAttribute("aria-hidden")).toBe("true");
    expect(empty.getAttribute("aria-labelledby")).toBeNull();
    cleanup();

    const withLegend = renderScreen("industry");
    const filled = one(withLegend.container, styles.legenda, "коробка легенды «Промышленности»");

    expect(filled.children.length).toBeGreaterThan(0);
    expect(filled.getAttribute("aria-hidden")).toBeNull();
    expect(filled.getAttribute("aria-labelledby")).not.toBeNull();
  });
});
