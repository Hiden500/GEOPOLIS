import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Country } from "@shared/types/Country";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";
import i18n from "../../../i18n";
import { PoliticsBook } from "./PoliticsBook";

/**
 * Ярлык идеологии в интерфейсе (каталог зон, 2026-07-27).
 *
 * Проверяется не «панель что-то рисует», а три свойства, ради которых ярлык
 * перестал храниться строкой в данных: он ВЫЧИСЛЯЕТСЯ из координат, он следует
 * за их сдвигом, и его две половины берутся из разных источников — имя якоря из
 * данных сценария, ступени шкалы из словаря интерфейса. Последнее видно на
 * переключении языка: имя якоря и склейка обязаны перевестись оба.
 */

const ANCHOR: IdeologyAnchor = {
  id: "state_socialism",
  center: { economic: -0.9, political: -0.91 },
  radius: 0.14,
  name: { ru: "Государственный социализм", en: "State socialism" },
};

function countryAt(economic: number, political: number): Country {
  return {
    id: "SUN",
    name: { ru: "СССР", en: "USSR" },
    shortName: { ru: "СССР", en: "USSR" },
    color: "#c33",
    politics: {
      ideology: "Communism",
      ideologyCoordinates: { economic, political },
      governmentType: "",
      stability: 50,
      legitimacy: 50,
      corruption: 20,
      governmentSupport: 50,
    },
  } as unknown as Country;
}

function textOf(country: Country, anchors: IdeologyAnchor[]): string {
  return render(<PoliticsBook country={country} ideologyAnchors={anchors} />).container.textContent ?? "";
}

describe("ярлык идеологии в панели политики", () => {
  it("страна внутри якоря показана его именем, а не хранимой строкой", () => {
    const text = textOf(countryAt(-0.96, -0.95), [ANCHOR]);

    expect(text).toContain("Государственный социализм");
    // Хранимое поле politics.ideology осталось в данных как легаси, но игроку
    // оно больше не показывается: показ идёт от координат.
    expect(text).not.toContain("Communism");
  });

  it("сдвиг координат за пределы якоря меняет ярлык на склейку ступеней", () => {
    const inside = textOf(countryAt(-0.96, -0.95), [ANCHOR]);
    const outside = textOf(countryAt(0.35, -0.9), [ANCHOR]);

    expect(inside).not.toBe(outside);
    expect(outside).not.toContain("Государственный социализм");
    expect(outside).toContain("Регулируемый рынок");
    expect(outside).toContain("Закрытая диктатура");
  });

  it("пустой каталог даёт склейку, а не пустое место", () => {
    const text = textOf(countryAt(-0.96, -0.95), []);
    expect(text).toContain("Командная экономика");
    expect(text).toContain("Закрытая диктатура");
  });

  it("обе половины ярлыка переводятся: имя якоря из данных, ступени из словаря", async () => {
    const previous = i18n.language;
    try {
      await i18n.changeLanguage("en");

      expect(textOf(countryAt(-0.96, -0.95), [ANCHOR])).toContain("State socialism");

      const bands = textOf(countryAt(0.35, -0.9), [ANCHOR]);
      expect(bands).toContain("Regulated market");
      expect(bands).toContain("Closed dictatorship");
    } finally {
      await i18n.changeLanguage(previous);
    }
  });
});
