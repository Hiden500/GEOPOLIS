import * as ts from "typescript";
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
 *
 * Сами ВЫЗОВЫ ищутся по разобранному дереву, а не регулярным выражением по
 * тексту: текстовый поиск считал запросом ключа и упоминание `t("tier." + tier)`
 * внутри комментария, который как раз объясняет, почему так писать нельзя.
 * Комментарии в дереве — тривия, и в вызов они превратиться не могут.
 *
 * Переводчик узнаётся ДВУМЯ способами, потому что их в проекте два:
 *
 * 1. хук — `useTranslation("ns")` в том же файле;
 * 2. ВПРЫСНУТЫЙ переводчик — `Translator<"ns">` (`../Translator.ts`). Хук
 *    доступен только компонентам, а адаптер модели экрана (`game/adapter.ts`)
 *    компонентом не является и получает переводчик параметром. Его объявление
 *    живёт в другом файле, чем вызовы, поэтому единственная зацепка — аннотация
 *    типа рядом с вызовами. Без второго способа три десятка подписей адаптера
 *    оказались бы вне проверки, и первая опечатка вышла бы к игроку сырым
 *    идентификатором.
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

/** Какое имя переменной к какому namespace привязано хуком в этом файле. */
function translators(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const declaration = /const\s*\{[^}]*?\bt\b\s*(?::\s*(\w+))?[^}]*\}\s*=\s*useTranslation\(\s*"([^"]+)"\s*\)/g;
  for (const match of text.matchAll(declaration)) {
    found.set(match[1] ?? "t", match[2]);
  }
  return found;
}

/**
 * Какое имя привязано к namespace АННОТАЦИЕЙ `Translator<"ns">` в этом файле.
 * Учитываются все три формы, которыми проект такой переводчик объявляет:
 * локальный псевдоним типа (`type T = Translator<"adapter">` и дальше `t: T`),
 * поле или параметр напрямую (`t: Translator<"adapter">`) и переменная из
 * `useCallback<Translator<"adapter">>`.
 */
function injectedTranslators(text: string): Map<string, string> {
  const found = new Map<string, string>();

  const aliases = new Map<string, string>();
  for (const match of text.matchAll(/type\s+(\w+)\s*=\s*Translator<"([^"]+)">/g)) {
    aliases.set(match[1], match[2]);
  }

  for (const match of text.matchAll(/(\w+)\s*:\s*Translator<"([^"]+)">/g)) {
    found.set(match[1], match[2]);
  }
  for (const match of text.matchAll(/(\w+)\s*=\s*useCallback<Translator<"([^"]+)">>/g)) {
    found.set(match[1], match[2]);
  }
  if (aliases.size > 0) {
    const byAlias = new RegExp(`(\\w+)\\s*:\\s*(${[...aliases.keys()].join("|")})\\b`, "g");
    for (const match of text.matchAll(byAlias)) {
      const namespace = aliases.get(match[2]);
      if (namespace !== undefined) found.set(match[1], namespace);
    }
  }

  // Сам псевдоним переводчиком не является: `type T = …` объявляет тип, а не
  // переменную, которую вызывают.
  for (const alias of aliases.keys()) found.delete(alias);
  return found;
}

interface Request {
  file: string;
  namespace: string;
  key: string;
  /** Каким способом найден переводчик — по этому есть отдельная проверка ниже. */
  via: "hook" | "injected";
}

const requests: Request[] = [];

/**
 * Вызовы `alias("literal", …)` в разобранном файле. Пропускаются намеренно два
 * случая: первым аргументом не строковый литерал (ключ собирается в рантайме и
 * статически непроверяем) и вызов с `defaultValue` (автор заявил отсутствие
 * ключа допустимым).
 */
function collectCalls(
  path: string,
  text: string,
  byAlias: Map<string, Map<string, string>>,
): void {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      for (const [via, aliases] of byAlias) {
        const namespace = aliases.get(node.expression.text);
        const [key, ...rest] = node.arguments;
        if (namespace !== undefined && key !== undefined && ts.isStringLiteral(key)) {
          const optedOut = rest.some((argument) => argument.getText(source).includes("defaultValue"));
          if (!optedOut) {
            requests.push({
              file: path.replace("../../", ""),
              namespace,
              key: key.text,
              via: via as Request["via"],
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
}

for (const [path, text] of Object.entries(sources)) {
  if (/\.test\.tsx?$/.test(path)) continue;
  collectCalls(
    path,
    text,
    new Map([
      ["hook", translators(text)],
      ["injected", injectedTranslators(text)],
    ]),
  );
}

describe("словарь локализации", () => {
  it("находит хотя бы один запрос ключа — иначе проверка ничего не значит", () => {
    expect(requests.length).toBeGreaterThan(0);
  });

  /*
   * Оба способа обязаны находить хоть что-то. Регулярное выражение, которое
   * перестало узнавать переводчик, не падает — оно просто перестаёт видеть его
   * ключи, и проверка молча сжимается до половины интерфейса. Именно так дефект
   * и дожил бы до игрока: словарь адаптера не проверялся бы вовсе.
   */
  it.each(["hook", "injected"] as const)("видит ключи у переводчика способом %s", (via) => {
    expect(requests.filter((request) => request.via === via).length).toBeGreaterThan(0);
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
