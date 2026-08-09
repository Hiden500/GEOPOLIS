import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * КЛАСС ДЕФЕКТА: русская строка, вписанная в код игрового слоя вместо словаря.
 *
 * Такую строку не видит ни компилятор, ни один существующий тест: она просто
 * остаётся русской при английском интерфейсе. Долг накапливался месяцами именно
 * так — по одной подписи за правку (`docs/LOCALIZATION.md`), и заметить его
 * можно было только открыв игру на английском.
 *
 * Проверяемое свойство: в `client/src/game/**` кириллица встречается только в
 * КОММЕНТАРИЯХ. Русских комментариев здесь много, они объясняют решения и
 * удалять их нельзя, поэтому «кода» и «комментария» тест различает разбором
 * файла, а не списком исключений: список умер бы от первого же комментария, и
 * дальше его пришлось бы пополнять вместо того, чтобы чинить дефект.
 *
 * Как именно различает: файл разбирается в дерево, и кириллица ищется ТОЛЬКО в
 * узлах-литералах — строковых, шаблонных и текстовых узлах JSX. Комментарий
 * узлом не является вовсе (в терминах компилятора это «тривия»), поэтому его
 * содержимое сюда не попадает НИКАКИМ образом: ни одинарные и двойные кавычки
 * внутри, ни многострочность, ни вложенные `//` не превращают комментарий в
 * литерал. Текстовый поиск с вырезанием комментариев регулярным выражением так
 * не умеет — на апострофе в русском комментарии он начинает считать остаток
 * файла строкой и перестаёт замечать настоящие дефекты молча.
 *
 * Границы, названные честно:
 * - песочница (`client/src/proto/`, `client/src/dev/`) сюда не входит: она живёт
 *   без словаря СОЗНАТЕЛЬНО (`docs/UI_DESIGN.md` §6) — это превью формы, а не
 *   игра;
 * - регулярные выражения не проверяются: кириллица в них — правило разбора, а не
 *   текст для игрока;
 * - тесты не проверяются: русский текст сообщения об ошибке нужен читателю
 *   отчёта, а не игроку.
 */

const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
});

const CYRILLIC = /[Ѐ-ӿ]/;

interface Finding {
  /** `game/Screen.tsx:718` — файл и строка, чтобы дефект был сразу находим. */
  where: string;
  text: string;
}

/** Кириллица в литералах разобранного файла. Комментарии в разбор не попадают. */
function literalsWithCyrillic(path: string, text: string): Finding[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Finding[] = [];

  const report = (node: ts.Node, value: string): void => {
    if (!CYRILLIC.test(value)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ where: `${path.replace("../", "game/")}:${line + 1}`, text: value.trim() });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      report(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // Шаблонная строка: текстовые куски — литералы, подстановки — обычные
      // выражения, и в них обход продолжается ниже.
      report(node.head, node.head.text);
      for (const span of node.templateSpans) report(span.literal, span.literal.text);
    } else if (ts.isJsxText(node)) {
      report(node, node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/*
 * Образец для самопроверки. Держит ровно то, чем этот тест ценен: комментарий с
 * кавычками, апострофом и многострочностью — не дефект, а литерал в коде и текст
 * в JSX — дефект.
 */
const SAMPLE = `/*
 * Панель «Приказы» — это не 'то', что было раньше; см. // и /* внутри.
 */
// Ещё один комментарий: «Держава» и "Регион".
const hidden = "Ключ";
export function Sample() {
  return <p title={"Подсказка"}>Текст в JSX</p>;
}
`;

describe("игровой слой не держит русских строк в коде", () => {
  it("образец: комментарии пропущены, литералы и текст JSX найдены", () => {
    const found = literalsWithCyrillic("../sample.tsx", SAMPLE).map((item) => item.text);

    expect(found).toEqual(["Ключ", "Подсказка", "Текст в JSX"]);
  });

  it("находит хотя бы один файл — иначе проверка ничего не значит", () => {
    const scanned = Object.keys(sources).filter((path) => !/\.test\.tsx?$/.test(path));

    expect(scanned.length).toBeGreaterThan(0);
  });

  it("в client/src/game/** русские строки живут только в словаре", () => {
    const found: Finding[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(path)) continue;
      found.push(...literalsWithCyrillic(path, text));
    }

    expect(found.map((item) => `${item.where}: «${item.text}»`)).toEqual([]);
  });
});
