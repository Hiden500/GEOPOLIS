import { type GameState } from "@shared/types/GameState";
import { IMPACT_MEMORY_FIELDS } from "@shared/types/politics/Demographics";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { IDEOLOGY_AXES } from "@shared/types/politics/Ideology";
import {
  type AppliedPrimitive,
  type CountryScalarEffect,
  type CountryScalarField,
  type RelationEffect,
  impactEffectsOf,
} from "./types";

/**
 * Сверка ОПУБЛИКОВАННОГО результата примитива с тем, что он реально сделал с
 * состоянием (docs/PRIMITIVES.md §4).
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ. Нарратив и отклик игроку строятся по результату, который
 * возвращает обработчик глагола. Если результат расходится с состоянием, ложь
 * уходит наружу молча: `repress` по насыщенной группе отчитывался нулём,
 * фактически добавив отчуждение. До Милстоуна 1 рантайм-сверка ловила это
 * ТОЛЬКО в памяти воздействий (`groupImpactMemory`); координаты идеологии,
 * поддержка правительства и объекты карты держались на палитре и на внешних
 * тестах — то есть обработчик, соврав о сдвиге координат, был бы пойман тестом,
 * но не откатом.
 *
 * ЧЕМ ОБОБЩЕНО. Не «ещё три проверки рядом», а один механизм: состояние
 * раскладывается в плоскую карту ЧИСЛОВЫХ ЯЧЕЕК со стабильными ключами, диф
 * снимков «до» и «после» даёт фактические изменения, а результат примитива
 * раскладывается теми же ключами. Расхождение в любую сторону и по любому
 * каналу — откат примитива целиком. Новый глагол, который начнёт писать в уже
 * перечисленный канал, попадает под сверку без единой правки этого модуля.
 *
 * ЧЕМ ДЕРЖИТСЯ НОВЫЙ КАНАЛ, названо точно (исправлено 2026-07-27 по
 * независимому ревью; прежняя формулировка обещала, что глагол с новым каналом
 * «не применится ни разу», и это было неправдой). Рантайм-отказа здесь нет и
 * быть не может: канала, которого нет в `enumerateCells`, нет и в дифе, поэтому
 * расхождения не возникает и примитив применяется БЕЗ сверки — тихая дыра, а не
 * громкий отказ. Держат её два стража, оба до рантайма:
 *   - `reportedCells` — исчерпывающий `switch` с проверкой на `never`: новый
 *     глагол не компилируется, пока автор не решит, что тот заявляет;
 *   - тест «палитра и сверка описывают одни и те же каналы»
 *     (`server/src/__tests__/milestone1Contracts.test.ts`) — числовой путь,
 *     разрешённый палитрой, обязан иметь канал в разложении ниже; путь, о
 *     котором тест не знает, валит тест, а не отфильтровывается.
 *
 * ЧТО ПОД СВЕРКУ НЕ ПОПАДАЕТ, названо явно: `nextFeatureId` (счётчик, а не
 * заявление о мире — его правдивость держит палитра) и поля самих объектов
 * карты, включая числовой `regionId`: объект сверяется ФАКТОМ создания
 * («заявленный создан, созданный заявлен»), а не ячейками.
 */

/** Допуск на ошибку представления double, а не на «примерно совпало». */
const RECONCILE_EPSILON = 1e-9;

/** Одна числовая ячейка состояния со стабильным ключом. */
export type StateCells = Map<string, number>;

function impactCellKey(regionId: number, groupId: string, field: string): string {
  return `impact:${regionId}/${groupId}.${field}`;
}

function ideologyCellKey(countryId: string, axis: string): string {
  return `ideology:${countryId}.${axis}`;
}

/**
 * Ключ ячейки скалярного поля страны.
 *
 * Префикс `governmentSupport` остался историческим `support:` намеренно: ключи
 * уезжают в текст расхождения и в тесты, и переименование ради симметрии
 * стоило бы правок там, где ничего не меняется по существу.
 */
