import { type GameState } from "@shared/types/GameState";
import { type SanctionType } from "@shared/types/DiplomacyState";

/**
 * ЕДИНСТВЕННОЕ объявление мест, где живое состояние ссылается на страну
 * (docs/CONCEPT.md §7.1 — «при создании/роспуске/расколе/объединении страны
 * явный перенос ВСЕХ ссылок»).
 *
 * ЗАЧЕМ ОДИН ОБХОД, А НЕ ДВА СПИСКА. Переносу ссылок и проверке «ноль висячих
 * ссылок» нужен один и тот же перечень мест. Написанные раздельно, они
 * расходятся на первом же новом поле, и проверка начинает ВЫГЛЯДЕТЬ покрытием,
 * не будучи им: она подтверждает целостность ровно тех мест, которые перенос и
 * так не забыл. Поэтому здесь объявлен один обход `remapCountryReferences`, а
 * перечисление (`collectCountryReferences`) реализовано ЧЕРЕЗ него — тем же
 * кодом, на клоне, с резолвером, который ничего не меняет. Разойтись им негде
 * по построению, а не по дисциплине.
 *
 * Тот же приём, что у `invariants.ts` (одно определение инвариантов на
 * транзакцию и на загрузку сейва): «места, где состояние ссылается на страну»
 * обязано означать одно и то же у всех потребителей.
 *
 * ЧТО СЮДА НЕ ВХОДИТ И ПОЧЕМУ — названо явно, потому что «забыл» и «решил не
 * включать» снаружи неотличимы:
 *
 *   - **История.** `eventHistory` (включая квитанции внутри), `chronicle`,
 *     `regions[*].placeHistory` — это ЗАПИСЬ О ПРОШЛОМ. Ссылка на страну,
 *     которой больше нет, здесь не висячая, а верная: событие 1949 года
 *     действительно касалось государства, распавшегося в 1991-м. Переписывать
 *     их значило бы подделывать историю ради формальной чистоты графа, и это
 *     прямо противоречит §5.6 («история места») и правилу летописи (§3
 *     `PRIMITIVES.md`). Проверка висячих ссылок обязана знать об этом
 *     исключении, иначе она валится на штатном исходе.
 *   - **Собственный `id` страны.** Это идентичность, а не ссылка. Ни одна
 *     операция этой сессии страну не переименовывает; переименование —
 *     отдельная работа со своими инвариантами.
 *   - **Свободный текст** (`llmContext`, `llmResponse`, `playerIntent`,
 *     заголовки событий): туда попадают ИМЕНА стран, а не идентификаторы.
 *
 * СОСТАВНЫЕ КЛЮЧИ. `primitiveTurnBudget.targetUses` ключуется строкой вида
 * `"enact_reform -> country SUN"`: идентификатор вшит ПОДСТРОКОЙ, отдельного
 * поля у него нет, и поиском по имени поля это место не находится вовсе.
 * Разбирается сегментами (`" / "`) — форма ключа задана `targetUseKey` в
 * `PrimitiveEngine.ts`, и обе стороны обязаны меняться вместе. Цена названа:
 * это единственное место реестра, где связь держится соглашением о формате
 * строки, а не типом.
 */

/** Одно место ссылки — для диагностики и для сторожевого теста полноты. */
export interface CountryRefSite {
  /**
   * Стабильный путь места в состоянии (индексы массивов схлопнуты в `[*]`,
   * ключи словарей — в `{*}`), той же формы, что пути палитры.
   */
  path: string;
  /**
   * Законно ли снять ссылку вовсе. У владения регионом и у `playerCountryId`
   * снятия не существует: регион без владельца и партия без страны игрока —
   * не состояния мира, а поломка. Резолвер, вернувший `undefined` в таком
   * месте, получает исключение, а не молчание.
   */
  removable: boolean;
}

/**
 * Как поступить со ссылкой: вернуть тот же id (не трогать), другой
 * (перенести) либо `undefined` (снять — только там, где `removable`).
 */
export type CountryRefResolver = (
  countryId: string,
  site: CountryRefSite
) => string | undefined;

function site(path: string, removable: boolean): CountryRefSite {
  return { path, removable };
}

/**
 * Применяет резолвер к одному скалярному месту.
 * Возвращает новое значение; `undefined` означает «снять».
 */
