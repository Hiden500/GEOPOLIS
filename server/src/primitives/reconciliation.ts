import { type GameState } from "@shared/types/GameState";
import { IMPACT_MEMORY_FIELDS } from "@shared/types/politics/Demographics";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { IDEOLOGY_AXES } from "@shared/types/politics/Ideology";
import { type AppliedPrimitive, impactEffectsOf } from "./types";

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
 * перечисленный канал, попадает под сверку без единой правки этого модуля;
 * глагол с НОВЫМ каналом обязан добавить канал и сюда, и в `reportedCells` —
 * иначе его запись будет выглядеть скрытым эффектом и он не применится ни разу.
 * Это осознанно громкий отказ вместо тихой дыры.
 *
 * ЧТО ПОД СВЕРКУ НЕ ПОПАДАЕТ, названо явно: `nextFeatureId` (счётчик, а не
 * заявление о мире — его правдивость держит палитра) и нечисловые поля самих
 * объектов карты, кроме факта создания объекта с заявленным id.
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

function supportCellKey(countryId: string): string {
  return `support:${countryId}`;
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
 * `switch` исчерпывающий: глагол без ветки не компилируется, и его результат
 * невозможно случайно оставить непроверенным.
 */
export function reportedCells(applied: AppliedPrimitive): CellChange[] {
  const changes: CellChange[] = impactEffectsOf(applied).map(effect => ({
    key: impactCellKey(effect.regionId, effect.groupId, effect.field),
    before: effect.before,
    after: effect.after,
  }));

  switch (applied.verb) {
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
    case "incite_unrest":
    case "repress":
    case "grant_autonomy":
    case "spawn_incident":
      break;
  }

  return changes;
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
  const actual = totalsByKey(cellChanges(enumerateCells(before), enumerateCells(after)));
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
