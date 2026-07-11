import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { calculateBaseInfluence } from "../diplomacy/DiplomacyTick";
import * as diplomacyCommands from "../../commands/diplomacy";
import * as warCommands from "../../commands/war";
import * as economyCommands from "../../commands/economy";
import { type SpendKey } from "../../commands/economy";

/**
 * Детерминированное поведение ИИ-стран (без полноценного utility-AI).
 * Реализует доступное подмножество P2 (см. docs/DECISIONS.md, 2026-06-23):
 *  - Правило A: аустерити по дефициту.
 *  - Правило B: ответ на угрозу с полной балансировкой (военный ответ +
 *    контр-блок соперников + power→influence→сфера для бандвагонинга).
 *  - Правило C: при низкой stability сдвиг расходов с military → welfare.
 *  - Правило D (docs/WAR.md, 2026-07-06): порог объявления войны для
 *    non-major стран — топ-державы объявляют войну только через LLM
 *    (решение A), это правило их не трогает.
 *
 * Применяется только к ИИ-странам (id !== playerCountryId).
 */

const AUSTERITY_CUT = 0.95;        // −5% дискреционных расходов за тик при дефиците
const THREAT_LEVEL = 50;           // порог доминирования игрока (calculateBaseInfluence), ~×2.5
const MILITARY_RAMP = 1.05;        // +5% military за тик у угрожаемых соперников
const MILITARY_CAP_SHARE = 0.4;    // потолок military как доля дохода
const COALITION_STEP = 5;          // +отношение/тик между со-угрожаемыми соперниками
const INFLUENCE_GRAVITY = 0.1;     // скорость роста влияния игрока (бандвагонинг)
const STABILITY_LOW = 40;          // порог "низкой" stability для Правила C
const WELFARE_SHIFT_RATE = 0.02;   // доля дохода, переводимая military→welfare за тик
const WELFARE_CAP_SHARE = 0.30;    // потолок welfare как доля дохода
const WAR_RELATION_THRESHOLD = -80; // порог отношений для Правила D — почти дно шкалы, войны редки

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
 * Правило A — аустерити: при дефиците И отрицательной казне ИИ-страна урезает
 * дискреционные расходы на 5%/тик, но не ниже снимка пола (50% старта).
 * Само-останавливается, когда бюджет выходит из дефицита (следующий EconomyTick
 * пересчитает budgetBalance ≥ 0). Мутация — через commands/economy.ts
 * (docs/plans/03_MODIFIERS_COMMANDS.md): AiBehaviorTick решает, нужно ли
 * резать, команда выполняет саму мутацию.
 */
function applyDeficitAusterity(game: GameState, c: Country): void {
  const e = c.economy;
  if (e.budgetBalance >= 0 || e.treasury >= 0 || !e.spendingFloor) return;

  economyCommands.applyDeficitAusterityCut(game, c.id, AUSTERITY_CUT, DISCRETIONARY);
}

/**
 * Правило C — при низкой stability (< 40) переносит расходы с military → welfare.
 * Не опускает military ниже пола; не поднимает welfare выше 30% дохода.
 */
function applyStabilityWelfareNudge(game: GameState, c: Country): void {
  if (c.politics.stability >= STABILITY_LOW || !c.economy.spendingFloor) return;

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
 * Правило D — порог объявления войны для non-major (топ-державы — только
 * через LLM, см. docs/WAR.md решение A). Соперник (`rivals`) с отношениями
 * ниже почти-дна шкалы И при манпауэр-перевесе инициатора ("нет другого
 * выхода", черновик docs/WAR.md) — объявляется война. `WarService.declareWar`
 * идемпотентен (не дублирует уже идущую войну), доп. проверка не нужна.
 */
function applyWarThreshold(game: GameState, aiCountries: Country[]): void {
  const nonMajor = aiCountries.filter(c => c.tier !== "major");

  for (const c of nonMajor) {
    for (const rivalId of c.diplomacy.rivals) {
      const rival = nonMajor.find(r => r.id === rivalId);
      if (!rival) continue; // major-тир соперник — войну решает только LLM

      const relation = c.diplomacy.relations[rivalId] ?? 0;
      if (relation > WAR_RELATION_THRESHOLD) continue;
      if (c.military.activePersonnel <= rival.military.activePersonnel) continue;

      warCommands.declareWar(game, c.id, rivalId);
    }
  }
}

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

  applyWarThreshold(game, aiCountries);
}