const COUNTRY_SCALAR_CELL_PREFIX: Record<CountryScalarField, string> = {
  governmentSupport: "support",
  legitimacy: "legitimacy",
  treasury: "treasury",
  activePersonnel: "personnel",
};

function countryScalarCellKey(countryId: string, field: CountryScalarField): string {
  return `${COUNTRY_SCALAR_CELL_PREFIX[field]}:${countryId}`;
}

function supportCellKey(countryId: string): string {
  return countryScalarCellKey(countryId, "governmentSupport");
}

/**
 * Ключ ячейки одной СТОРОНЫ двусторонних отношений.
 *
 * Ячейка на упорядоченную пару, а не на пару-множество: `changeRelation` пишет
 * инициатору полную дельту, а адресату половину, и одна ячейка на обе стороны
 * означала бы, что сверка не отличит правдивый отчёт от отчёта, перепутавшего
 * стороны местами.
 */
function relationCellKey(fromCountryId: string, toCountryId: string): string {
  return `relation:${fromCountryId}->${toCountryId}`;
}

/**
 * Ключ ячейки влияния — тоже на УПОРЯДОЧЕННУЮ пару, но по другой причине, чем
 * у отношений.
 *
 * У отношений две записи потому, что `changeRelation` пишет обеим сторонам
 * разные дельты. Влияние несимметрично ПО ОПРЕДЕЛЕНИЮ (`DiplomacyState`:
 * «влияние на другие страны»): обратной записи у него не существует вовсе, и
 * ячейка на пару-множество означала бы, что сверка не отличит влияние донора на
 * получателя от обратного.
 */
function influenceCellKey(fromCountryId: string, toCountryId: string): string {
  return `influence:${fromCountryId}->${toCountryId}`;
}

/**
 * Ключ ячейки ВВП региона.
 *
 * Появилась вместе с `capital_flight`: он бьёт по региональному производству, а
 * `country.economy.gdp` — агрегат, который тик перезаписывает из регионов.
 *
 * ЦЕНА НАЗВАНА: разложение состояния теперь обходит и регионы (1399 в
 * поставляемом сценарии), а `findMisreportedChanges` строит его дважды на
 * примитив. Верхняя граница расхода — кап примитивов на ход (11), то есть
 * порядка 30 тысяч итераций на ответ модели, раз в игровой месяц. Это
 * несопоставимо дешевле пост-инвариантов, которые обходят мир целиком.
 */
function regionGdpCellKey(regionId: number): string {
  return `regionGdp:${regionId}`;
}

/**
 * Ключ ячейки живой силы страны.
 *
 * `activePersonnel`, а не `armyStrength`: первое — единственное военное число,
 * которое реально читает бой (`simulation/war/WarTick.ts::sideStrength`),
 * второе статичный ноль во всех сгенерированных странах.
 */
function personnelCellKey(countryId: string): string {
  return countryScalarCellKey(countryId, "activePersonnel");
}

/**
 * Все числовые ячейки состояния, которые АЛФАВИТ вправе менять.
 *
 * Перечень выведен из палитры (`palette.ts`): каждый числовой путь, стоящий
 * хоть у одного глагола, обязан иметь здесь канал. Проверяется тестом
 * «палитра и сверка описывают одни и те же каналы» — иначе палитра разрешила бы
 * менять то, о чём сверка не спросит.
 *
 * Координаты идеологии читаются через `resolveIdeologyCoordinates`, а не из
 * сырого поля: у страны, чьи координаты ещё не материализованы из ярлыка
 * идеологии, сырого поля нет вовсе, и «до» пришлось бы считать отсутствием.
 * Резолвер даёт одно и то же значение в обоих снимках, поэтому нетронутая
 * страна честно даёт нулевую разницу.
 */
