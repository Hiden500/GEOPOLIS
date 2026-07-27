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

import { identityPair } from "./elementIdentity";

const ARRAY_WILDCARD = "[*]";

/**
 * Маркер «из массива по этому пути пропали элементы».
 *
 * Удаление — это отдельное ЗАЯВЛЕНИЕ глагола, а не россыпь изменившихся полей:
 * глагол, удаляющий элементы, обязан объявить маркер в палитре явно, и тогда
 * причина отказа называет удаление удалением.
 *
 * С Милстоуна 1 (сессия жизненного цикла) маркер ЗАМЕНЯЕТ поля удалённого
 * элемента, а не добавляется к ним. Раньше добавлялся: массивы сравнивались
 * позиционно, поэтому удаление из середины сдвигало хвост, и диф метил
 * изменёнными все листья после него — включая нетронутые. Отказ палитры
 * перечислял десяток путей, из которых не следовало ничего, а на массивах
 * тегов внутри сдвинутого хвоста маркер выставлялся ложно (`docs/TODO.md`).
 * Теперь элементы сопоставляются по стабильному ключу (`elementIdentity.ts`):
 * пропавший элемент опознан как пропавший, и внутрь него диф не заходит вовсе.
 *
 * Массивы без идентичности элементов (`string[]`, `number[]`) по-прежнему
 * сравниваются позиционно и по-прежнему дают маркер при укорачивании — для них
 * это верно: у значения без ключа «тот же элемент» не определено.
 */
const ARRAY_SHRINK_MARKER = "[-]";

/**
 * Маркер «в массив по этому пути добавлены элементы» — симметричный `[-]`.
 *
 * Введён Милстоуном 1 (сессия жизненного цикла) вместе с сопоставлением по
 * идентичности, и вводит НОВЫЙ, более узкий смысл палитры: она защищает
 * СУЩЕСТВУЮЩЕЕ состояние от побочных эффектов, а не описывает форму объектов,
 * которые глагол вправе создать.
 *
 * Почему граница проведена здесь. Раньше созданный элемент раскладывался на
 * листья, и палитра перечисляла поля НОВОГО объекта наравне с полями старых.
 * Для одного объекта карты это было почти незаметно. Для страны — а `split_country`
 * создаёт именно страны — это означало бы перечислить в палитре каждое поле
 * `Country` вместе с каждым полем экономики, армии, политики и запасов: список
 * на полсотни строк, где пропуск любой записи даёт рантайм-отказ, а сам список
 * не сообщает ничего, кроме «страна имеет поля страны». Whitelist, который
 * дублирует определение типа, не является границей — он является его копией,
 * расходящейся при первой правке типа.
 *
 * Что при этом НЕ теряется. Изменение поля СУЩЕСТВУЮЩЕГО элемента по-прежнему
 * попадает в диф пофайлово-точно, поэтому глагол не может тронуть чужую страну
 * под видом создания своей. Правдивость содержимого созданного объекта держит
 * не палитра, а сверка результата с состоянием (`reconciliation.ts`) и
 * пост-инварианты (`invariants.ts`) — то есть механизмы, которые о СМЫСЛЕ полей
 * что-то знают.
 */
const ARRAY_GROW_MARKER = "[+]";

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
    const itemPath = `${path}${ARRAY_WILDCARD}`;

    // Элементы со стабильным ключом сопоставляются ПО КЛЮЧУ: перестановка
    // ничего не меняет, удаление опознано как удаление, а не как сдвиг хвоста.
    const identities = identityPair(beforeArr, afterArr);
    if (identities) {
      for (const [key, item] of identities.before) {
        if (identities.after.has(key)) {
          walk(item, identities.after.get(key), itemPath, out, fate);
          continue;
        }
        // Элемент ПРОПАЛ. Внутрь не заходим: его поля не «изменились», его
        // самого больше нет, и единственное честное заявление — маркер.
        out.add(`${path}${ARRAY_SHRINK_MARKER}`);
      }
      for (const key of identities.after.keys()) {
        if (identities.before.has(key)) continue;
        // Элемент ПОЯВИЛСЯ. Внутрь не заходим по той же причине, по которой не
        // заходим в исчезнувший: его поля не «изменились» — его самого раньше
        // не было (см. `ARRAY_GROW_MARKER`).
        out.add(`${path}${ARRAY_GROW_MARKER}`);
      }
      return;
    }

    // Массив без идентичности элементов — позиционно (см. `elementIdentity.ts`:
    // у значений `string[]`/`number[]` идентичности нет по существу).
    if (beforeArr.length > afterArr.length) out.add(`${path}${ARRAY_SHRINK_MARKER}`);
    const length = Math.max(beforeArr.length, afterArr.length);
    for (let i = 0; i < length; i++) {
      walk(
        beforeArr[i], afterArr[i], itemPath, out,
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
