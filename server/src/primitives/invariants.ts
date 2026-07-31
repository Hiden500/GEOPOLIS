import { type GameState } from "@shared/types/GameState";
import { IMPACT_MEMORY_FIELDS } from "@shared/types/politics/Demographics";
import { IDEOLOGY_AXES, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX } from "@shared/types/politics/Ideology";
import { COUNTRY_POLITICS_SCALE_MAX } from "@shared/defines/discontent";
import { findDanglingCountryReferences } from "./countryRefs";
import { findSubordinationViolations } from "./subordination";

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
 * ССЫЛОЧНАЯ ЦЕЛОСТНОСТЬ СТРАН добавлена Милстоуном 1 (сессия жизненного цикла)
 * и стала содержательной ровно тогда, когда появились операции, способные её
 * нарушить (`CONCEPT.md` §7.1 — «ноль висячих ссылок»). До этого проверки не
 * было, и её отсутствие обосновывалось тем, что данные сценария 1946 якобы
 * содержат регионы вне ростера стран. **Это обоснование устарело**: прямой
 * подсчёт по загруженной партии 1946 (157 стран, 1399 регионов) даёт НОЛЬ
 * висячих владельцев, ноль столиц вне набора регионов и ноль объектов карты с
 * неизвестным владельцем. Проверка поэтому сформулирована как абсолют, а не как
 * «операция не вносит новых нарушений»: дельта-формулировка молча узаконила бы
 * любое нарушение, уже лежащее в данных.
 *
 * Места ссылок перечисляет НЕ этот модуль, а `countryRefs.ts` — тот же обход,
 * которым жизненный цикл ссылки переносит. Два списка разошлись бы на первом
 * же новом поле, и проверка подтверждала бы целостность ровно тех мест, о
 * которых перенос и так помнит.
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

  // --- состав стран и ссылки на них (docs/CONCEPT.md §7.1) ---
  const countryIds = new Set<string>();
  for (const country of game.countries) {
    if (countryIds.has(country.id)) violations.push(`duplicate country id ${country.id}`);
    countryIds.add(country.id);
    // Столица — ссылка на регион, а не на страну, поэтому её проверяет этот
    // модуль, а не обход `countryRefs.ts`.
    //
    // Условие «страна ВЛАДЕЕТ хотя бы одним регионом» существенно и не является
    // послаблением ради тестов. Государство без территории — законное состояние
    // мира по §7.1: тотально побеждённый субъект переходит в подчинённое
    // положение, а не растворяется в победителе, и столица у него остаётся
    // указанием на потерянную столицу, а не ошибкой данных. Требовать владения
    // от него значило бы либо удалять побеждённых (чего §7.1 прямо не велит),
    // либо выдумывать им столицу на чужой земле.
    const owned = game.regions.filter(r => r.ownerCountryId === country.id);
    if (owned.length === 0) continue;

    const capital = owned.find(r => r.id === country.capitalRegionId);
    if (!capital) {
      violations.push(
        `${country.id} owns ${owned.length} region(s) but its capital ` +
          `${country.capitalRegionId} is not among them`
      );
    }
  }

  // Висячие ссылки на страны — ОДНИМ обходом, объявленным в `countryRefs.ts`.
  // Здесь только группировка: битое состояние способно дать тысячи ссылок на
  // одну исчезнувшую страну, а сообщение читает человек.
  const danglingByCountry = new Map<string, string[]>();
  for (const reference of findDanglingCountryReferences(game)) {
    const paths = danglingByCountry.get(reference.countryId);
    if (paths) {
      if (!paths.includes(reference.path)) paths.push(reference.path);
    } else {
      danglingByCountry.set(reference.countryId, [reference.path]);
    }
  }
  for (const [countryId, paths] of danglingByCountry) {
    violations.push(`dangling reference to unknown country ${countryId} at ${paths.join(", ")}`);
  }

  // Согласованность двух представлений зависимости (docs/DIPLOMACY.md).
  // Перенесено сюда из слоя данных Милстоуном 1 вместе с глаголом `puppet`:
  // пока `diplomacy.puppets` в рантайме не менял никто, инвариант проверялся
  // валидатором пайплайна и тестом по загруженному сценарию, и этого хватало.
  // С появлением механики вассалитета мир, где марионетка юридически
  // суверенна, стал достижим игровым путём — то есть проверка обязана стоять
  // там, где стоят остальные пост-инварианты транзакции и загрузки сейва.
  violations.push(...findSubordinationViolations(game));

  // --- кампания (docs/CONCEPT.md §6, §7.1) ---
  const campaign = game.campaign as GameState["campaign"] | undefined;
  if (!campaign || typeof campaign !== "object") {
    violations.push("campaign state is missing");
  } else if (campaign.status === "succession_choice_pending") {
    // Осколки обязаны существовать: выбор из несуществующих преемников — не
    // ожидание решения, а тупик, из которого партия не выходит.
    for (const id of campaign.successorCountryIds) {
      if (!countryIds.has(id)) {
        violations.push(`campaign offers a successor that does not exist: ${id}`);
      }
    }
    if (campaign.successorCountryIds.length < 2) {
      violations.push("campaign waits for a succession choice with fewer than two successors");
    }
  }

  return violations;
}
