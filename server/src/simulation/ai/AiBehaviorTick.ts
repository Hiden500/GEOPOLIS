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
  AUSTERITY_RESTORE,
  AUSTERITY_RECOVERY_SURPLUS_MARGIN,
  AUSTERITY_RECOVERY_DEBT_CEILING,
  THREAT_LEVEL,
  MILITARY_RAMP,
  MILITARY_CAP_SHARE,
  COALITION_STEP,
  INFLUENCE_GRAVITY,
  STABILITY_LOW,
  STABILITY_RECOVERED,
  WELFARE_SHIFT_RATE,
  WELFARE_CAP_SHARE,
} from "@shared/defines/ai";
import { DEBT_GDP_PENALTY_THRESHOLD } from "@shared/defines/economy";

/**
 * Детерминированное поведение ИИ-стран (без полноценного utility-AI).
 * Реализует доступное подмножество P2 (см. docs/DECISIONS.md, 2026-06-23):
 *  - Правило A: аустерити по дефициту и обратное восстановление долей при
 *    профиците (двусторонним стало 2026-08-02).
 *  - Правило B: ответ на угрозу с полной балансировкой (военный ответ +
 *    контр-блок соперников + power→influence→сфера для бандвагонинга).
 *  - Правило C: при низкой stability сдвиг расходов с military → welfare и
 *    возврат обратно, когда кризис позади (двусторонним стало 2026-08-01).
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
 * Правило A — аустерити В ОБЕ СТОРОНЫ (обратный ход добавлен 2026-08-02).
 *
 * Урезание: при дефиците И высокой долговой нагрузке (долг/ВВП выше
 * DEBT_GDP_PENALTY_THRESHOLD) ИИ-страна режет дискреционные расходы на
 * 5%/тик, но не ниже снимка пола (50% старта). Долг вместо казны как триггер
 * (docs/plans/08_WAR_WAVE1.md, Шаг 4): с конвертацией дефицита в долг казна
 * больше не уходит в минус (пол 0), поэтому прежний триггер `treasury < 0`
 * стал бы мёртвым. Порог совпадает с началом штрафа росту ВВП: ИИ затягивает
 * пояс ровно тогда, когда долг начинает вредить.
 *
 * Восстановление: при профиците С ЗАПАСОМ (budgetBalance ≥
 * AUSTERITY_RECOVERY_SURPLUS_MARGIN × доход) И долге, погашенном ниже
 * AUSTERITY_RECOVERY_DEBT_CEILING (четверть порога урезания — вторая ось
 * гистерезиса, отвечает за скорость расчистки долгов), доли поднимаются на
 * AUSTERITY_RESTORE к потолку — стартовой доле.
 *
 * ПОЧЕМУ ОБРАТНЫЙ ХОД ПОЯВИЛСЯ. До него правило было односторонним
 * храповиком: выход из дефицита лишь останавливал урезание, и срезанные доли
 * оставались навсегда. Замер 120 месяцев живого 1946 (2026-08-01,
 * probeStabilityRule): у всех 16 стран, вышедших из кризиса stability, welfare
 * был ниже стартовой доли — из-за этого возврат Правила C не сработал НИ РАЗУ
 * (отдавать welfare→military было нечего), а education (его Правило C не
 * трогает) застревал на 0,74…0,77 старта до конца партии.
 *
 * Запас профицита — гистерезис: восстановление расходов само толкает бюджет
 * обратно к дефициту, и без запаса правило осциллирует cut/restore (замер — в
 * комментарии к AUSTERITY_RECOVERY_SURPLUS_MARGIN). Мутации — через
 * commands/economy.ts.
 */
function applyDeficitAusterity(game: GameState, c: Country): void {
  const e = c.economy;
  if (!e.spendingFloor || !e.spendingShares) return;
  const debtBurden = e.gdp > 0 ? e.debt / e.gdp : 0;

  if (e.budgetBalance < 0) {
    if (debtBurden > DEBT_GDP_PENALTY_THRESHOLD) {
      economyCommands.applyDeficitAusterityCut(game, c.id, AUSTERITY_CUT, DISCRETIONARY);
    }
    return;
  }

  if (debtBurden > AUSTERITY_RECOVERY_DEBT_CEILING) return;
  const income = totalIncome(c);
  if (income <= 0 || e.budgetBalance < AUSTERITY_RECOVERY_SURPLUS_MARGIN * income) return;

  economyCommands.applyAusterityRecoveryRaise(game, c.id, AUSTERITY_RESTORE, DISCRETIONARY);
}

