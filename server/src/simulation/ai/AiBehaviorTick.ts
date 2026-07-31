import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { calculateBaseInfluence } from "../diplomacy/DiplomacyTick";
import * as diplomacyCommands from "../../commands/diplomacy";
import * as economyCommands from "../../commands/economy";
import { type SpendKey } from "../../commands/economy";
import { effectiveValue } from "@shared/utils/modifiers";
import { ModifierAttribute } from "@shared/defines/modifierAttributes";
import {
  AUSTERITY_CUT,
  THREAT_LEVEL,
  MILITARY_RAMP,
  MILITARY_CAP_SHARE,
  COALITION_STEP,
  INFLUENCE_GRAVITY,
  STABILITY_LOW,
  WELFARE_SHIFT_RATE,
  WELFARE_CAP_SHARE,
} from "@shared/defines/ai";
import { DEBT_GDP_PENALTY_THRESHOLD } from "@shared/defines/economy";

/**
 * Детерминированное поведение ИИ-стран (без полноценного utility-AI).
 * Реализует доступное подмножество P2 (см. docs/DECISIONS.md, 2026-06-23):
 *  - Правило A: аустерити по дефициту.
 *  - Правило B: ответ на угрозу с полной балансировкой (военный ответ +
 *    контр-блок соперников + power→influence→сфера для бандвагонинга).
 *  - Правило C: при низкой stability сдвиг расходов с military → welfare.
 *  - Правило D УДАЛЕНО 2026-07-31 (разбор — ниже, у места, где оно стояло):
 *    объявление войны осталось только за игроком и режиссёром-LLM.
 *
 * Применяется только к ИИ-странам (id !== playerCountryId). Баланс-константы
 * — shared/src/defines/ai.ts.
 */

const DISCRETIONARY: SpendKey[] = [
  "militarySpending",
  "researchSpending",
  "educationSpending",
  "infrastructureSpending",
  "welfareSpending",
];