function resolveScalar(
  value: string,
  path: string,
  removable: boolean,
  resolve: CountryRefResolver
): string | undefined {
  const next = resolve(value, site(path, removable));
  if (next === undefined && !removable) {
    throw new Error(
      `Country reference at ${path} cannot be dropped: nothing in the world may hold ` +
        `a region or a campaign without a country (${value})`
    );
  }
  return next;
}

/**
 * Список идентификаторов на месте: перенос, снятие, дедупликация и запрет
 * ссылаться на себя.
 *
 * Самоссылка — не гипотетическая аккуратность, а прямое следствие переноса:
 * после «A → B» список союзников самой B содержал бы B. Дипломатия страны с
 * самой собой не имеет смысла ни в одной подсистеме, поэтому она снимается
 * здесь, а не оставляется на совести каждого вызывающего.
 */
function remapIdList(
  list: string[],
  path: string,
  resolve: CountryRefResolver,
  selfId?: string
): void {
  const next: string[] = [];
  for (const id of list) {
    const resolved = resolveScalar(id, path, true, resolve);
    if (resolved === undefined) continue;
    if (resolved === selfId) continue;
    if (!next.includes(resolved)) next.push(resolved);
  }
  list.length = 0;
  list.push(...next);
}

/**
 * Словарь, ключ которого — страна.
 *
 * `merge` решает столкновение: после переноса «A → B» у третьей страны могут
 * оказаться записи и про A, и про B. Правило столкновения — свойство КОНКРЕТНОГО
 * словаря, а не общее, поэтому передаётся вызывающим (см. места применения).
 */
function remapIdKeyedRecord<V>(
  record: Record<string, V>,
  path: string,
  resolve: CountryRefResolver,
  merge: (existing: V, incoming: V) => V,
  selfId?: string
): void {
  const entries = Object.entries(record);
  for (const [key] of entries) delete record[key];

  for (const [key, value] of entries) {
    const resolved = resolveScalar(key, path, true, resolve);
    if (resolved === undefined) continue;
    if (resolved === selfId) continue;
    const existing = record[resolved];
    record[resolved] = existing === undefined ? value : merge(existing, value);
  }
}

/** Сегмент составного ключа бюджета, называющий страну. */
const BUDGET_COUNTRY_SEGMENT = "country ";

/**
 * Переписывает страну внутри составного ключа бюджета хода.
 * `undefined` — весь счётчик снимается: счёт по цели, которой больше нет, не
 * должен продолжать запирать слот хода.
 */
function remapBudgetKey(
  key: string,
  path: string,
  resolve: CountryRefResolver
): string | undefined {
  const arrow = key.indexOf(" -> ");
  if (arrow < 0) return key;

  const verb = key.slice(0, arrow);
  const segments = key.slice(arrow + 4).split(" / ");
  const mapped: string[] = [];
  for (const segment of segments) {
    if (!segment.startsWith(BUDGET_COUNTRY_SEGMENT)) {
      mapped.push(segment);
      continue;
    }
    const resolved = resolveScalar(
      segment.slice(BUDGET_COUNTRY_SEGMENT.length),
      path,
      true,
      resolve
    );
    if (resolved === undefined) return undefined;
    mapped.push(`${BUDGET_COUNTRY_SEGMENT}${resolved}`);
  }
  return `${verb} -> ${mapped.join(" / ")}`;
}

/**
 * Единственный обход ссылок на страну. Мутирует `game` НА МЕСТЕ — вызывающий
 * решает, делать это на клоне или в боевом состоянии.
 *
 * Порядок обхода стабилен (поля состояния сверху вниз), поэтому перечисление
 * через этот же обход даёт детерминированный список путей.
 */
