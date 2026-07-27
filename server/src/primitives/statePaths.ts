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
 *
 * КЛЮЧИ СЛОВАРЕЙ остаются в пути ДОСЛОВНО (`…diplomacy.relations.USA`), и это
 * намеренно: словарь от объекта с фиксированными полями здесь не отличить —
 * оба plain-object, — а схлопывать ключи вслепую значило бы превратить
 * `politics.governmentSupport` в `politics.{*}` и снять палитру целиком.
 * Выражает ключи сама палитра, шаблоном `{*}` (см. `palette.ts`): «этому
 * глаголу разрешено писать в `relations` по ЛЮБОМУ ключу». Обязанность
 * объявить это лежит на глаголе, а не на дифе.
 *
 * УДАЛЕНИЕ ЭЛЕМЕНТА МАССИВА диф отмечает отдельно (`[-]`), потому что
 * позиционное сравнение после него теряет смысл — см. `ARRAY_SHRINK_MARKER`.
 */

const ARRAY_WILDCARD = "[*]";

/**
 * Маркер «из массива по этому пути пропали элементы».
 *
 * Зачем отдельный путь, а не молчание. `walk` сравнивает массивы ПОЗИЦИОННО,
 * поэтому удаление элемента из середины сдвигает все последующие, и диф метит
 * изменёнными все листья хвоста — включая те, что не менялись. Палитра тогда
 * срабатывает не на настоящем нарушении, а на сдвиге, и глагол откатывается с
 * причиной, из которой ничего не следует.
 *
 * Полное лечение — сопоставлять элементы по стабильным id, а не по позиции; это
 * та же работа, что «позиционный откат `restore()` → reconciliation по id»
 * (`docs/TODO.md`), и она принадлежит сессии lifecycle. Здесь — честный
 * маркер: глагол, удаляющий элементы, обязан объявить это в палитре явно, и
 * тогда причина отказа называет удаление удалением, а не россыпью полей.
 *
 * Сегодня не срабатывает ни разу: из пяти глаголов ни один ничего не удаляет, а
 * `spawn_incident` массив только ДОПОЛНЯЕТ — добавление в конец позиций не
 * сдвигает, и позиционное сравнение остаётся верным. Первым его увидит `peace`,
 * снимающий батальоны и оккупационные модификаторы при завершении войны.
 */
const ARRAY_SHRINK_MARKER = "[-]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

/**
 * Судьба КОНТЕЙНЕРА (объекта или элемента массива), внутри которого лежит лист:
 * существовал по обе стороны, появился целиком или исчез целиком.
 *
 * Нужна ровно для одного различения — «поле появилось со значением 0» против
 * «поля не было, потому что не было и всей записи». Первое обязано попасть в
 * диф (иначе палитра слепа к незаявленному нулю), второе — не должно
 * (создание записи памяти воздействий заводит все четыре поля нулями, и без
 * поблажки любой примитив «менял» бы все четыре).
 */
type ContainerFate = "existing" | "created" | "removed";

function childFate(parent: ContainerFate, before: unknown, after: unknown): ContainerFate {
  // Внутри уже появившегося/исчезнувшего контейнера всё наследует его судьбу:
  // «до» там нет ни у одного листа, каким бы глубоким он ни был.
  if (parent !== "existing") return parent;
  if (before === undefined && isContainer(after)) return "created";
  if (after === undefined && isContainer(before)) return "removed";
  return "existing";
}

/**
 * Сравнение листьев — СТРОГОЕ (`Object.is`) везде, кроме структурных нулей
 * свежесозданной (или целиком удалённой) записи.
 *
 * До 2026-07-26 поблажка была безусловной: `undefined` и числовой ноль
 * считались равными всегда. Следствие — палитра не видела появления
 * незаявленного поля со значением 0 (`collectChangedPaths({}, { progress: 0 })`
 * возвращал пустой список) и не видела его исчезновения. Рантайм-граница,
 * которая пропускает целый класс записей, границей не является: сегодня
 * ни один из пяти обработчиков такого не пишет, но первый же сервисный
 * эффект вида `progress: 0` прошёл бы мимо whitelist'а молча.
 */
function leavesEqual(before: unknown, after: unknown, fate: ContainerFate): boolean {
  if (fate === "created" && before === undefined && after === 0) return true;
  if (fate === "removed" && after === undefined && before === 0) return true;
  return Object.is(before, after);
}

function walk(
  before: unknown,
  after: unknown,
  path: string,
  out: Set<string>,
  fate: ContainerFate
): void {
  if (Array.isArray(before) || Array.isArray(after)) {
    const beforeArr = Array.isArray(before) ? before : [];
    const afterArr = Array.isArray(after) ? after : [];
    // Массив УКОРОТИЛСЯ — позиционное сравнение ниже перестало быть надёжным.
    // Отмечаем это отдельным путём, чтобы отказ палитры назвал удаление, а не
    // хвост сдвинутых полей (см. `ARRAY_SHRINK_MARKER`).
    if (beforeArr.length > afterArr.length) out.add(`${path}${ARRAY_SHRINK_MARKER}`);
    const length = Math.max(beforeArr.length, afterArr.length);
    for (let i = 0; i < length; i++) {
      walk(
        beforeArr[i], afterArr[i], `${path}${ARRAY_WILDCARD}`, out,
        childFate(fate, beforeArr[i], afterArr[i])
      );
    }
    return;
  }

  if (isPlainObject(before) || isPlainObject(after)) {
    const beforeObj = isPlainObject(before) ? before : {};
    const afterObj = isPlainObject(after) ? after : {};
    for (const key of new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])) {
      walk(
        beforeObj[key], afterObj[key], path ? `${path}.${key}` : key, out,
        childFate(fate, beforeObj[key], afterObj[key])
      );
    }
    return;
  }

  if (!leavesEqual(before, after, fate)) out.add(path);
}

/**
 * Все пути состояния, значение которых отличается. Порядок — отсортированный,
 * чтобы диагностика была детерминированной.
 */
export function collectChangedPaths(before: unknown, after: unknown): string[] {
  const out = new Set<string>();
  walk(before, after, "", out, "existing");
  return [...out].sort();
}
