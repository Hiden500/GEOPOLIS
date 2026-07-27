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
 * Запись `groupImpactMemory[+]` есть у каждого verb, работающего с памятью
 * воздействий: первое касание пары (регион, группа) СОЗДАЁТ запись, и создание
 * элемента массива объявляется маркером, а не перечислением полей нового
 * объекта (`statePaths.ts`, `ARRAY_GROW_MARKER`). Изменение полей УЖЕ
 * существующей записи по-прежнему перечисляется поимённо, поэтому палитра
 * остаётся точной: verb, объявивший только `emboldenment`, не сможет незаметно
 * тронуть `alienation` у живой записи.
 */
export const PRIMITIVE_PALETTE: Record<PrimitiveVerb, readonly string[]> = {
  // Подстрекательство: чужая рука делает группу смелее. Ни репрессий, ни
  // уступок, ни координат — только смелость.
  incite_unrest: [
    "groupImpactMemory[+]",
    "groupImpactMemory[*].emboldenment",
  ],

  // Репрессии: недовольство вниз сейчас (suppression), отчуждение вверх
  // надолго (alienation) — цена, из-за которой «загнал вглубь» работает.
  repress: [
    "groupImpactMemory[+]",
    "groupImpactMemory[*].suppression",
    "groupImpactMemory[*].alienation",
  ],

  // Уступка: недовольство вниз у адресата (concession), но та же группа в
  // соседних регионах осмелела (emboldenment) — цена уступки.
  grant_autonomy: [
    "groupImpactMemory[+]",
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
    "mapFeatures[+]",
    "nextFeatureId",
    "groupImpactMemory[+]",
    "groupImpactMemory[*].emboldenment",
  ],

  // Раскол государства (docs/CONCEPT.md §5.5, §7.1) — самый широкий след в
  // алфавите, и палитра здесь работает не как «короткий список полей», а как
  // ГРАНИЦА: перечислено ровно то, что жизненный цикл обязан тронуть, и ничего
  // сверх. В частности, отсутствуют население и ВВП РЕГИОНОВ, их экономика,
  // демографический состав и память воздействий: раскол меняет, кому регион
  // принадлежит, а не что в нём происходит.
  split_country: [
    // Появление осколков и исчезновение распустившейся метрополии.
    "countries[+]",
    "countries[-]",
    // Метрополия: столица могла уйти с осколком, агрегаты и делимое пересчитаны.
    "countries[*].capitalRegionId",
    "countries[*].population",
    "countries[*].economy.gdp",
    "countries[*].economy.treasury",
    "countries[*].military.manpower",
    "countries[*].military.activePersonnel",
    "countries[*].military.reservePersonnel",
    // Перенос ссылок затрагивает дипломатию ВСЕХ ссылающихся стран, а не только
    // сторон раскола, — это и есть контракт §7.1.
    "countries[*].currencyZoneAnchor",
    "countries[*].diplomacy.allies[*]",
    "countries[*].diplomacy.allies[-]",
    "countries[*].diplomacy.rivals[*]",
    "countries[*].diplomacy.rivals[-]",
    "countries[*].diplomacy.puppets[*]",
    "countries[*].diplomacy.puppets[-]",
    "countries[*].diplomacy.sphereOfInfluence[*]",
    "countries[*].diplomacy.sphereOfInfluence[-]",
    "countries[*].diplomacy.guarantees[*]",
    "countries[*].diplomacy.guarantees[-]",
    "countries[*].diplomacy.relations.{*}",
    "countries[*].diplomacy.influence.{*}",
    "countries[*].diplomacy.sanctions.{*}[*]",
    "countries[*].diplomacy.sanctions.{*}[-]",
    // Регионы меняют владельца; оккупация снимается, если оккупант стал
    // владельцем (иначе страна «оккупировала» бы саму себя).
    "regions[*].ownerCountryId",
    "regions[*].occupiedBy",
    // Войны: стороны переехали, потерявшая смысл война закрыта.
    "wars[*].active",
    "wars[*].attackers[*]",
    "wars[*].attackers[-]",
    "wars[*].defenders[*]",
    "wars[*].defenders[-]",
    "wars[*].supporters[+]",
    "wars[*].supporters[-]",
    "wars[*].supporters[*].countryId",
    "wars[*].casualties.{*}",
    // Модификаторы на исчезнувшую страну снимаются, на переехавшую — переносятся.
    "modifiers[-]",
    "modifiers[*].target.id",
    // Объект карты переживает исчезновение владельца, сменив хозяина.
    "mapFeatures[*].ownerId",
    // Партия: за кого играет человек и в каком состоянии кампания.
    "playerCountryId",
    "llmSpotlightCountryId",
    "campaign.status",
    "campaign.predecessor.en",
    "campaign.predecessor.ru",
    "campaign.successorCountryIds[*]",
    "campaign.since",
    // Одноразовая диагностика и счётчики хода, ключуемые страной.
    "pendingWorldFacts[-]",
    "pendingWorldFacts[*].countryId",
    "primitiveTurnBudget.targetUses.{*}",
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

  // Экранируем всё, кроме плейсхолдера, и заменяем его на «сегмент без точки
  // И без скобки»: `{*}` покрывает ровно один ключ словаря.
  //
  // Скобка исключена намеренно (Милстоун 1, сессия жизненного цикла). Прежний
  // `[^.]+` жадно поглощал суффиксы маркеров, которые диф приписывает к пути БЕЗ
  // разделяющей точки: запись `relations.{*}` молча покрывала и
  // `relations.USA[-]`, то есть глагол, объявивший право писать в словарь,
  // получал заодно право удалять из него элементы — ровно то разрешение,
  // которое маркер и заведён требовать отдельно (`docs/TODO.md`).
  const pattern = entry
    .split(KEY_WILDCARD)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.[]+");
  return new RegExp(`^${pattern}$`).test(path);
}

/** Плейсхолдер ключа словаря в записи палитры. */
const KEY_WILDCARD = "{*}";

/** Пути, изменённые примитивом, но не объявленные в его палитре. */
export function findPaletteViolations(verb: PrimitiveVerb, changedPaths: readonly string[]): string[] {
  const allowed = PRIMITIVE_PALETTE[verb];
  return changedPaths.filter(path => !allowed.some(entry => pathMatchesPaletteEntry(entry, path)));
}