export function remapCountryReferences(game: GameState, resolve: CountryRefResolver): void {
  // --- верхний уровень ---
  const player = resolveScalar(game.playerCountryId, "playerCountryId", false, resolve);
  game.playerCountryId = player!;

  if (game.llmSpotlightCountryId !== undefined) {
    const next = resolveScalar(
      game.llmSpotlightCountryId,
      "llmSpotlightCountryId",
      true,
      resolve
    );
    if (next === undefined) delete game.llmSpotlightCountryId;
    else game.llmSpotlightCountryId = next;
  }

  if (game.campaign.status === "succession_choice_pending") {
    remapIdList(
      game.campaign.successorCountryIds,
      "campaign.successorCountryIds[*]",
      resolve
    );
  }

  // --- регионы ---
  for (const region of game.regions) {
    region.ownerCountryId = resolveScalar(
      region.ownerCountryId,
      "regions[*].ownerCountryId",
      false,
      resolve
    )!;
    if (region.occupiedBy !== undefined) {
      const next = resolveScalar(region.occupiedBy, "regions[*].occupiedBy", true, resolve);
      if (next === undefined || next === region.ownerCountryId) delete region.occupiedBy;
      else region.occupiedBy = next;
    }
  }

  // --- страны: дипломатия и валютная зона ---
  for (const country of game.countries) {
    if (country.currencyZoneAnchor !== undefined) {
      const next = resolveScalar(
        country.currencyZoneAnchor,
        "countries[*].currencyZoneAnchor",
        true,
        resolve
      );
      // Якорем самому себе страна не бывает: «является ли X якорем» выводится
      // из того, что на него ссылаются другие (см. `Country.currencyZoneAnchor`).
      if (next === undefined || next === country.id) delete country.currencyZoneAnchor;
      else country.currencyZoneAnchor = next;
    }

    const diplomacy = country.diplomacy;
    for (const field of ["allies", "rivals", "puppets", "sphereOfInfluence", "guarantees"] as const) {
      remapIdList(diplomacy[field], `countries[*].diplomacy.${field}[*]`, resolve, country.id);
    }

    // Отношения и влияние: при столкновении побеждает значение ВЫЖИВШЕЙ страны.
    // Отношение третьей страны к B прожито и накоплено, отношение к исчезнувшей
    // A — запись о том, кого больше нет; складывать или усреднять их значило бы
    // выдумать число, которого не было ни у одной пары.
    const keepExisting = <V>(existing: V): V => existing;
    remapIdKeyedRecord(
      diplomacy.relations,
      "countries[*].diplomacy.relations{*}",
      resolve,
      keepExisting,
      country.id
    );
    remapIdKeyedRecord(
      diplomacy.influence,
      "countries[*].diplomacy.influence{*}",
      resolve,
      keepExisting,
      country.id
    );
    // Санкции — ОБЪЕДИНЕНИЕ: санкция против A и санкция против B обе остаются в
    // силе против преемника. Это не число, а набор действующих режимов, и
    // «выжившая победила» отменяло бы половину из них молча.
    remapIdKeyedRecord<SanctionType[]>(
      diplomacy.sanctions,
      "countries[*].diplomacy.sanctions{*}",
      resolve,
      (existing, incoming) => [...new Set([...existing, ...incoming])],
      country.id
    );
  }

  // --- войны ---
  for (const war of game.wars) {
    remapIdList(war.attackers, "wars[*].attackers[*]", resolve);
    remapIdList(war.defenders, "wars[*].defenders[*]", resolve);

    const supporters: typeof war.supporters = [];
    for (const supporter of war.supporters) {
      const next = resolveScalar(
        supporter.countryId,
        "wars[*].supporters[*].countryId",
        true,
        resolve
      );
      if (next === undefined) continue;
      if (supporters.some(s => s.countryId === next && s.side === supporter.side)) continue;
      supporters.push({ ...supporter, countryId: next });
    }
    war.supporters = supporters;

    // Потери СКЛАДЫВАЮТСЯ: это накопленный факт о людях, а не мнение стороны.
    remapIdKeyedRecord(
      war.casualties,
      "wars[*].casualties{*}",
      resolve,
      (existing, incoming) => existing + incoming
    );
  }

  // --- модификаторы: страновая цель ---
  game.modifiers = game.modifiers.filter(modifier => {
    if (modifier.target.kind !== "country") return true;
    const next = resolveScalar(
      String(modifier.target.id),
      "modifiers[*].target.id",
      true,
      resolve
    );
    if (next === undefined) return false;
    modifier.target.id = next;
    return true;
  });

  // --- объекты карты: владелец объекта ---
  for (const feature of game.mapFeatures) {
    if (feature.ownerId === undefined) continue;
    const next = resolveScalar(feature.ownerId, "mapFeatures[*].ownerId", true, resolve);
    // Объект переживает исчезновение владельца: завод и порт остаются на
    // карте, сменив хозяина или оставшись бесхозными. Удалять их вместе со
    // страной значило бы стирать инфраструктуру региона, который просто сменил
    // флаг.
    if (next === undefined) delete feature.ownerId;
    else feature.ownerId = next;
  }

  // --- одноразовые факты для промта ---
  game.pendingWorldFacts = game.pendingWorldFacts.filter(fact => {
    const next = resolveScalar(fact.countryId, "pendingWorldFacts[*].countryId", true, resolve);
    if (next === undefined) return false;
    fact.countryId = next;
    return true;
  });

  const consumption = game.pendingPromptConsumption;
  if (consumption) {
    consumption.facts = consumption.facts.filter(fact => {
      const next = resolveScalar(
        fact.countryId,
        "pendingPromptConsumption.facts[*].countryId",
        true,
        resolve
      );
      if (next === undefined) return false;
      fact.countryId = next;
      return true;
    });
  }

  // --- бюджет хода: страна вшита в составной ключ подстрокой ---
  const budget = game.primitiveTurnBudget as GameState["primitiveTurnBudget"] | undefined;
  if (budget?.targetUses) {
    const entries = Object.entries(budget.targetUses);
    for (const [key] of entries) delete budget.targetUses[key];
    for (const [key, value] of entries) {
      const next = remapBudgetKey(key, "primitiveTurnBudget.targetUses{*}", resolve);
      if (next === undefined) continue;
      // Складываем: две цели, ставшие одной, потратили ход дважды, и кап
      // «один verb на цель» обязан это видеть.
      budget.targetUses[next] = (budget.targetUses[next] ?? 0) + value;
    }
  }
}

