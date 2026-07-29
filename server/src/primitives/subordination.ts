import { type GameState } from "@shared/types/GameState";
import {
  type SovereigntyStatus,
  SOVEREIGN_STATUS,
  VASSALAGE_DEFAULT_STATUS,
} from "@shared/types/politics/Government";
import { setSubordination } from "../commands/lifecycle";

/**
 * Подчинение одного государства другому — ОДНО место, где меняются оба
 * представления зависимости (docs/DIPLOMACY.md, `politics/Government.ts`).
 *
 * ЗАЧЕМ МОДУЛЬ СУЩЕСТВУЕТ. Зависимость описана в состоянии дважды и намеренно:
 * `politics.sovereigntyStatus` + `overlordIds` — ЮРИДИЧЕСКОЕ положение,
 * `diplomacy.puppets` — ЭФФЕКТИВНОЕ следование внешней политике сюзерена. Это
 * не дубль: зона оккупации подчинена юридически, но своей внешней политики не
 * имеет вовсе, а спорная администрация подчинена только на бумаге. Множества не
 * равны и равными быть не обязаны.
 *
 * Чего они не могут — ПРОТИВОРЕЧИТЬ друг другу: марионетка не бывает
 * юридически суверенной, и её сюзерен обязан входить в `overlordIds`. До этой
 * сессии инвариант держали только слой данных (валидатор пайплайна и тест по
 * загруженному сценарию), потому что менять `puppets` в рантайме было нечем —
 * ни один код в него не писал. С появлением `puppet` в алфавите писатель
 * появился, и «синхронизирует только слой данных» перестало быть отсрочкой:
 * мир, где Британия юридически суверенна и одновременно чья-то марионетка,
 * стал бы достижим игровым путём.
 *
 * ПОЧЕМУ ОДНО МЕСТО, А НЕ ДВЕ ЗАПИСИ ПО ФАКТУ. Тот же приём, что у
 * `countryRefs.ts`: определение и проверка обязаны быть выражены одним кодом,
 * иначе они расходятся на первой правке. `applyVassalage` заводит пару,
 * `findSubordinationViolations` читает её же, а `reconcileSubordination`
 * чинит асимметрию, которую способен породить ПЕРЕНОС ссылок (см. ниже).
 *
 * Сама ЗАПИСЬ живёт в `commands/lifecycle.ts::setSubordination` — движок
 * примитивов входит в периметр правила «мутации через команды» наравне с
 * `LLMService` и `AiBehaviorTick` (`docs/plans/03_MODIFIERS_COMMANDS.md`,
 * fitness-тест `__tests__/architecture.test.ts`). Здесь остаётся СМЫСЛ: кого
 * можно подчинять, какой статус получает суверенный субъект, что считать
 * нарушением.
 */

/**
 * Почему перенос ссылок способен разорвать пару.
 *
 * `remapCountryReferences` переписывает `puppets` и `overlordIds` независимо,
 * и в одном случае это даёт асимметрию: субъект B ИСЧЕЗАЕТ, а его ссылки
 * переходят к C. Тогда у сюзерена A запись `puppets: [B]` становится
 * `puppets: [C]`, но `overlordIds` у B исчез вместе с B, а у C своего никогда
 * не было — юридическая половина пары пропала, рантаймовая осталась.
 *
 * Чинится в сторону ПОДЧИНЕНИЯ, а не отмены: запись «A ведёт внешнюю политику
 * C» — это факт мира, доставшийся правопреемнику вместе с остальными
 * обязательствами предшественника, и снимать её значило бы освобождать клиента
 * от патрона за то, что патрон сменил имя.
 */
export function reconcileSubordination(game: GameState): void {
  const byId = new Map(game.countries.map(c => [c.id, c] as const));

  for (const overlord of game.countries) {
    for (const vassalId of overlord.diplomacy.puppets) {
      const vassal = byId.get(vassalId);
      // Ссылки на несуществующую страну — не забота этого модуля: их ловят
      // пост-инварианты (`findDanglingCountryReferences`), и чинить их здесь
      // значило бы прятать поломку графа под видом согласования.
      if (!vassal) continue;
      setSubordination(game, overlord.id, vassal.id, VASSALAGE_DEFAULT_STATUS);
    }
  }
}

