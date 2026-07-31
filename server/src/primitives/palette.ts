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
  // Легитимность — вторая цена, и платит её сам режим: до 2026-07-31 акт силы
  // не стоил стране НИЧЕГО, и «давить всегда» доминировало над остальным
  // политическим алфавитом просто потому, что было бесплатным.
  repress: [
    "groupImpactMemory[+]",
    "groupImpactMemory[*].suppression",
    "groupImpactMemory[*].alienation",
    "countries[*].politics.legitimacy",
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
    // Юридическая половина зависимости переезжает вместе с рантаймовой:
    // `countryRefs.ts` переносит `overlordIds` наравне со списками дипломатии, а
    // `removeCountry` достраивает пару, которую перенос мог оставить
    // односторонней (`subordination.ts`). Без этих записей раскол государства,
    // НЕ пережившего распад и состоявшего в отношениях подчинения, откатывался
    // собственной палитрой — на данных 1946 достижимо (СССР держит двух
    // клиентов, Британия — 42 территории). Дефект найден и закрыт Милстоуном 1,
    // сессия структурных глаголов.
    "countries[*].politics.overlordIds[*]",
    "countries[*].politics.overlordIds[+]",
    "countries[*].politics.overlordIds[-]",
    "countries[*].politics.sovereigntyStatus",
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

  // Рождение государства идёт тем же ядром отделения, что и раскол
  // (`polityLifecycle.ts::secedeGroups`), поэтому и палитра у него та же: список
  // отличался бы от списка раскола только тем, чего автор не вспомнил.
  create_country: [
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
    // Юридическая половина зависимости переезжает вместе с рантаймовой:
    // `countryRefs.ts` переносит `overlordIds` наравне со списками дипломатии, а
    // `removeCountry` достраивает пару, которую перенос мог оставить
    // односторонней (`subordination.ts`). Без этих записей раскол государства,
    // НЕ пережившего распад и состоявшего в отношениях подчинения, откатывался
    // собственной палитрой — на данных 1946 достижимо (СССР держит двух
    // клиентов, Британия — 42 территории). Дефект найден и закрыт Милстоуном 1,
    // сессия структурных глаголов.
    "countries[*].politics.overlordIds[*]",
    "countries[*].politics.overlordIds[+]",
    "countries[*].politics.overlordIds[-]",
    "countries[*].politics.sovereigntyStatus",
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

  // Дипломатический жест: ТОЛЬКО двусторонние отношения, обе стороны пары.
  // Ни влияния, ни санкций, ни списков — «поговорили» не должно уметь молча
  // создать формальное обязательство.
  diplomacy: [
    "countries[*].diplomacy.relations.{*}",
  ],

  // Санкция: запись в словарь санкций + удар по отношениям. Экономику цели она
  // НЕ трогает напрямую — эффект приходит следующим тиком через
  // `TradeTick.getEmbargoPenalty`, и это существенно: примитив объявляет режим,
  // а считает по нему симуляция.
  sanction: [
    "countries[*].diplomacy.relations.{*}",
    "countries[*].diplomacy.sanctions.{*}[*]",
  ],

  // Объявление войны: новая война в списке + обвал отношений пары. Войну
  // создаёт `WarService`, он же втягивает коалицию — новый элемент массива
  // объявлен маркером, а не перечислением полей `War` (см. `ARRAY_GROW_MARKER`).
  war: [
    "wars[+]",
    "countries[*].diplomacy.relations.{*}",
  ],

  // Мир — самый широкий след дипломатического блока, и палитра здесь работает
  // как ГРАНИЦА, а не как короткий список: перечислено ровно то, что делает
  // мирный договор (`WarService.makePeace`), и ничего сверх.
  peace: [
    // Сама война погашена.
    "wars[*].active",
    // Потепление между сторонами.
    "countries[*].diplomacy.relations.{*}",
    // Цена исхода: штраф проигравшему и репарации победителю.
    "countries[*].politics.legitimacy",
    "countries[*].politics.governmentSupport",
    "countries[*].economy.treasury",
    // Условия договора: аннексия оккупированного и снятие остальной оккупации.
    "regions[*].ownerCountryId",
    "regions[*].occupiedBy",
    // Смена оккупации ведёт модификатор стабильности региона
    // (`simulation/war/occupation.ts` — единственная точка, держащая их
    // согласованными).
    "modifiers[+]",
    "modifiers[-]",
    // Столица, ушедшая по договору, переезжает: инвариант состояния требует
    // столицу среди своих регионов, и без переноса мир откатывал бы весь ответ.
    "countries[*].capitalRegionId",
    // Батальоны закрытой войны снимаются с карты.
    "mapFeatures[-]",
  ],

  // Помощь: деньги из казны в казну плюс влияние донора на получателя.
  // Отношений в палитре НЕТ намеренно — потепление приходит следующим тиком
  // через порог сферы влияния (`DiplomacyTick`) и член зависимости
  // структурного тяготения (`simulation/diplomacy/affinity.ts`), а не вторым
  // прямым сдвигом. Сфера влияния и союзы сюда тоже не входят: их пересчёт —
  // работа тика, и разрешить примитиву писать туда значило бы дать ему
  // создавать формальные обязательства молча.
  send_aid: [
    "countries[*].economy.treasury",
    "countries[*].diplomacy.influence.{*}",
  ],

  // Отток капитала: производство региона и казна его фактического контролёра.
  // Население, демография и владение регионом не трогаются — бежит капитал, а
  // не люди и не флаг.
  capital_flight: [
    "regions[*].gdp",
    "countries[*].economy.treasury",
  ],

  // Осуждение: РОВНО легитимность цели. Ни отношений, ни казны, ни санкций —
  // «репутационный удар без материального» (docs/PRIMITIVES.md §2) и есть
  // список из одной строки.
  condemn: [
    "countries[*].politics.legitimacy",
  ],

  // Поддержка клиента: патрон платит казной, клиент получает живую силу.
  // Войну примитив НЕ трогает вовсе — в этом весь смысл прокси: патрон не
  // становится стороной, поэтому ни `wars[*].attackers`, ни `supporters` в
  // палитре нет.
  support_proxy: [
    "countries[*].economy.treasury",
    "countries[*].military.activePersonnel",
  ],

  // Подчинение: РОВНО две половины одной зависимости и ничего сверх. Ни земли,
  // ни казны, ни армии — вассал сохраняет территорию и государственность,
  // теряет самостоятельность внешнего курса. Отношений тут тоже нет: подчинение
  // не жест доброй воли и не ссора, а смена положения; последствия для пары
  // приходят следующим тиком через `DiplomacyTick.dependencyStrength`.
  puppet: [
    // Элементы объявлены `[*]`, а не маркером роста: у `string[]` стабильной
    // идентичности нет (`elementIdentity.ts`), поэтому диф сравнивает такие
    // массивы позиционно, и появление первого элемента читается как изменение
    // позиции 0, а не как рост массива. Маркер `[+]` нужен там, где элемент —
    // объект с ключом; здесь он не сработал бы ни разу.
    "countries[*].diplomacy.puppets[*]",
    "countries[*].diplomacy.puppets[+]",
    "countries[*].politics.overlordIds[*]",
    "countries[*].politics.overlordIds[+]",
    // Появление самого поля у страны, у которой списка сюзеренов не было вовсе.
    "countries[*].politics.overlordIds",
    "countries[*].politics.sovereigntyStatus",
  ],

  // Поглощение: земля переходит во владение, оккупация с неё снимается вместе
  // со своим модификатором стабильности, агрегаты обеих стран пересчитываются
  // из регионов. Страна-жертва в списке НЕ исчезает — `countries[-]` здесь нет
  // намеренно: государство без территории законно (§7.1), а конец партии
  // вычисляет машина состояний кампании.
  annex: [
    "regions[*].ownerCountryId",
    "regions[*].occupiedBy",
    // Смена оккупации ведёт модификатор стабильности региона
    // (`simulation/war/occupation.ts` — единственная точка, держащая их
    // согласованными).
    "modifiers[+]",
    "modifiers[-]",
    // Столица, ушедшая победителю, переезжает: инвариант состояния требует её
    // среди своих регионов, и без переноса аннексия откатывала бы весь ответ.
    "countries[*].capitalRegionId",
    // Население и ВВП выводятся из регионов и потому обязаны быть пересчитаны:
    // держава, забравшая землю, не должна остаться с числами за чужую.
    "countries[*].population",
    "countries[*].economy.gdp",
    // Война, потерявшая сторону целиком, закрывается тем же актом.
    "wars[*].active",
    // Партия: конец кампании вычисляет движок здесь же, а не следующим тиком.
    "campaign.status",
    "campaign.reason.code",
    "campaign.reason.by.en",
    "campaign.reason.by.ru",
    "campaign.since",
  ],

  // Объединение государств — ОБРАТНАЯ операция к расколу, и палитра у неё того
  // же вида и по той же причине: перечислено ровно то, что жизненный цикл
  // обязан тронуть. Отличие одно и содержательное — здесь нет `countries[+]`:
  // объединение страны не создаёт, оно их убавляет.
  merge_countries: [
    "countries[-]",
    // Поглотитель: делимое имущество сложено, агрегаты пересчитаны из регионов.
    "countries[*].capitalRegionId",
    "countries[*].population",
    "countries[*].economy.gdp",
    "countries[*].economy.treasury",
    "countries[*].military.manpower",
    "countries[*].military.activePersonnel",
    "countries[*].military.reservePersonnel",
    // Перенос ссылок затрагивает дипломатию ВСЕХ ссылающихся стран.
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
    // Юридическая половина зависимости переезжает вместе с рантаймовой.
    "countries[*].politics.overlordIds[*]",
    "countries[*].politics.overlordIds[+]",
    "countries[*].politics.overlordIds[-]",
    "countries[*].politics.sovereigntyStatus",
    // Земля переходит поглотителю; оккупация с неё снимается вместе с
    // модификатором стабильности.
    "regions[*].ownerCountryId",
    "regions[*].occupiedBy",
    "modifiers[+]",
    "modifiers[-]",
    "modifiers[*].target.id",
    // Война, схлопнувшаяся в войну страны с самой собой, закрыта.
    "wars[*].active",
    "wars[*].attackers[*]",
    "wars[*].attackers[-]",
    "wars[*].defenders[*]",
    "wars[*].defenders[-]",
    "wars[*].supporters[+]",
    "wars[*].supporters[-]",
    "wars[*].supporters[*].countryId",
    "wars[*].casualties.{*}",
    "mapFeatures[*].ownerId",
    // `playerCountryId` здесь НЕТ намеренно: поглощение страны игрока
    // отклоняется предпосылкой, и если ссылка всё-таки переедет, палитра
    // обязана это поймать, а не разрешить.
    "llmSpotlightCountryId",
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
 * Шаблон был введён Милстоуном 1 заранее, до появления первого потребителя.
 * Потребители появились в той же вехе: `diplomacy`, `sanction`, `war` и `peace`
 * пишут в `relations` и `sanctions` по ключу-стране, и без шаблона каждый из
 * них гарантированно проваливал бы рантайм-проверку палитры — перечислить все
 * возможные id стран статическим списком нельзя.
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
