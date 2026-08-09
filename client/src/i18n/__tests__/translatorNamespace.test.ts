import { describe, expect, it } from "vitest";
import { type Translator } from "../Translator";

/**
 * ОБЕЩАНИЕ `Translator.ts`: подмену словаря у впрыснутого переводчика ловит
 * КОМПИЛЯТОР — `Translator<"screen">` в слот `Translator<"adapter">` не
 * проходит. Обещание сильнее гарантии — повторяющийся дефект проекта
 * (`AGENTS.md`), поэтому оно проверяется, а не заявляется.
 *
 * Проверка живёт на уровне ТИПОВ, и держит её `npx tsc --noEmit -p
 * tsconfig.app.json`, а не рантайм: `Assignable<A, B>` вычисляет
 * присваиваемость, а объявление `const x: false = ...` падает КОМПИЛЯЦИЕЙ, если
 * ответ окажется другим. Рантайм-проверки ниже нужны затем, чтобы значение
 * нельзя было тихо поправить под тип: `npm test` показывает то же самое.
 *
 * Граница обещания названа честно. Тип помогает там, где переводчик
 * АННОТИРОВАН: `useCallback<Translator<"adapter">>`, поле входа, параметр.
 * Безымянная функция подходящей формы (`(key, params) => string`) проходит в
 * любой слот — необязательного поля у неё просто нет, и запретить это типом
 * нельзя. Именно поэтому namespace впрыснутого переводчика проверяется ВТОРЫМ
 * способом — по словарю (`localeKeys.test.ts`).
 */

/**
 * Присваиваемость как значение типа. Кортежи `[A]`/`[B]` — чтобы объединения не
 * распределялись по ветвям условного типа: без них проверка отвечала бы на
 * другой вопрос.
 */
type Assignable<From, To> = [From] extends [To] ? true : false;

/** Переводчик своего namespace годится — иначе проверка ниже ничего не значит. */
const sameNamespace: Assignable<Translator<"adapter">, Translator<"adapter">> = true;

/** Переводчик ЧУЖОГО namespace не годится. Это и есть обещание. */
const crossNamespace: Assignable<Translator<"screen">, Translator<"adapter">> = false;
const crossNamespaceBack: Assignable<Translator<"adapter">, Translator<"screen">> = false;

/**
 * Безымянная функция подходящей формы проходит в любой слот — граница обещания,
 * а не его нарушение. Записана значением, чтобы правка типа `Translator`,
 * которая внезапно начнёт это запрещать, тоже уронила сборку и потребовала
 * пересмотреть текст обещания.
 */
type BareFunction = (key: string, params?: Record<string, string | number>) => string;
const bareFunctionPasses: Assignable<BareFunction, Translator<"adapter">> = true;

describe("Translator<Namespace>", () => {
  it("переводчик своего namespace подходит", () => {
    expect(sameNamespace).toBe(true);
  });

  it("переводчик чужого namespace не подходит — в обе стороны", () => {
    expect(crossNamespace).toBe(false);
    expect(crossNamespaceBack).toBe(false);
  });

  it("безымянная функция подходящей формы проходит — заявленная граница", () => {
    expect(bareFunctionPasses).toBe(true);
  });

  /**
   * `__namespace` — только носитель параметра типа, во время исполнения его нет.
   * Если бы поле появилось, впрыснутый переводчик пришлось бы конструировать, а
   * не просто передавать функцию, — и `GameShell` сломался бы молча.
   */
  it("поля __namespace во время исполнения не существует", () => {
    const translator: Translator<"adapter"> = (key) => key;
    expect(translator.__namespace).toBeUndefined();
    expect(Object.hasOwn(translator, "__namespace")).toBe(false);
  });
});
