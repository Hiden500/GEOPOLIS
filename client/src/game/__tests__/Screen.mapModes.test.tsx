// @vitest-environment happy-dom
/**
 * РЕЖИМЫ и ЛЕГЕНДА игрового экрана — на модели, собранной АДАПТЕРОМ.
 *
 * Окружение задано пофайлово: остальным тестам клиента DOM не нужен, и менять
 * его для всех ради одного файла значило бы платить за него везде.
 *
 * Модель здесь собирается `buildScreenModel` из фикстуры `GameState`, а не
 * пишется прямо под тест. Это принципиально: проверяется СТЫК адаптера с
 * экраном. Дефект, ради которого тест написан, жил именно на стыке — экран
 * искал иконку и легенду по ключам ПЕСОЧНИЦЫ (`discontent`, `armies`,
 * `terrain`), а игра передавала шифры движка (`sta`, `mil`, `inf`).
 * Пересечение множеств было пустым: в игре все кнопки режимов рисовались без
 * иконок, а легенда не появлялась никогда. Модель, написанная под тест, этого
 * не показала бы — она повторила бы словарь автора теста.
 *
 * Снимков вёрстки здесь нет намеренно: снимок ломается от любой правки
 * оформления и не проверяет ни одного свойства.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeMapModeColors, legendForMode } from "../mapModeColors";
import { MAP_MODE_ORDER } from "../model";
/*
 * Фикстура и сборка модели живут в `src/test/screenHarness.tsx`: их делит с
 * этим файлом проверка раскладки рамы (`Screen.frame.test.tsx`), а копия
 * фикстуры разошлась бы с оригиналом на первой же правке.
 */
import { gameState, renderScreen, t } from "../../test/screenHarness";

/** «#7aa653» и «rgb(122, 166, 83)» — один цвет; сравнивать надо не строки. */
function rgb(value: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const n = Number.parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const parts = value.match(/\d+/g);
  if (parts === null) throw new Error(`образец легенды без цвета: «${value}»`);
  return parts.slice(0, 3).join(",");
}

afterEach(cleanup);

describe("РЕЖИМЫ карты", () => {
  it("проверяет непустой список режимов — иначе проверки ниже ничего не значат", () => {
    expect(MAP_MODE_ORDER.length).toBeGreaterThan(0);
  });

  it("у каждой кнопки режима есть иконка", () => {
    renderScreen("powers");

    for (const mode of MAP_MODE_ORDER) {
      const button = screen.getByRole("button", { name: t(`mapModes.${mode}`) });
      expect(button.querySelector("svg"), `режим ${mode} без иконки`).not.toBeNull();
    }
  });

  /*
   * Состояние кнопки обязано быть доступно не только глазам: вид нажатой кнопки
   * скринридеру не виден, а «какой режим включён» — это ровно то, что панель
   * сообщает (`docs/UI_DESIGN.md` §9). Крючок `aria-pressed` держит ещё и
   * акцентную подсветку глифа в CSS — то есть свойство и вид не разойдутся.
   */
  it("включённый режим назван нажатым, остальные — нет", () => {
    renderScreen("unrest");

    for (const mode of MAP_MODE_ORDER) {
      const button = screen.getByRole("button", { name: t(`mapModes.${mode}`) });
      expect(button.getAttribute("aria-pressed"), `режим ${mode}`).toBe(
        mode === "unrest" ? "true" : "false",
      );
    }
  });

  it("сетка режимов названа группой", () => {
    renderScreen("powers");

    const group = screen.getByRole("group", { name: t("mapModesGroup") });
    expect(within(group).getAllByRole("button")).toHaveLength(MAP_MODE_ORDER.length);
  });

  it("кнопок ровно столько, сколько режимов в словаре", () => {
    renderScreen("powers");

    const labels = MAP_MODE_ORDER.map((mode) => t(`mapModes.${mode}`));
    const shown = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((label): label is string => label !== null && labels.includes(label));
    expect(shown).toHaveLength(MAP_MODE_ORDER.length);
  });
});

describe("ЛЕГЕНДА карты", () => {
  /*
   * Свойство: легенда объясняет РОВНО те цвета, которые раскраска действительно
   * выдаёт на этих данных. Не «легенда непустая» и не «цвета из палитры» —
   * именно совпадение множеств. Разошлись — либо легенда обещает градацию,
   * которой карта не рисует, либо карта рисует цвет, которого легенда не
   * объясняет.
   */
  it.each(MAP_MODE_ORDER)("в режиме %s объясняет ровно нарисованные цвета", (mode) => {
    const game = gameState();
    const painted = computeMapModeColors(mode, game.regions, game.countries, game.playerCountryId);
    const explained = legendForMode(mode).map((item) => item.swatch);

    expect(new Set(Object.values(painted ?? {}))).toEqual(new Set(explained));
  });

  /*
   * Градаций там нет — и списка легенды в доступном дереве тоже. Пустая КОРОБКА
   * при этом в разметке есть: она держит место, чтобы панель не прыгала при
   * переключении режима (`Screen.frame.test.tsx`), но скрыта `aria-hidden` и
   * потому по роли не находится.
   */
  it("не объявляется там, где цвет не означает величину", () => {
    renderScreen("powers");

    expect(legendForMode("powers")).toHaveLength(0);
    expect(screen.queryByRole("list", { name: t("mapModes.powers") })).toBeNull();
    // Имя режима видно и без легенды: панель обязана называть то, что показывает.
    expect(screen.getByText(t("mapModes.powers"))).not.toBeNull();
  });

  it.each(MAP_MODE_ORDER.filter((mode) => legendForMode(mode).length > 0))(
    "в режиме %s показывает подпись и образец каждой градации",
    (mode) => {
      renderScreen(mode);

      /*
       * Легенда ищется по ИМЕНИ АКТИВНОГО РЕЖИМА: её доступное имя — тот самый
       * видимый заголовок панели (`aria-labelledby`), поэтому проверка заодно
       * доказывает, что панель называет показанное.
       */
      const legenda = screen.getByRole("list", { name: t(`mapModes.${mode}`) });
      const items = within(legenda).getAllByRole("listitem");
      const expected = legendForMode(mode);

      expect(items).toHaveLength(expected.length);
      items.forEach((item, index) => {
        const swatch = item.querySelector("span");
        expect(swatch, "образец цвета не нарисован").not.toBeNull();
        expect(rgb((swatch as HTMLElement).style.background)).toBe(rgb(expected[index].swatch));
        // Подпись взята из словаря — и это НЕ сам ключ: i18next возвращает
        // ключ, когда строки нет, и сравнение с `t()` тогда сошлось бы само с
        // собой.
        const label = t(`legend.${expected[index].labelKey}`);
        expect(label).not.toContain("legend.");
        expect(item.textContent).toBe(label);
      });
    },
  );
});