export function enumerateCells(game: GameState): StateCells {
  const cells: StateCells = new Map();

  for (const memory of game.groupImpactMemory) {
    for (const field of IMPACT_MEMORY_FIELDS) {
      cells.set(impactCellKey(memory.regionId, memory.groupId, field), memory[field]);
    }
  }

  for (const country of game.countries) {
    const coordinates = resolveIdeologyCoordinates(country.politics);
    for (const axis of IDEOLOGY_AXES) {
      cells.set(ideologyCellKey(country.id, axis), coordinates[axis]);
    }
    cells.set(supportCellKey(country.id), country.politics.governmentSupport);
    cells.set(countryScalarCellKey(country.id, "legitimacy"), country.politics.legitimacy);
    cells.set(countryScalarCellKey(country.id, "treasury"), country.economy.treasury);

    // Отношения перечисляются по ФАКТИЧЕСКИ существующим записям, а не по
    // декартову произведению стран: словарь разрежен (в сценарии 1946 он пуст у
    // всех 157 стран), и обход всех пар стоил бы O(n²) на каждый примитив ради
    // ячеек, которых нет. Отсутствующая ячейка читается сверкой как ноль — для
    // отношений это верно ровно так же, как для памяти воздействий: «записи
    // нет» и «отношения нулевые» — одно утверждение о мире.
    for (const [targetId, value] of Object.entries(country.diplomacy.relations)) {
      cells.set(relationCellKey(country.id, targetId), value);
    }
    // Влияние перечисляется по фактическим записям по той же причине, что
    // отношения: словарь разрежен (47 непустых из 157 в сценарии 1946), и
    // отсутствующая ячейка честно читается сверкой как ноль.
    for (const [targetId, value] of Object.entries(country.diplomacy.influence)) {
      cells.set(influenceCellKey(country.id, targetId), value);
    }
    cells.set(personnelCellKey(country.id), country.military.activePersonnel);
  }

  for (const region of game.regions) {
    cells.set(regionGdpCellKey(region.id), region.gdp);
  }

  return cells;
}

/** Изменение одной ячейки между снимками. */
export interface CellChange {
  key: string;
  before: number;
  after: number;
}

/**
 * Фактические изменения между снимками — только ненулевые.
 *
 * Ячейка, появившаяся или исчезнувшая между снимками (первое касание пары
 * «регион, группа» создаёт запись памяти), считается от нуля: отсутствие следа
 * и нулевой след — одно и то же утверждение о мире.
 */
export function cellChanges(before: StateCells, after: StateCells): CellChange[] {
  const changes: CellChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key) ?? 0;
    const now = after.get(key) ?? 0;
    if (Math.abs(now - was) > RECONCILE_EPSILON) changes.push({ key, before: was, after: now });
  }
  return changes;
}

/**
 * Ячейки, которые ОБЪЯВИЛ результат примитива, теми же ключами.
 *
 * `switch` исчерпывающий ЯВНО — ветка `default` присваивает разобранное
 * значение в `never`. Одних `case` для этого мало: ветки здесь заканчиваются
 * `break`, а не `return`, и такой `switch` TypeScript на полноту не проверяет
 * вовсе — глагол без ветки компилировался бы молча (найдено независимым ревью
 * 2026-07-27 добавлением шестого глагола). Теперь не компилируется, и результат
 * нового глагола невозможно случайно оставить непроверенным.
 */
