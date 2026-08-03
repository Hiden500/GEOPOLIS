import { describe, it, expect } from "vitest";
import {
  ASSET_KINDS,
  ASSET_TEMPLATES,
  buildAssetPrompt,
  type AssetKind,
} from "../../scripts/assetPrompts";

/**
 * Промты генерации ассетов живут в `scripts/`, а тест — здесь, и это не
 * небрежность: серверный `vitest.config.ts` ищет тесты только в `src/**` и
 * `../shared/src/**`. Файл `scripts/__tests__/…` не запускался бы НИГДЕ —
 * ровно та мёртвая проверка, о которой предупреждает комментарий в самом
 * конфиге.
 */
describe("промты генерации ассетов", () => {
  it("каждый вид даёт промт с предметом, запретом надписей и формой кадра", () => {
    for (const kind of ASSET_KINDS) {
      const prompt = buildAssetPrompt(kind, "SUBJECT-MARKER");

      expect(prompt, kind).toContain("SUBJECT-MARKER");
      // Надписи запрещены ВЕЗДЕ: модель рисует буквоподобные значки, которые
      // нельзя ни прочитать, ни локализовать (docs/LOCALIZATION.md).
      expect(prompt, kind).toContain("No text");
      expect(prompt, kind).toContain(ASSET_TEMPLATES[kind].aspect);
    }
  });

  it("объявленная в тексте форма кадра совпадает с числом, по которому её проверяют", () => {
    // Связь текста и числа — единственное место, где шаблон может разойтись
    // САМ С СОБОЙ: промт просит одно, приёмка ассета сверяет другое, и
    // расхождение видно только глазами на готовой картинке.
    const parse = (aspect: string): number => {
      const ratio = /(\d+):(\d+)/.exec(aspect);
      expect(ratio, `в "${aspect}" нет пропорции вида N:M`).not.toBeNull();
      return Number(ratio![1]) / Number(ratio![2]);
    };

    for (const kind of ASSET_KINDS) {
      const template = ASSET_TEMPLATES[kind];
      expect(parse(template.aspect), kind).toBeCloseTo(template.expectedRatio, 4);
    }
  });

  it("флагу НЕ навязывается стиль печати эпохи — он геральдика, а не бумага", () => {
    // Осознанное исключение: общий якорь просит выцветшую палитру и зерно
    // бумаги, а флагу нужны плоские заливки и резкие края. Тест держит это
    // решение, чтобы «унифицировать шаблоны» не сделали флаг ветхим.
    const flag = buildAssetPrompt("flag", "x");
    const portrait = buildAssetPrompt("portrait", "x");

    expect(portrait).toContain("paper grain");
    expect(flag).not.toContain("paper grain");
    expect(flag).toContain("solid colours");
  });

  it("покрывает КАЖДЫЙ объявленный вид — новый вид не проскочит без шаблона", () => {
    // `Record<AssetKind, …>` ловит это на компиляции, но только пока список
    // видов и таблица шаблонов связаны типом; тест держит связь и в рантайме.
    const kinds = Object.keys(ASSET_TEMPLATES) as AssetKind[];
    expect(new Set(kinds)).toEqual(new Set(ASSET_KINDS));
  });
});
