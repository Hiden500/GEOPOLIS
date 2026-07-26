import { type GameState } from "@shared/types/GameState";
import { type GroupImpactMemory } from "@shared/types/politics/Demographics";
import { IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX } from "@shared/types/politics/Ideology";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { type CommandResult } from "./types";

/**
 * Команды политического слоя (docs/plans/03_MODIFIERS_COMMANDS.md, правило 2:
 * мутации состояния — только здесь, не в вызывающем коде). Ими пользуется
 * движок примитивов (server/src/primitives/), а в будущем — LLM-путь и роуты
 * игрока.
 *
 * Каждая команда возвращает CommandResult и НЕ бросает исключений: вызывающий
 * обязан проверить результат. Разрыв «применил и не посмотрел на результат»,
 * который есть в существующих apply*Action (LLMService.ts), сюда не наследуется —
 * PrimitiveEngine валит примитив целиком, если команда вернула success: false.
 */

/** Виды следа в памяти воздействий — те же поля, что у GroupImpactMemory. */
export type ImpactField = "suppression" | "alienation" | "concession" | "emboldenment";

const IMPACT_MIN = 0;
const IMPACT_MAX = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Прибавляет след воздействия к паре (регион, группа), создавая запись памяти
 * при первом касании. Все поля клампятся в 0..1: примитив не может накачать
 * отчуждение выше потолка повторными вызовами.
 *
 * Требует, чтобы группа реально жила в этом регионе — иначе движок молча
 * копил бы память для несуществующего населения.
 */
export function addGroupImpact(
  game: GameState,
  regionId: number,
  groupId: string,
  deltas: Partial<Record<ImpactField, number>>
): CommandResult {
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return { success: false, error: `Unknown region: ${regionId}` };

  if (!region.demographics?.some(d => d.groupId === groupId)) {
    return { success: false, error: `Group ${groupId} does not live in region ${regionId}` };
  }

  let memory = game.groupImpactMemory.find(m => m.regionId === regionId && m.groupId === groupId);
  if (!memory) {
    memory = {
      regionId,
      groupId,
      suppression: 0,
      alienation: 0,
      concession: 0,
      emboldenment: 0,
    } satisfies GroupImpactMemory;
    game.groupImpactMemory.push(memory);
  }

  for (const [field, delta] of Object.entries(deltas) as [ImpactField, number][]) {
    memory[field] = clamp(memory[field] + delta, IMPACT_MIN, IMPACT_MAX);
  }

  return { success: true };
}

/**
 * Сдвигает координаты идеологии страны (docs/CONCEPT.md §4.2 — «плавный дрейф»,
 * без скачков «ярлык А → ярлык Б»). Страна без явных координат получает их из
 * фолбэка по ярлыку: сдвиг обязан стартовать с той же точки, которую движок
 * уже использовал в расчёте недовольства, иначе реформа дала бы разрыв.
 * Ярлык `politics.ideology` при этом не переписывается — зоны спектра поверх
 * координат вводятся отдельно, вне этого среза.
 */
export function shiftCountryIdeology(
  game: GameState,
  countryId: string,
  deltaEconomic: number,
  deltaPolitical: number
): CommandResult {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  const current = resolveIdeologyCoordinates(country.politics);
  country.politics.ideologyCoordinates = {
    economic: clamp(current.economic + deltaEconomic, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX),
    political: clamp(current.political + deltaPolitical, IDEOLOGY_AXIS_MIN, IDEOLOGY_AXIS_MAX),
  };

  return { success: true };
}

const GOVERNMENT_SUPPORT_MIN = 0;
const GOVERNMENT_SUPPORT_MAX = 100;

/**
 * Списывает политическую цену с поддержки правительства (шкала 0..100, как и
 * остальная политика страны). Отказывает, если платить нечем — цена реформы
 * должна быть настоящей, а не уходить в минус с клампом.
 */
export function spendGovernmentSupport(
  game: GameState,
  countryId: string,
  amount: number
): CommandResult {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  if (country.politics.governmentSupport < amount) {
    return {
      success: false,
      error: `Not enough government support: need ${amount}, have ${country.politics.governmentSupport.toFixed(1)}`,
    };
  }

  country.politics.governmentSupport = clamp(
    country.politics.governmentSupport - amount,
    GOVERNMENT_SUPPORT_MIN,
    GOVERNMENT_SUPPORT_MAX
  );

  return { success: true };
}