function totalIncome(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/**
 * Правило A — аустерити: при дефиците И высокой долговой нагрузке (долг/ВВП
 * выше DEBT_GDP_PENALTY_THRESHOLD) ИИ-страна урезает дискреционные расходы на
 * 5%/тик, но не ниже снимка пола (50% старта). Само-останавливается, когда
 * бюджет выходит из дефицита (следующий EconomyTick пересчитает budgetBalance
 * ≥ 0) или долг гасится ниже порога.
 *
 * Долг вместо казны как триггер (docs/plans/08_WAR_WAVE1.md, Шаг 4): с
 * конвертацией дефицита в долг казна больше не уходит в минус (пол 0), поэтому
 * прежний триггер `treasury < 0` стал бы мёртвым. Порог совпадает с началом
 * штрафа росту ВВП: ИИ затягивает пояс ровно тогда, когда долг начинает вредить.
 * Мутация — через commands/economy.ts.
 */
function applyDeficitAusterity(game: GameState, c: Country): void {
  const e = c.economy;
  if (e.budgetBalance >= 0 || !e.spendingFloor) return;
  const debtBurden = e.gdp > 0 ? e.debt / e.gdp : 0;
  if (debtBurden <= DEBT_GDP_PENALTY_THRESHOLD) return;

  economyCommands.applyDeficitAusterityCut(game, c.id, AUSTERITY_CUT, DISCRETIONARY);
}

/**
 * Правило C — при низкой stability (< 40) переносит расходы с military → welfare.
 * Не опускает military ниже пола; не поднимает welfare выше 30% дохода.
 * Stability читается через effectiveValue() (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 2), не сырое поле — единственный переведённый читатель в этом заходе,
 * демонстрирует реальную интеграцию модификаторов.
 */
function applyStabilityWelfareNudge(game: GameState, c: Country): void {
  const stability = effectiveValue(
    c.politics.stability,
    ModifierAttribute.Stability,
    { kind: "country", id: c.id },
    game.modifiers
  );
  if (stability >= STABILITY_LOW || !c.economy.spendingFloor) return;

  const income = totalIncome(c);
  if (income <= 0) return;

  const welfareCap = income * WELFARE_CAP_SHARE;
  if (c.economy.welfareSpending >= welfareCap) return;

  const shift = Math.min(
    income * WELFARE_SHIFT_RATE,
    welfareCap - c.economy.welfareSpending,
    c.economy.militarySpending - c.economy.spendingFloor.militarySpending
  );

  if (shift <= 0) return;

  economyCommands.shiftMilitaryToWelfare(game, c.id, shift);
}

/**
 * Правило B — ответ на угрозу с балансировкой/бандвагонингом.
 */
function applyThreatResponse(game: GameState, player: Country, aiCountries: Country[]): void {
  // Доминирование игрока над каждой ИИ-страной.
  const dom = new Map<string, number>();
  for (const c of aiCountries) {
    dom.set(c.id, calculateBaseInfluence(player, c));
  }

  // Угрожаемые: игрок доминирует И они не союзники игрока.
  const threatened = aiCountries.filter(
    c => (dom.get(c.id) ?? 0) > THREAT_LEVEL && !player.diplomacy.allies.includes(c.id)
  );

  for (const c of threatened) {
    const relToPlayer = c.diplomacy.relations[player.id] ?? 0;

    if (relToPlayer < 0) {
      // Балансировка — страна не любит игрока: вооружается и сближается с другими
      // угрожаемыми соперниками (контр-блок), сопротивляется влиянию игрока.
      const cap = totalIncome(c) * MILITARY_CAP_SHARE;
      if (c.economy.militarySpending < cap) {
        economyCommands.setMilitarySpending(game, c.id, Math.min(c.economy.militarySpending * MILITARY_RAMP, cap));
      }

      for (const other of threatened) {
        if (other.id === c.id) continue;
        const otherRelToPlayer = other.diplomacy.relations[player.id] ?? 0;
        if (otherRelToPlayer < 0) {
          diplomacyCommands.nudgeRelationOneSided(game, c.id, other.id, COALITION_STEP);
        }
      }
      // Сопротивление влиянию: влияние игрока над c не растёт (no-op).
    } else {
      // Бандвагонинг — страна терпит игрока: его влияние над ней растёт к dom,
      // при влиянии > 50 она входит в сферу игрока (порог в DiplomacyTick).
      const target = dom.get(c.id) ?? 0;
      diplomacyCommands.nudgeInfluenceTowardTarget(game, player.id, c.id, target, INFLUENCE_GRAVITY);
    }
  }
}

/**
 * ПРАВИЛО D УДАЛЕНО 2026-07-31 — решение пользователя, `docs/DECISIONS.md`.
 *
 * Правило объявляло войну соперникам среди non-major при отношениях ниже
 * `WAR_RELATION_THRESHOLD` и манпауэр-перевесе. За всё время существования оно
 * не объявило ни одной войны, и замер (`server/scripts/probeWarReach.ts`)
 * показал три независимых барьера, каждого из которых хватило бы:
 *
 *  1. У правила НОЛЬ кандидатов. Все 18 соперничеств мира к 120-му месяцу
 *     включают major-державу, а правило смотрело только пары, где обе стороны
 *     non-major. До порогов дело не доходило вовсе.
 *  2. Порог практически недостижим — но, в отличие от первого барьера, не
 *     абсолютно. Отношения соперников на 120-м месяце лежат в −23,1…−7,9, а
 *     самому агрессивному ИИ требуется −57,1; при этом на 60-м месяце дно
 *     доходило до −57,4, то есть порог КАСАЕТСЯ края распределения у одной
 *     пары. Это уточнение важнее, чем кажется: «недостижим» из прежних
 *     отчётов было выведено из констант, а измерение показало границу.
 *  3. Манпауэр-условие барьером НЕ было — вопреки прежним отчётам:
 *     `activePersonnel` нулевой только в месяц 0, к концу первого года медиана
 *     3826.
 *
 * Вместо починки трёх барьеров выбран отказ от механики: войну начинают игрок
 * (`POST /primitives/apply`) и режиссёр-LLM — оба через примитив `war`
 * (`PrimitiveEngine.ts`), оба пути живые и покрыты тестами. Цена решения
 * названа прямо: без LLM мир остаётся вечно мирным, и вся военная механика
 * (фронты, потери, мирные договоры) не запускается ничем.
 */

export function aiBehaviorTick(game: GameState): void {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  const aiCountries = game.countries.filter(c => c.id !== game.playerCountryId);

  for (const c of aiCountries) {
    applyDeficitAusterity(game, c);
    applyStabilityWelfareNudge(game, c);
  }

  if (player) {
    applyThreatResponse(game, player, aiCountries);
  }
}
