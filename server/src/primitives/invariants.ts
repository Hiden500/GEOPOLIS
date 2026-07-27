import { type GameState } from "@shared/types/GameState";
import { IMPACT_MEMORY_FIELDS } from "@shared/types/politics/Demographics";
import { IDEOLOGY_AXES, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX } from "@shared/types/politics/Ideology";
import { COUNTRY_POLITICS_SCALE_MAX } from "@shared/defines/discontent";

/**
 * Инварианты состояния, которые движок отказывается коммитить и отказывается
 * загружать (docs/CONCEPT.md §7.1, docs/PRIMITIVES.md §3).
 *
 * ОДНО определение на два потребителя, и это главное свойство модуля:
 *   - **пост-инварианты транзакции ответа** — последняя фаза
 *     `plan → validate → apply → post-invariants → commit`. До Милстоуна 1
 *     фазы были размазаны по циклу применения, а глобальной проверки «мир
 *     после ответа вообще пригоден» не существовало вовсе: каждый примитив
 *     проверял себя, и никто не проверял результат;
 *   - **валидация сейва при загрузке**. Сейв текущей версии принимался
 *     приведением типа: порча вроде `primitiveTurnBudget.softUsed = -100`
 *     проходила и снимала капы хода — то есть защита, ради которой бюджет
 *     переехал в состояние, отключалась чужим файлом молча.
 *
 * Два потребителя одного определения — не экономия строк, а само требование:
 * «состояние, которое движок готов принять» обязано означать одно и то же на
 * входе из файла и на выходе из транзакции. Иначе загрузка принимала бы то,
 * что транзакция откатывает.
 *
 * ГРАНИЦА, НАЗВАННАЯ ЯВНО. Это НЕ полная схема `GameState`. Проверяются поля,
 * на которых держатся защиты алфавита (бюджет хода, память воздействий,
 * координаты и поддержка) и ссылочная целостность того, что примитивы
 * создают (память воздействий, объекты карты). Геометрия регионов, экономика,
 * военный контур и дипломатия сюда НЕ входят: их порча ломает свои подсистемы,
 * а не защиты примитивов, и полная схема мира стоила бы дороже, чем даёт.
 * Расширять — вместе с подсистемой, а не «за компанию».
 *
 * Владение регионами тоже НЕ проверяется на существование страны: сегодняшний
 * алфавит его не меняет, а данные сценария 1946 содержат регионы вне ростера
 * стран (проверено прямым подсчётом — см. `invariants.test.ts`). Проверка
 * висячих ссылок владения приедет вместе с lifecycle-примитивами §7.1, которые
 * страны создают и удаляют, — там она и станет содержательной.
 */

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Нарушения инвариантов; пустой массив — состояние пригодно.
 *
 * Возвращает список, а не бросает: пост-инвариант транзакции обязан назвать
 * ВСЁ, что не так, одним ответом — иначе откат объясняется первым найденным
 * симптомом, а причина ищется по одной за раз.
 */
export function findStateViolations(game: GameState): string[] {
  const violations: string[] = [];

  // --- бюджет хода: на нём держатся все четыре капа §4 ---
  const budget = game.primitiveTurnBudget as GameState["primitiveTurnBudget"] | undefined;
  if (!budget || typeof budget !== "object") {
    violations.push("primitiveTurnBudget is missing");
  } else {
    if (typeof budget.date !== "string" || budget.date.length === 0) {
      violations.push("primitiveTurnBudget.date is not a date string");
    }
    for (const field of ["softUsed", "structuralUsed"] as const) {
      const used = budget[field];
      if (!finite(used) || used < 0 || !Number.isInteger(used)) {
        violations.push(`primitiveTurnBudget.${field} is not a non-negative integer`);
      }
    }
    for (const [name, counters] of [
      ["targetUses", budget.targetUses],
      ["impactAccrued", budget.impactAccrued],
    ] as const) {
      if (!counters || typeof counters !== "object") {
        violations.push(`primitiveTurnBudget.${name} is not an object`);
        continue;
      }
      for (const [key, value] of Object.entries(counters)) {
        if (!finite(value) || value < 0) {
          violations.push(`primitiveTurnBudget.${name}["${key}"] is not a non-negative number`);
        }
      }
    }
  }

  // --- память воздействий: диапазон полей и ссылочная целостность ---
  const regionIds = new Set(game.regions.map(r => r.id));
  const groupIds = new Set(game.ethnicGroups.map(g => g.id));
  for (const memory of game.groupImpactMemory) {
    if (!regionIds.has(memory.regionId)) {
      violations.push(`groupImpactMemory refers to unknown region ${memory.regionId}`);
    }
    if (!groupIds.has(memory.groupId)) {
      violations.push(`groupImpactMemory refers to unknown group ${memory.groupId}`);
    }
    for (const field of IMPACT_MEMORY_FIELDS) {
      const value = memory[field];
      if (!finite(value) || value < 0 || value > 1) {
        violations.push(
          `groupImpactMemory[${memory.regionId}/${memory.groupId}].${field} is outside 0..1`
        );
      }
    }
  }

  // --- политика стран: то, что двигает реформа ---
  for (const country of game.countries) {
    const support = country.politics.governmentSupport;
    if (!finite(support) || support < 0 || support > COUNTRY_POLITICS_SCALE_MAX) {
      violations.push(
        `${country.id}.politics.governmentSupport is outside 0..${COUNTRY_POLITICS_SCALE_MAX}`
      );
    }
    const coordinates = country.politics.ideologyCoordinates;
    if (coordinates) {
      for (const axis of IDEOLOGY_AXES) {
        const value = coordinates[axis];
        if (!finite(value) || value < IDEOLOGY_AXIS_MIN || value > IDEOLOGY_AXIS_MAX) {
          violations.push(
            `${country.id}.politics.ideologyCoordinates.${axis} is outside ` +
              `${IDEOLOGY_AXIS_MIN}..${IDEOLOGY_AXIS_MAX}`
          );
        }
      }
    }
  }

  // --- объекты карты: примитив их создаёт, значит он и может оставить висячий ---
  // `regionId` у объекта необязателен (глобальные объекты вроде маршрутов к
  // региону не привязаны) — проверяется только заполненный.
  for (const feature of game.mapFeatures) {
    if (feature.regionId !== undefined && !regionIds.has(feature.regionId)) {
      violations.push(`map feature ${feature.id} refers to unknown region ${feature.regionId}`);
    }
  }
  if (!finite(game.nextFeatureId) || game.nextFeatureId < 0) {
    violations.push("nextFeatureId is not a non-negative number");
  }

  return violations;
}
