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
      stability: 50,
      legitimacy: 50,
      corruption: 20,
      governmentSupport: 50,
    },
  } as unknown as Country;
}

function textOf(country: Country, anchors: IdeologyAnchor[], roster: Country[] = []): string {
  return (
    render(<PoliticsBook country={country} ideologyAnchors={anchors} countries={[country, ...roster]} />)
      .container.textContent ?? ""
  );
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

  it("суверенная страна не подписывается суверенитетом — только формой власти", () => {
    const country = countryAt(-0.96, -0.95);
    country.politics.powerStructure = "one_party";
    country.politics.sovereigntyStatus = "sovereign";
    country.politics.overlordIds = [];

    const text = textOf(country, [ANCHOR]);

    expect(text).toContain("Однопартийный режим");
    // Подписывать суверенитетом большинство стран значит писать «обычное» там,
    // где строка должна сообщать особенное.
    expect(text).not.toContain("Суверенное государство");
  });

  it("зависимая страна названа статусом и метрополией по имени, а не по коду", () => {
    const overlord = { ...countryAt(0.4, 0.9), id: "GBR", shortName: { ru: "Великобритания", en: "United Kingdom" } };
    const colony = countryAt(0.2, -0.8);
    colony.politics.powerStructure = "colonial_administration";
    colony.politics.sovereigntyStatus = "colony";
    colony.politics.overlordIds = ["GBR"];

    const text = textOf(colony, [ANCHOR], [overlord]);

    expect(text).toContain("Колония");
    expect(text).toContain("Великобритания");
    expect(text).not.toContain("GBR");
  });

  it("кондоминиум называет обе державы", () => {
    const a = { ...countryAt(0.4, 0.9), id: "GBR", shortName: { ru: "Великобритания", en: "United Kingdom" } };
    const b = { ...countryAt(0.3, -0.1), id: "EGY", shortName: { ru: "Египет", en: "Egypt" } };
    const subject = countryAt(0.2, -0.6);
    subject.politics.powerStructure = "colonial_administration";
    subject.politics.sovereigntyStatus = "condominium";
    subject.politics.overlordIds = ["GBR", "EGY"];

    const text = textOf(subject, [ANCHOR], [a, b]);

    expect(text).toContain("Великобритания");
    expect(text).toContain("Египет");
  });

  it("форма власти и статус переводятся вместе с интерфейсом", async () => {
    const previous = i18n.language;
    try {
      await i18n.changeLanguage("en");
      const overlord = { ...countryAt(0.4, 0.9), id: "GBR", shortName: { ru: "Великобритания", en: "United Kingdom" } };
      const colony = countryAt(0.2, -0.8);
      colony.politics.powerStructure = "colonial_administration";
      colony.politics.sovereigntyStatus = "colony";
      colony.politics.overlordIds = ["GBR"];

      const text = textOf(colony, [ANCHOR], [overlord]);

      expect(text).toContain("Colonial administration");
      expect(text).toContain("Colony");
      expect(text).toContain("United Kingdom");
    } finally {
      await i18n.changeLanguage(previous);
    }
  });

  it("страна без разметки не показывает ни формы власти, ни статуса", () => {
    // Сценарии без слоя government.json (1836/2000) обязаны остаться без
    // ярлыка, а не получить выдуманный — как было с литералом "Unknown".
    const text = textOf(countryAt(-0.96, -0.95), [ANCHOR]);
    expect(text).not.toContain("Unknown");
    expect(text).not.toContain("Суверенное государство");
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
