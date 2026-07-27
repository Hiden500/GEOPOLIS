import { type PrimitiveVerb } from "./types";

/**
 * Палитра эффектов — декларативный whitelist путей состояния, которые вправе
 * менять каждый verb (docs/PRIMITIVES.md §1 «Что держит движок» и §3 защита №3).
 *
 * Пути — в нормализованной форме `server/src/primitives/statePaths.ts`
 * (индексы массивов схлопнуты в `[*]`). Всё, что примитив изменил вне своей
 * палитры, откатывается вместе с самим примитивом — LLM не может дописать
 * побочный эффект, даже если очень хочет.
 *
 * Записи `groupImpactMemory[*].regionId` / `.groupId` есть у каждого verb,
 * работающего с памятью воздействий: первое касание пары (регион, группа)
 * создаёт запись, и её идентификаторы — законная часть эффекта. Нулевые поля
 * новой записи в диф не попадают (см. leavesEqual в statePaths.ts), поэтому
 * палитра остаётся точной: verb, объявивший только `emboldenment`, не сможет
 * незаметно тронуть `alienation`.
 */
export const PRIMITIVE_PALETTE: Record<PrimitiveVerb, readonly string[]> = {
  // Подстрекательство: чужая рука делает группу смелее. Ни репрессий, ни
  // уступок, ни координат — только смелость.
  incite_unrest: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].emboldenment",
  ],

  // Репрессии: недовольство вниз сейчас (suppression), отчуждение вверх
  // надолго (alienation) — цена, из-за которой «загнал вглубь» работает.
  repress: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].suppression",
    "groupImpactMemory[*].alienation",
  ],

  // Уступка: недовольство вниз у адресата (concession), но та же группа в
  // соседних регионах осмелела (emboldenment) — цена уступки.
  grant_autonomy: [
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].concession",
    "groupImpactMemory[*].emboldenment",
  ],

  // Реформа: медленный сдвиг координат власти + политическая цена. Память
  // воздействий не трогает вовсе — эффект приходит через геометрию дистанции.
  enact_reform: [
    "countries[*].politics.ideologyCoordinates.economic",
    "countries[*].politics.ideologyCoordinates.political",
    "countries[*].politics.governmentSupport",
  ],

  // Инцидент: объект на карте + небольшой толчок смелости. Экономику,
  // население и владение регионом не трогает.
  spawn_incident: [
    "mapFeatures[*].id",
    "mapFeatures[*].type",
    "mapFeatures[*].tags[*]",
    "mapFeatures[*].createdAt",
    "mapFeatures[*].regionId",
    "mapFeatures[*].ownerId",
    "mapFeatures[*].name",
    "nextFeatureId",
    "groupImpactMemory[*].regionId",
    "groupImpactMemory[*].groupId",
    "groupImpactMemory[*].emboldenment",
  ],
};

/**
 * Совпадает ли изменённый путь с записью палитры.
 *
 * Запись палитры — ШАБЛОН, а не строка: сегмент `{*}` означает «любой ключ
 * словаря». Нужен потому, что `collectChangedPaths` оставляет ключи записей в
 * пути дословно (`countries[*].diplomacy.relations.USA`), а `relations`,
 * `influence` и `sanctions` — это `Record<string, …>`, ключи которых суть
 * данные партии, а не имена полей. Без шаблона любой глагол, пишущий туда,
 * гарантированно проваливал бы рантайм-проверку палитры: перечислить все
 * возможные id стран в статическом списке нельзя.
 *
 * Сегодня ни один из пяти глаголов в словари не пишет — но переиспользуемые
 * `diplomacy`, `sanction`, `war`, `peace`, которые следующая сессия переводит в
 * алфавит, пишут туда все. Шаблон вводится сейчас, чтобы первый же такой глагол
 * не упёрся в механизм, а не потому, что он нужен пяти сегодняшним.
 *
 * Схлопывать ключи в самом дифе было нельзя: словарь от объекта с
 * фиксированными полями там не отличить, и `politics.governmentSupport`
 * превратился бы в `politics.{*}` — палитра перестала бы что-либо запрещать.
 * Здесь же объявление делает ГЛАГОЛ, и оно читается как намерение: «пишу в
 * relations по любому ключу».
 */
export function pathMatchesPaletteEntry(entry: string, path: string): boolean {
  if (!entry.includes(KEY_WILDCARD)) return entry === path;

  // Экранируем всё, кроме плейсхолдера, и заменяем его на «сегмент без точки»:
  // `{*}` покрывает ровно один ключ, а не путь произвольной глубины.
  const pattern = entry
    .split(KEY_WILDCARD)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");
  return new RegExp(`^${pattern}$`).test(path);
}

/** Плейсхолдер ключа словаря в записи палитры. */
const KEY_WILDCARD = "{*}";

/** Пути, изменённые примитивом, но не объявленные в его палитре. */
export function findPaletteViolations(verb: PrimitiveVerb, changedPaths: readonly string[]): string[] {
  const allowed = PRIMITIVE_PALETTE[verb];
  return changedPaths.filter(path => !allowed.some(entry => pathMatchesPaletteEntry(entry, path)));
}
