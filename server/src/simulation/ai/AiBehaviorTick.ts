import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { calculateBaseInfluence } from "../diplomacy/DiplomacyTick";

/**
 * Детерминированное поведение ИИ-стран (без полноценного utility-AI).
 * Реализует доступное подмножество P2 (см. docs/DECISIONS.md, 2026-06-23):
 *  - Правило A: аустерити по дефициту.
 *  - Правило B: ответ на угрозу с полной балансировкой (военный ответ +
 *    контр-блок соперников + power→influence→сфера для бандвагонинга).
 *
 * Применяется только к ИИ-странам (id !== playerCountryId). Войну и динамику
 * политики не трогает — их в движке пока нет (отложено в P3).
 */

const AUSTERITY_CUT = 0.95; // −5% дискреционных расходов за тик при дефиците
const THREAT_LEVEL = 50; // порог доминирования игрока (calculateBaseInfluence), ~×2.5
const MILITARY_RAMP = 1.05; // +5% military за тик у угрожаемых соперников
const MILITARY_CAP_SHARE = 0.4; // потолок military как доля дохода
const COALITION_STEP = 5; // +отношение/тик между со-угрожаемыми соперниками
const INFLUENCE_GRAVITY = 0.1; // скорость роста влияния игрока (бандвагонинг)

type SpendKey =
  | "militarySpending"
  | "researchSpending"
  | "educationSpending"
  | "infrastructureSpending"
  | "welfareSpending";

const DISCRETIONARY: SpendKey[] = [
  "militarySpending",
  "researchSpending",
  "educationSpending",
  "infrastructureSpending",
  "welfareSpending",
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function totalIncome(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/**
 * Правило A — аустерити: при дефиците И отрицательной казне ИИ-страна урезает
 * дискреционные расходы на 5%/тик, но не ниже снимка пола (50% старта).
 * Само-останавливается, когда бюджет выходит из дефицита (следующий EconomyTick
 * пересчитает budgetBalance ≥ 0).
 */
function applyDeficitAusterity(c: Country): void {
  const e = c.economy;
  if (e.budgetBalance >= 0 || e.treasury >= 0 || !e.spendingFloor) return;

  for (const key of DISCRETIONARY) {
    e[key] = Math.max(e[key] * AUSTERITY_CUT, e.spendingFloor[key]);
  }
}

/**
 * Правило B — ответ на угрозу с балансировкой/бандвагонингом.
 */
function applyThreatResponse(player: Country, aiCountries: Country[]): void {
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
        c.economy.militarySpending = Math.min(c.economy.militarySpending * MILITARY_RAMP, cap);
      }

      for (const other of threatened) {
        if (other.id === c.id) continue;
        const otherRelToPlayer = other.diplomacy.relations[player.id] ?? 0;
        if (otherRelToPlayer < 0) {
          const current = c.diplomacy.relations[other.id] ?? 0;
          c.diplomacy.relations[other.id] = clamp(current + COALITION_STEP, -100, 100);
        }
      }
      // Сопротивление влиянию: влияние игрока над c не растёт (no-op).
    } else {
      // Бандвагонинг — страна терпит игрока: его влияние над ней растёт к dom,
      // при влиянии > 50 она входит в сферу игрока (порог в DiplomacyTick).
      const current = player.diplomacy.influence[c.id] ?? 0;
      const target = dom.get(c.id) ?? 0;
      player.diplomacy.influence[c.id] = clamp(current + (target - current) * INFLUENCE_GRAVITY, 0, 100);
    }
  }
}

export function aiBehaviorTick(game: GameState): void {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  const aiCountries = game.countries.filter(c => c.id !== game.playerCountryId);

  for (const c of aiCountries) {
    applyDeficitAusterity(c);
  }

  if (player) {
    applyThreatResponse(player, aiCountries);
  }
}