export function reportedCells(applied: AppliedPrimitive): CellChange[] {
  const changes: CellChange[] = impactEffectsOf(applied).map(effect => ({
    key: impactCellKey(effect.regionId, effect.groupId, effect.field),
    before: effect.before,
    after: effect.after,
  }));

  /** Общие для дипломатического блока каналы — объявляются одинаково. */
  const pushRelations = (effects: readonly RelationEffect[]): void => {
    for (const effect of effects) {
      changes.push({
        key: relationCellKey(effect.fromCountryId, effect.toCountryId),
        before: effect.before,
        after: effect.after,
      });
    }
  };
  const pushScalars = (effects: readonly CountryScalarEffect[]): void => {
    for (const effect of effects) {
      changes.push({
        key: countryScalarCellKey(effect.countryId, effect.field),
        before: effect.before,
        after: effect.after,
      });
    }
  };

  switch (applied.verb) {
    case "diplomacy":
    case "sanction":
    case "war":
      pushRelations(applied.relationEffects);
      break;
    case "peace":
      pushRelations(applied.relationEffects);
      pushScalars(applied.countryScalarEffects);
      break;
    case "enact_reform":
      for (const shift of applied.ideologyShifts) {
        changes.push({
          key: ideologyCellKey(shift.countryId, shift.axis),
          before: shift.before,
          after: shift.after,
        });
      }
      changes.push({
        key: supportCellKey(applied.politicalCost.countryId),
        before: applied.politicalCost.before,
        after: applied.politicalCost.after,
      });
      break;
    // Раскол делит казну метрополии и потому ОДНУ ячейку всё же заявляет
    // (Милстоун 1, дипломатический блок: ячейка `treasury:` появилась вместе с
    // репарациями `peace`). Всё остальное в расколе — состав мира, а не
    // значения полей: его правдивость держат сходимость сумм и ноль висячих
    // ссылок, механизмы, которые о смысле `countries` знают больше плоской
    // карты ячеек. Осколки в сверку не попадают вовсе: стран, которых не было
    // в снимке «до», `findMisreportedChanges` исключает по построению.
    case "split_country":
      pushScalars(applied.countryScalarEffects);
      break;
    // Мягкие воздействия Милстоуна 1. Скалярный список у них общий (казна,
    // легитимность, живая сила), поэтому три из четырёх разбираются одной
    // веткой; `send_aid` добавляет к нему свой канал влияния.
    case "capital_flight":
      pushScalars(applied.countryScalarEffects);
      for (const effect of applied.regionEffects) {
        changes.push({
          key: regionGdpCellKey(effect.regionId),
          before: effect.before,
          after: effect.after,
        });
      }
      break;
    case "condemn":
    case "support_proxy":
      pushScalars(applied.countryScalarEffects);
      break;
    case "send_aid":
      pushScalars(applied.countryScalarEffects);
      for (const effect of applied.influenceEffects) {
        changes.push({
          key: influenceCellKey(effect.fromCountryId, effect.toCountryId),
          before: effect.before,
          after: effect.after,
        });
      }
      break;
    case "incite_unrest":
    case "repress":
    case "grant_autonomy":
    case "spawn_incident":
    // Подчинение и поглощение не заявляют НИ ОДНОЙ числовой ячейки, и это
    // свойство класса, а не пропуск: `puppet` меняет два поля-перечисления и
    // список, `annex` — владение регионами и агрегаты, выводимые из них.
    // Правдивость обоих держат пост-инварианты (согласованность подчинения,
    // ноль висячих ссылок, столица среди своих регионов) — механизмы, знающие
    // о смысле этих полей больше, чем плоская карта чисел. Агрегаты страны
    // (`population`, `economy.gdp`) ячеек не имеют вовсе: их источник —
    // регионы, а не заявление глагола.
    case "puppet":
    case "annex":
      break;
    default:
      assertNeverVerb(applied);
  }

  return changes;
}

/**
 * Страж полноты `switch` для веток, заканчивающихся `break`.
 *
 * Возвращает `never`, поэтому глагол, не разобранный ни одной веткой, не
 * приводится к типу параметра и валит компиляцию. Рантайм-бросок — не защита, а
 * следствие: до него можно доехать только сборкой в обход `tsc`.
 */
function assertNeverVerb(applied: never): never {
  throw new Error(
    `Primitive verb is not handled by reconciliation: ${JSON.stringify(applied)}`
  );
}

