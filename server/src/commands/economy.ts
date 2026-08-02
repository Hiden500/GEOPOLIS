import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type EquipmentType } from "@shared/types/military/EquipmentType";
import { type UpdateBudgetInput } from "../validation/schemas";
import { ResearchService } from "../services/ResearchService";
import { MilitaryService } from "../services/MilitaryService";
import { CountryService } from "../services/CountryService";
import { type CommandResult } from "./types";

const researchService = new ResearchService();
const militaryService = new MilitaryService();
const countryService = new CountryService();

/** Расходные статьи бюджета, которыми управляет AiBehaviorTick (аустерити/nudge). */
export type SpendKey =
  | "militarySpending"
  | "researchSpending"
  | "educationSpending"
  | "infrastructureSpending"
  | "welfareSpending";

function findCountry(game: GameState, countryId: string) {
  return game.countries.find(c => c.id === countryId);
}

/** Обёртка ResearchService.setAllocation — используется LLM-действием "research_shift". */
export function setResearchAllocation(game: GameState, countryId: string, domain: string, share: number): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  try {
    researchService.setAllocation(country, domain, share);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Обёртка MilitaryService.setProductionAllocation — используется LLM-действием "production_shift". */
export function setProductionAllocation(
  game: GameState,
  countryId: string,
  equipmentType: EquipmentType,
  share: number
): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  try {
    militaryService.setProductionAllocation(country, equipmentType, share);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Обёртка CountryService.updateBudget — используется роутом budget.ts вместо прямого вызова сервиса. */
export function setBudgetShares(game: GameState, countryId: string, budgetUpdate: UpdateBudgetInput): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  countryService.updateBudget(country, budgetUpdate);
  return { success: true };
}

/**
 * Точная обёртка формулы AiBehaviorTick Правило A (аустерити по дефициту):
 * урезает перечисленные дискреционные статьи на `cutRate`, не ниже пола
 * `economy.spendingFloor`. Проверку "нужно ли вообще резать" (дефицит И
 * отрицательная казна) по-прежнему делает вызывающий — команда только
 * выполняет саму мутацию.
 */
export function applyDeficitAusterityCut(
  game: GameState,
  countryId: string,
  cutRate: number,
  keys: SpendKey[]
): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  const { economy } = country;
  if (!economy.spendingFloor || !economy.spendingShares) return { success: true };

  // Режется ДОЛЯ, а не сумма (2026-08-01). Абсолютное урезание стиралось бы
  // следующим `economyTick`, который пересчитывает суммы из долей; до перевода
  // расходов ИИ на доли этой проблемы не было, потому что и пересчёта не было.
  for (const key of keys) {
    const share = SHARE_KEY[key];
    economy.spendingShares[share] = Math.max(
      economy.spendingShares[share] * cutRate,
      economy.spendingFloor[key]
    );
    // Сумма приводится сразу же: следующий тик всё равно её пересчитает, но
    // между командой и тиком состояние обязано быть согласованным — иначе
    // читатель внутри того же хода увидит долю и сумму, говорящие разное.
    economy[key] = totalIncomeOf(country) * economy.spendingShares[share];
  }
  return { success: true };
}

/**
 * Обратный ход Правила A (2026-08-02): поднимает перечисленные дискреционные
 * доли на `raiseRate`, но не выше стартовой доли (= spendingFloor × 2 — пол
 * аустерити есть половина старта, см. CreateGame.ts). Долю, стоящую ВЫШЕ
 * старта (military после ramp'а Правила B, welfare после сдвига Правила C),
 * не трогает вовсе: восстановление отменяет только урезание аустерити, а не
 * чужие сдвиги, и уж точно ничего не режет. Условия «пора ли восстанавливать»
 * (профицит с запасом, долг ниже порога) — у вызывающего.
 */
export function applyAusterityRecoveryRaise(
  game: GameState,
  countryId: string,
  raiseRate: number,
  keys: SpendKey[]
): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  const { economy } = country;
  if (!economy.spendingFloor || !economy.spendingShares) return { success: true };

  for (const key of keys) {
    const share = SHARE_KEY[key];
    const startShare = economy.spendingFloor[key] * 2;
    if (economy.spendingShares[share] >= startShare) continue;
    economy.spendingShares[share] = Math.min(
      economy.spendingShares[share] * raiseRate,
      startShare
    );
    // Сумма приводится сразу — как у урезания выше: между командой и следующим
    // тиком доля и сумма обязаны говорить одно и то же.
    economy[key] = totalIncomeOf(country) * economy.spendingShares[share];
  }
  return { success: true };
}

/** Соответствие абсолютной статьи расходов и её доли в доходе. */
const SHARE_KEY = {
  militarySpending: "military",
  researchSpending: "research",
  educationSpending: "education",
  infrastructureSpending: "infrastructure",
  welfareSpending: "welfare",
} as const satisfies Record<SpendKey, keyof NonNullable<Country["economy"]["spendingShares"]>>;

