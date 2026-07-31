import { type GameState } from "@shared/types/GameState";
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
  if (!economy.spendingFloor) return { success: true };

  for (const key of keys) {
    economy[key] = Math.max(economy[key] * cutRate, economy.spendingFloor[key]);
  }
  return { success: true };
}

/**
 * Точная обёртка формулы AiBehaviorTick Правило B (военный ramp угрожаемого
 * соперника, капнутый долей дохода) — абсолютный сеттер, кап и скорость
 * ramp'а по-прежнему считает вызывающий.
 */
export function setMilitarySpending(game: GameState, countryId: string, value: number): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  country.economy.militarySpending = value;
  return { success: true };
}

/**
 * Точная обёртка формулы AiBehaviorTick Правило C (низкая stability →
 * military→welfare): сдвигает ровно `amount` между двумя статьями. Расчёт
 * величины сдвига (капы, пол) остаётся у вызывающего.
 */
export function shiftMilitaryToWelfare(game: GameState, countryId: string, amount: number): CommandResult {
  const country = findCountry(game, countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  country.economy.militarySpending -= amount;
  country.economy.welfareSpending += amount;
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