/**
 * Правило C — бюджет следует за кризисом В ОБЕ СТОРОНЫ. При низкой stability
 * (< `STABILITY_LOW`) расходы идут military → welfare; когда кризис позади
 * (≥ `STABILITY_RECOVERED`) — доля возвращается обратно. Между порогами
 * гистерезисная зона, в ней не двигают ничего.
 *
 * ПОЧЕМУ ВОЗВРАТ ПОЯВИЛСЯ (2026-08-01). Правило было односторонним храповиком:
 * замер на 120 месяцах живого 1946 показал, что за первые пять месяцев кризиса
 * страна вычерпывает весь запас (military с 20% дохода до пола 10%, welfare с
 * 22% до потолка 30%) — и остаётся так навсегда, даже полностью восстановившись.
 * К десятому году доля military просела ниже стартовой у 82 стран из 156, и
 * сдвинуть бюджет в ответ на НОВЫЙ кризис реально могли 0 стран из 48 задетых
 * порогом. Реакция, которая срабатывает один раз за партию и не отпускает, —
 * это не реакция, а разовое смещение мира к welfare.
 *
 * ГРАНИЦЫ ВОЗВРАТА — стартовые доли обеих статей, и они же гарантируют, что
 * возврат отменяет ровно СВОЙ сдвиг и ничего сверх него:
 *  - military не поднимается выше стартовой доли (= пол × 2), поэтому возврат
 *    не подменяет собой Правило B (военный ramp угрожаемой страны) и не спорит
 *    с ним: у страны, которую Правило B уже подняло выше старта, возврат — ноль;
 *  - welfare не опускается ниже стартовой доли, поэтому возврат не отыгрывает
 *    назад урезание Правила A (аустерити режет ВСЕ статьи, включая welfare;
 *    его отменяет собственный обратный ход Правила A, 2026-08-02).
 *
 * Stability читается через effectiveValue() (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 2), не сырое поле — единственный переведённый читатель в этом заходе,
 * демонстрирует реальную интеграцию модификаторов.
 */
function applyStabilityBudgetShift(game: GameState, c: Country): void {
  const { spendingFloor: floor, spendingShares: shares } = c.economy;
  if (!floor || !shares) return;

  const stability = effectiveValue(
    c.politics.stability,
    ModifierAttribute.Stability,
    { kind: "country", id: c.id },
    game.modifiers
  );

  // Кризис: все три ограничителя — доли дохода, поэтому сам доход не нужен.
  if (stability < STABILITY_LOW) {
    const shift = Math.min(
      WELFARE_SHIFT_RATE,
      WELFARE_CAP_SHARE - shares.welfare,
      shares.military - floor.militarySpending
    );
    if (shift > 0) economyCommands.shiftMilitaryToWelfare(game, c.id, shift);
    return;
  }

  // Гистерезисная зона между порогами — бюджет замер там, где его застал выход
  // из кризиса.
  if (stability < STABILITY_RECOVERED) return;

  // Кризис позади. Пол аустерити — половина стартовой доли, значит старт = пол × 2.
  const back = Math.min(
    WELFARE_SHIFT_RATE,
    floor.militarySpending * 2 - shares.military,
    shares.welfare - floor.welfareSpending * 2
  );
  if (back > 0) economyCommands.shiftWelfareToMilitary(game, c.id, back);
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
      // В ДОЛЯХ доход сокращается: кап и ramp выражаются прямо через них
      // (2026-08-01). Раньше и кап, и ramp считались от суммы, а сумма у ИИ
      // не следовала за доходом — поэтому «военный ответ» слабел с каждым
      // годом, хотя страна богатела.
      const share = c.economy.spendingShares?.military ?? 0;
      if (share < MILITARY_CAP_SHARE) {
        economyCommands.setMilitaryShare(game, c.id, Math.min(share * MILITARY_RAMP, MILITARY_CAP_SHARE));
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
    applyStabilityBudgetShift(game, c);
  }

  if (player) {
    applyThreatResponse(game, player, aiCountries);
  }
}
