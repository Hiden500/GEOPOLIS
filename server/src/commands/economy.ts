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