/**
 * Снимает счётчики бюджета хода, ключуемые страной, которой больше нет.
 *
 * Нужна из-за ПОРЯДКА, а не из-за забытого места. Бюджет хода пишется в боевое
 * состояние ПОСЛЕ commit'а — из локальных счётчиков, снятых до применения
 * батча (`applyPrimitiveBatch`), — поэтому общий перенос ссылок, отработавший
 * ВНУТРИ примитива на клоне, до него не достаёт. Структурный глагол,
 * распустивший собственную цель, оставлял бы после себя запись
 * `"split_country -> country SUN"` о стране, которой в мире уже нет: висячая
 * ссылка (её ловят пост-инварианты и откатывают ВЕСЬ ответ) и бессмысленный
 * счётчик — слот хода, запертый за исчезнувшей целью.
 */
export function pruneTurnBudgetTargets(game: GameState): void {
  const budget = game.primitiveTurnBudget as GameState["primitiveTurnBudget"] | undefined;
  if (!budget?.targetUses) return;

  const alive = new Set(game.countries.map(c => c.id));
  const entries = Object.entries(budget.targetUses);
  for (const [key] of entries) delete budget.targetUses[key];
  for (const [key, value] of entries) {
    const kept = remapBudgetKey(key, "primitiveTurnBudget.targetUses{*}", id =>
      alive.has(id) ? id : undefined
    );
    if (kept === undefined) continue;
    budget.targetUses[kept] = (budget.targetUses[kept] ?? 0) + value;
  }
}

/** Одна найденная ссылка: где стоит и на кого указывает. */
export interface CountryReference {
  path: string;
  countryId: string;
}

/**
 * Все ссылки на страны в живом состоянии — ТЕМ ЖЕ обходом, что и перенос.
 *
 * Работает на клоне и с резолвером-тождеством: состояние не меняется, но список
 * мест физически не может отстать от переноса, потому что это один код.
 */
export function collectCountryReferences(game: GameState): CountryReference[] {
  const found: CountryReference[] = [];
  remapCountryReferences(structuredClone(game), (countryId, refSite) => {
    found.push({ path: refSite.path, countryId });
    return countryId;
  });
  return found;
}

/**
 * Ссылки на страны, которых нет в ростере (§7.1 — «ноль висячих ссылок»).
 *
 * Проверяет ЖИВОЕ состояние; история сюда не входит по построению обхода
 * (см. шапку модуля).
 */
export function findDanglingCountryReferences(game: GameState): CountryReference[] {
  const roster = new Set(game.countries.map(c => c.id));
  return collectCountryReferences(game).filter(ref => !roster.has(ref.countryId));
}
