import { describe, expect, it } from "vitest";

/**
 * Ключ, которого нет в словаре, — дефект, невидимый для tsc и для любого
 * теста, который не открыл именно этот экран.
 *
 * Поймано живьём: `GameShell` просил `t("campaign.successionTitle")` из
 * namespace `screen`, а ключа `campaign` в `screen.json` не было вовсе —
 * окно выбора преемника нарисовало бы игроку сырой идентификатор кода.
 * Компиляция была чистой, тесты зелёными: развилка кампании возникает только
 * при распаде державы, а такой партии под рукой не было.
 *
 * Поэтому проверяется СВОЙСТВО, а не список: каждый статический ключ, который
 * код просит у словаря, обязан в этом словаре существовать — в ОБЕИХ локалях.
 * Ключ, собираемый в рантайме (шаблонная строка), и вызов с `defaultValue`
 * пропускаются намеренно: там отсутствие ключа либо непроверяемо, либо
 * заявлено автором как допустимое.
 *
 * Источники берутся через `import.meta.glob`, а не через `node:fs`: у
 * `tsconfig.app.json` типы браузерные (`types: ["vite/client"]`), и тащить в
 * них Node ради одного теста значило бы расширить окружение всего приложения.
 */

const dictionaries = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", {
  eager: true,
  import: "default",
});

const sources = import.meta.glob<string>("../../**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** "../locales/ru/screen.json" → { locale: "ru", namespace: "screen" }. */
function parsePath(path: string): { locale: string; namespace: string } {
  const [, locale, file] = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path) ?? [];
  return { locale, namespace: file };
}

const locales = [...new Set(Object.keys(dictionaries).map((path) => parsePath(path).locale))].sort();

function dictionary(locale: string, namespace: string): unknown {
  const entry = Object.entries(dictionaries).find(([path]) => {
    const parsed = parsePath(path);
    return parsed.locale === locale && parsed.namespace === namespace;
  });
  return entry?.[1];
}

/** Ключ вида "campaign.successionTitle" — обход по точкам. */
function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dict);
}

/**
 * Суффиксы множественного числа i18next: `t("gap", { count })` разрешается в
 * `gap_one`/`gap_few`/`gap_many`/`gap_other`, и голого `gap` в словаре нет и
 * быть не должно. Набор суффиксов зависит от языка (у русского три формы, у
 * английского две), поэтому достаточно, чтобы нашлась ХОТЯ БЫ одна: полноту
 * форм под правила конкретного языка этот тест не проверяет.
 */
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

function exists(dict: unknown, key: string): boolean {
  if (lookup(dict, key) !== undefined) return true;
  return PLURAL_SUFFIXES.some((suffix) => lookup(dict, `${key}_${suffix}`) !== undefined);
}

/** Какое имя переменной к какому namespace привязано в этом файле. */
function translators(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const declaration = /const\s*\{[^}]*?\bt\b\s*(?::\s*(\w+))?[^}]*\}\s*=\s*useTranslation\(\s*"([^"]+)"\s*\)/g;
  for (const match of text.matchAll(declaration)) {
    found.set(match[1] ?? "t", match[2]);
  }
  return found;
}

interface Request {
  file: string;
  namespace: string;
  key: string;
}

const requests: Request[] = [];

for (const [path, text] of Object.entries(sources)) {
  if (/\.test\.tsx?$/.test(path)) continue;
  for (const [alias, namespace] of translators(text)) {
    // Только строковый литерал первым аргументом: шаблонная строка — ключ,
    // собираемый в рантайме, статически он не проверяется.
    const call = new RegExp(`\\b${alias}\\(\\s*"([^"]+)"([^)]*)\\)`, "g");
    for (const match of text.matchAll(call)) {
      if (match[2].includes("defaultValue")) continue;
      requests.push({ file: path.replace("../../", ""), namespace, key: match[1] });
    }
  }
}

describe("словарь локализации", () => {
  it("находит хотя бы один запрос ключа — иначе проверка ничего не значит", () => {
    expect(requests.length).toBeGreaterThan(0);
  });

  for (const locale of locales) {
    it(`в локали ${locale} есть каждый статический ключ, который просит код`, () => {
      const missing = requests
        .filter((request) => !exists(dictionary(locale, request.namespace), request.key))
        .map((request) => `${request.file}: ${request.namespace}:${request.key}`);

      expect(missing).toEqual([]);
    });
  }

  it("во всех локалях одинаковый набор namespace", () => {
    const byLocale = new Map<string, string[]>();
    for (const path of Object.keys(dictionaries)) {
      const { locale, namespace } = parsePath(path);
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), namespace]);
    }
    const sets = [...byLocale.values()].map((list) => list.sort().join(","));
    expect(new Set(sets).size).toBe(1);
  });
});