/** Доход, от которого считаются доли, — тот же набор слагаемых, что в EconomyTick. */
function totalIncomeOf(country: Country): number {
  const e = country.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

/**
 * Точная обёртка формулы AiBehaviorTick Правило B (военный ramp угрожаемого
 * соперника): задаёт ДОЛЮ дохода и сразу приводит сумму. Кап и скорость ramp'а
 * по-прежнему считает вызывающий.
 */
export function setMilitaryShare(game: GameState, countryId: string, share: number): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };
  const { economy } = country;
  if (!economy.spendingShares) return { success: true };

  economy.spendingShares.military = Math.max(0, share);
  economy.militarySpending = totalIncomeOf(country) * economy.spendingShares.military;
  return { success: true };
}

/**
 * Точная обёртка формулы AiBehaviorTick Правило C (низкая stability →
 * military→welfare): сдвигает ровно `amount` между двумя статьями. Расчёт
 * величины сдвига (капы, пол) остаётся у вызывающего.
 */
export function shiftMilitaryToWelfare(game: GameState, countryId: string, shift: number): CommandResult {
  return moveShare(game, countryId, "military", "welfare", shift);
}

/**
 * Обратный ход Правила C: кризис позади — доля возвращается welfare → military
 * (2026-08-01). Отдельная команда, а не отрицательный `shift` у соседки: имя
 * команды — это запись о том, ЧТО сделала страна, и «сдвиг military→welfare на
 * минус два процента» такой записью не является. Границы возврата (стартовая
 * доля military сверху, стартовая доля welfare снизу) считает вызывающий.
 */
export function shiftWelfareToMilitary(game: GameState, countryId: string, shift: number): CommandResult {
  return moveShare(game, countryId, "welfare", "military", shift);
}

/**
 * Общий механизм обоих сдвигов: переносит `shift` доли дохода между статьями и
 * тут же приводит суммы. Сдвигается ДОЛЯ, а не сумма — иначе следующий
 * `economyTick`, пересчитывающий суммы из долей, стёр бы перенос.
 */
function moveShare(
  game: GameState,
  countryId: string,
  from: "military" | "welfare",
  to: "military" | "welfare",
  shift: number
): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };
  const { economy } = country;
  if (!economy.spendingShares) return { success: true };

  economy.spendingShares[from] -= shift;
  economy.spendingShares[to] += shift;

  const income = totalIncomeOf(country);
  economy.militarySpending = income * economy.spendingShares.military;
  economy.welfareSpending = income * economy.spendingShares.welfare;
  return { success: true };
}

// --------------------------------------------------------------------------
// Денежные каналы мягких глаголов алфавита (docs/PRIMITIVES.md §2, Милстоун 1)
// --------------------------------------------------------------------------

/**
 * Переводит деньги из казны одной страны в казну другой — используется
 * примитивами `send_aid` и `support_proxy`.
 *
 * `applied` — ФАКТИЧЕСКИ переведённая сумма, а не запрошенная: донор не может
 * отдать больше, чем у него есть, и вызывающий обязан отчитываться этим числом.
 * Без клампа помощь уводила бы казну в минус, откуда `EconomyTick` делает долг,
 * — то есть примитив тихо занимал бы деньги от имени страны.
 *
 * Отрицательная сумма отклоняется, а не разворачивает перевод: «помощь на
 * минус десять» — это изъятие, у него другой глагол и другая цена.
 */
export function transferTreasury(
  game: GameState,
  fromId: string,
  toId: string,
  amount: number
): CommandResult<number> {
  const from = findCountry(game, fromId);
  if (!from) return { success: false, error: `Unknown country: ${fromId}` };
  const to = findCountry(game, toId);
  if (!to) return { success: false, error: `Unknown country: ${toId}` };
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, error: `Treasury transfer must be a non-negative number: ${amount}` };
  }

  const moved = Math.min(amount, Math.max(0, from.economy.treasury));
  from.economy.treasury -= moved;
  to.economy.treasury += moved;
  return { success: true, applied: moved };
}

/**
 * Списывает деньги из казны страны безвозвратно — используется примитивом
 * `capital_flight` (капитал уходит из мира игры, а не другому государству).
 *
 * `applied` — фактически списанное: клампится тем, что в казне есть.
 */
export function drainTreasury(
  game: GameState,
  countryId: string,
  amount: number
): CommandResult<number> {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, error: `Treasury drain must be a non-negative number: ${amount}` };
  }

  const drained = Math.min(amount, Math.max(0, country.economy.treasury));
  country.economy.treasury -= drained;
  return { success: true, applied: drained };
}

/**
 * Уменьшает ВВП РЕГИОНА на долю — используется примитивом `capital_flight`.
 *
 * Регион, а не страна: `country.economy.gdp` — агрегат, который
 * `aggregateAllCountries` перезаписывает из регионов каждый тик, поэтому удар,
 * записанный туда, исчезал бы к следующему месяцу. `region.gdp` живёт, и
 * `EconomyTick` растит его мультипликативно от текущего значения — то есть
 * отток уменьшает базу будущего роста, а не отыгрывается за месяц.
 *
 * `applied` — фактически выведенная сумма.
 */
export function drainRegionGdp(
  game: GameState,
  regionId: number,
  share: number
): CommandResult<number> {
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };
  if (!Number.isFinite(share) || share < 0 || share > 1) {
    return { success: false, error: `Capital flight share must be within 0..1: ${share}` };
  }

  const drained = Math.max(0, region.gdp) * share;
  region.gdp -= drained;
  return { success: true, applied: drained };
}