/** Объекты карты, о создании которых заявил результат. */
function reportedMapFeatureIds(applied: AppliedPrimitive): string[] {
  switch (applied.verb) {
    case "spawn_incident":
      return [applied.mapFeatureId];
    case "incite_unrest":
    case "repress":
    case "grant_autonomy":
    case "enact_reform":
    case "split_country":
    case "diplomacy":
    case "sanction":
    case "war":
    // Мир объекты карты только УДАЛЯЕТ (батальоны закрытой войны), а сверка
    // здесь спрашивает про созданные. Удаление объявлено палитрой маркером
    // `mapFeatures[-]`.
    case "peace":
    // Мягкие воздействия Милстоуна 1 карту не трогают вовсе — ни один из них
    // не заявляет объекта в палитре.
    case "send_aid":
    case "capital_flight":
    case "condemn":
    case "support_proxy":
    // Структурные глаголы подчинения и поглощения карту не трогают: объекты
    // переживают смену флага региона (`mapFeatures[*].ownerId` в палитре
    // раскола — это перенос владельца, а не создание).
    case "puppet":
    case "annex":
      return [];
  }
}

/** Суммарная заявленная дельта по ключу: примитив вправе писать в ячейку несколько раз. */
function totalsByKey(changes: readonly CellChange[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const change of changes) {
    totals.set(change.key, (totals.get(change.key) ?? 0) + (change.after - change.before));
  }
  return totals;
}

/**
 * Расхождения отчёта примитива с фактическим дифом состояния.
 *
 * Ловятся три вида лжи, симметрично и по всем каналам сразу:
 *   1. **скрытый эффект** — изменил и не сказал;
 *   2. **выдуманный эффект** — сказал и не изменил;
 *   3. **подменённая величина** — ключ тот, число другое.
 *
 * Плюс четвёртый, специфичный для карты: заявленный объект карты не создан, или
 * создан объект, о котором результат молчит.
 */
export function findMisreportedChanges(
  applied: AppliedPrimitive,
  before: GameState,
  after: GameState
): string[] {
  // Сверяются только страны, существующие ПО ОБЕ стороны (Милстоун 1, сессия
  // жизненного цикла).
  //
  // Почему нельзя иначе. `cellChanges` считает отсутствующую ячейку нулём, и для
  // памяти воздействий это ВЕРНО: она разрежена, «следа нет» и «след нулевой» —
  // одно утверждение о мире. Для страны это неверно: у несуществующего
  // государства нет координат идеологии, и ноль не является их значением.
  // Появление страны читалось бы как «кто-то сдвинул её координаты с нуля до
  // −0.10», и структурный глагол, честно не заявивший ни одной ячейки,
  // откатывался бы за ложь о том, чего он не делал.
  //
  // Изменение СОСТАВА мира проверяется не здесь, а суммами и висячими ссылками
  // (`polityLifecycle.ts`, `invariants.ts`) — механизмами, которые знают смысл
  // `countries`, в отличие от плоской карты числовых ячеек.
  const common = new Set(
    after.countries.map(c => c.id).filter(id => before.countries.some(c => c.id === id))
  );
  const onlyCommon = (game: GameState): GameState => ({
    ...game,
    countries: game.countries.filter(c => common.has(c.id)),
  });

  const actual = totalsByKey(
    cellChanges(enumerateCells(onlyCommon(before)), enumerateCells(onlyCommon(after)))
  );
  const reported = totalsByKey(reportedCells(applied));

  const mismatches = [...new Set([...actual.keys(), ...reported.keys()])]
    .filter(key => Math.abs((reported.get(key) ?? 0) - (actual.get(key) ?? 0)) > RECONCILE_EPSILON)
    .map(
      key =>
        `${key} reported ${(reported.get(key) ?? 0).toFixed(3)}, ` +
        `actually ${(actual.get(key) ?? 0).toFixed(3)}`
    );

  const existing = new Set(before.mapFeatures.map(f => f.id));
  const created = after.mapFeatures.filter(f => !existing.has(f.id)).map(f => f.id);
  const claimed = reportedMapFeatureIds(applied);
  for (const id of created.filter(id => !claimed.includes(id))) {
    mismatches.push(`map feature ${id} was created without being reported`);
  }
  for (const id of claimed.filter(id => !created.includes(id))) {
    mismatches.push(`map feature ${id} was reported but not created`);
  }

  return mismatches;
}
