/**
 * Идентичность элемента массива состояния — ОДНО определение на две задачи
 * (`docs/TODO.md`, «позиционный откат `restore()` → reconciliation по id»).
 *
 * ЧТО БЫЛО. И перенос состояния (`restore` в `PrimitiveEngine.ts`), и диф путей
 * (`collectChangedPaths` в `statePaths.ts`) сопоставляли элементы массивов ПО
 * ПОЗИЦИИ: элемент с индексом i считался тем же объектом, что элемент с
 * индексом i. Пока ни один глагол не переставлял и не удалял регионы и страны,
 * это было верно. Жизненный цикл государств (`CONCEPT.md` §7.1) ломает
 * предположение по построению: раскол вставляет страну в середину ростера,
 * роспуск удаляет её оттуда, и после этого «элемент i» — другой объект.
 *
 * Последствия были разными у двух потребителей и оба тихие. Перенос сохранял
 * идентичность объектов позиционно, то есть ссылка, взятая до commit'а
 * (`const country = game.countries.find(...)`), после переноса указывала бы на
 * СОСЕДНЮЮ страну. Диф метил изменёнными все поля хвоста, поэтому палитра
 * отказывала с причиной, из которой ничего не следует.
 *
 * ЧЕМ ЗАМЕНЕНО. Элементы сопоставляются по стабильному ключу. Ключ выводится из
 * САМОГО элемента, а не из реестра «путь → поле ключа»: реестр — это второй
 * список, который забудут пополнить, и первый же новый массив состояния тихо
 * вернулся бы к позиционному сравнению. Правило вместо списка:
 *
 *   1. поле `id` (строка или число) — этим покрыты `countries`, `regions`,
 *      `wars`, `modifiers`, `mapFeatures`, `eventHistory` и любой будущий
 *      массив, следующий той же конвенции, без единой правки здесь;
 *   2. узкий перечень СОСТАВНЫХ ключей для сущностей, у которых поля `id` нет
 *      по дизайну (память воздействий ключуется парой «регион + группа»,
 *      летопись — годом, поддержка войны — парой «страна + сторона»);
 *   3. всё остальное — без идентичности: у элементов `string[]` и `number[]`
 *      её действительно нет, и позиционное сравнение для них ВЕРНО, а не
 *      является уступкой.
 *
 * ЕДИНСТВЕННОСТЬ КЛЮЧА ПРОВЕРЯЕТСЯ, а не предполагается: массив, в котором два
 * элемента дали одинаковый ключ, сопоставляется позиционно. Иначе испорченные
 * данные (два региона с одним id) молча теряли бы элемент при переносе — то
 * есть починка одной тихой поломки завела бы другую.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarKey(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Составные ключи сущностей без поля `id`. Список узкий и закрытый намеренно:
 * это исключения из правила «идентичность лежит в `id`», а не общий механизм.
 */
const COMPOSITE_KEY_FIELDS: readonly (readonly string[])[] = [
  // GroupImpactMemory — разреженная память по паре (регион, группа).
  ["regionId", "groupId"],
  // War.supporters — одна страна вправе поддерживать разные стороны разных войн.
  ["countryId", "side"],
  // GameState.chronicle — одна запись на год.
  ["year"],
];

/**
 * Стабильный ключ элемента либо `undefined`, если идентичности у элемента нет.
 *
 * Ключ включает ИМЕНА полей, из которых собран, чтобы элементы, случайно
 * совпавшие значениями разных ключей, не считались одним и тем же.
 */
export function elementIdentity(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;

  const ownId = scalarKey(value["id"]);
  if (ownId !== undefined) return `id=${ownId}`;

  for (const fields of COMPOSITE_KEY_FIELDS) {
    if (!fields.every(field => field in value)) continue;
    const parts: string[] = [];
    let complete = true;
    for (const field of fields) {
      const key = scalarKey(value[field]);
      if (key === undefined) {
        complete = false;
        break;
      }
      parts.push(`${field}=${key}`);
    }
    if (complete) return parts.join("&");
  }

  return undefined;
}

/**
 * Индекс «ключ → элемент» для массива, ВСЕ элементы которого имеют уникальную
 * идентичность. `undefined` означает «сопоставлять позиционно» — и для массива
 * скаляров это правильный ответ, а не отказ.
 */
export function identityIndex(items: readonly unknown[]): Map<string, unknown> | undefined {
  const index = new Map<string, unknown>();
  for (const item of items) {
    const key = elementIdentity(item);
    if (key === undefined) return undefined;
    if (index.has(key)) return undefined;
    index.set(key, item);
  }
  return index;
}

/**
 * Можно ли сопоставлять эти два массива по идентичности.
 *
 * Требуется от ОБОИХ: массив, у которого идентичность появилась только с одной
 * стороны, сравнивать по ключу нечем. Пустой массив идентичность имеет
 * тривиально (пустой индекс), поэтому «было пусто — стало три записи» проходит
 * по ключам, а не позиционно.
 */
export function identityPair(
  before: readonly unknown[],
  after: readonly unknown[]
): { before: Map<string, unknown>; after: Map<string, unknown> } | undefined {
  const beforeIndex = identityIndex(before);
  if (!beforeIndex) return undefined;
  const afterIndex = identityIndex(after);
  if (!afterIndex) return undefined;
  return { before: beforeIndex, after: afterIndex };
}
