/**
 * Диф изменённых путей состояния — техническая основа палитры эффектов
 * (docs/PRIMITIVES.md §3, защита №3: «verb меняет только свой whitelist полей,
 * даже если LLM „хочет“ побочку»).
 *
 * Палитра проверяется не только тестом, но и в рантайме: движок применяет
 * примитив на клоне, сравнивает состояние до/после и, если изменился путь вне
 * whitelist'а, откатывает примитив целиком. Так палитра становится настоящей
 * границей, а не комментарием.
 *
 * Пути нормализованы по индексам массивов: `groupImpactMemory[0].suppression` и
 * `groupImpactMemory[7].suppression` — один путь `groupImpactMemory[*].suppression`.
 * Индекс элемента ничего не значит для палитры: важно, КАКОЕ поле тронуто.
 */

const ARRAY_WILDCARD = "[*]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Сравнение листьев. `undefined` со стороны «до» приравнивается к 0 для чисел:
 * создание записи памяти воздействий заводит все четыре поля нулями, и без
 * этого правила любой примитив «менял» бы все четыре, а палитра перестала бы
 * что-либо различать. Поле, реально сдвинутое с нуля, при этом отличается.
 */
function leavesEqual(before: unknown, after: unknown): boolean {
  const b = before === undefined && typeof after === "number" ? 0 : before;
  const a = after === undefined && typeof before === "number" ? 0 : after;
  return Object.is(b, a);
}

function walk(before: unknown, after: unknown, path: string, out: Set<string>): void {
  if (Array.isArray(before) || Array.isArray(after)) {
    const beforeArr = Array.isArray(before) ? before : [];
    const afterArr = Array.isArray(after) ? after : [];
    const length = Math.max(beforeArr.length, afterArr.length);
    for (let i = 0; i < length; i++) {
      walk(beforeArr[i], afterArr[i], `${path}${ARRAY_WILDCARD}`, out);
    }
    return;
  }

  if (isPlainObject(before) || isPlainObject(after)) {
    const beforeObj = isPlainObject(before) ? before : {};
    const afterObj = isPlainObject(after) ? after : {};
    for (const key of new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])) {
      walk(beforeObj[key], afterObj[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }

  if (!leavesEqual(before, after)) out.add(path);
}

/**
 * Все пути состояния, значение которых отличается. Порядок — отсортированный,
 * чтобы диагностика была детерминированной.
 */
export function collectChangedPaths(before: unknown, after: unknown): string[] {
  const out = new Set<string>();
  walk(before, after, "", out);
  return [...out].sort();
}