/** Юридическое положение субъекта до и после подчинения — материал отчёта. */
export interface VassalageChange {
  vassalCountryId: string;
  overlordCountryId: string;
  statusBefore: SovereigntyStatus;
  statusAfter: SovereigntyStatus;
}

/**
 * Подчиняет одно государство другому — ОБА представления одним действием.
 *
 * Возвращает `undefined`, если ничего не изменилось (пара уже существовала):
 * вызывающий обязан отличать состоявшийся акт от повтора, а не докладывать о
 * подчинении, которого он не произвёл.
 */
export function applyVassalage(
  game: GameState,
  overlordId: string,
  vassalId: string
): VassalageChange | undefined {
  const overlord = game.countries.find(c => c.id === overlordId);
  const vassal = game.countries.find(c => c.id === vassalId);
  if (!overlord || !vassal) return undefined;
  if (overlord.id === vassal.id) return undefined;
  if (overlord.diplomacy.puppets.includes(vassal.id)) return undefined;

  const statusBefore = vassal.politics.sovereigntyStatus ?? SOVEREIGN_STATUS;
  const written = setSubordination(game, overlord.id, vassal.id, VASSALAGE_DEFAULT_STATUS);
  if (!written.success) return undefined;

  return {
    vassalCountryId: vassal.id,
    overlordCountryId: overlord.id,
    statusBefore,
    statusAfter: vassal.politics.sovereigntyStatus ?? SOVEREIGN_STATUS,
  };
}

/**
 * Сюзерены субъекта — прямые и через цепочку.
 *
 * Нужен для запрета цикла: A, подчинивший B, не может затем стать МАРИОНЕТКОЙ
 * B — «оба ведут внешнюю политику друг друга» не состояние мира, а поломка,
 * которую ни `WarService.findCoalitionFor`, ни `DiplomacyTick` не разберут.
 * Обход по `puppets`, а не по `overlordIds`, потому что цикл ломает именно
 * рантаймовое представление; юридическое следует за ним.
 */
export function overlordChainOf(game: GameState, vassalId: string): Set<string> {
  const found = new Set<string>();
  const queue = [vassalId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const country of game.countries) {
      if (!country.diplomacy.puppets.includes(current)) continue;
      if (found.has(country.id)) continue;
      found.add(country.id);
      queue.push(country.id);
    }
  }
  return found;
}

/**
 * Нарушения согласованности двух представлений зависимости.
 *
 * Односторонне НАМЕРЕННО: проверяется только «марионетка ⇒ юридически
 * подчинена названному сюзерену». Обратное — «несуверенная ⇒ марионетка» —
 * неверно и проверяться не должно: по данным 1946 таких субъектов четырнадцать
 * (зоны оккупации, оккупированные территории, спорные администрации), и они
 * законны (`NON_VASSAL_SUBORDINATION_STATUSES`).
 *
 * Висячие ссылки здесь не проверяются: у них свой обход и свой отказ.
 */
export function findSubordinationViolations(game: GameState): string[] {
  const violations: string[] = [];
  const byId = new Map(game.countries.map(c => [c.id, c] as const));

  for (const overlord of game.countries) {
    for (const vassalId of overlord.diplomacy.puppets) {
      const vassal = byId.get(vassalId);
      if (!vassal) continue;

      // Отсутствие статуса читается как СУВЕРЕННОСТЬ — ровно так же, как его
      // читает запись (`setSubordination`). Трактовать `undefined` как «данных
      // нет, вопросов нет» значило бы оставить дыру ровно того размера, ради
      // которого инвариант и заведён: марионетка с неразмеченным статусом
      // проходила бы проверку, а поставивший её код уже обязан статус
      // проставить. Единственный поставляемый сценарий (1946) размечает статус
      // у всех 157 стран, поэтому строгость ничего не ломает на данных — только
      // на состояниях, которых движок не создаёт.
      const status = vassal.politics.sovereigntyStatus ?? SOVEREIGN_STATUS;
      if (status === SOVEREIGN_STATUS) {
        violations.push(
          `${vassal.id} is a puppet of ${overlord.id} but legally sovereign`
        );
      }
      if (!(vassal.politics.overlordIds ?? []).includes(overlord.id)) {
        violations.push(
          `${vassal.id} is a puppet of ${overlord.id} which is not among its overlordIds`
        );
      }
    }
  }
  return violations;
}
