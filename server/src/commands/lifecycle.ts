import { type GameState } from "@shared/types/GameState";
import { type CommandResult } from "./types";

/**
 * Команды жизненного цикла государств — та часть раскола/объединения, которая
 * ПИШЕТ в экономику и армию страны (docs/plans/03_MODIFIERS_COMMANDS.md,
 * правило «мутации через команды»).
 *
 * Почему отдельным файлом, а не прямой записью в `polityLifecycle.ts`. Движок
 * примитивов входит в периметр правила наравне с `LLMService` и
 * `AiBehaviorTick`: он применяет намерения LLM и игрока, и запись в
 * `.economy.*` / `.military.*` мимо команд делает невидимой для всех
 * потребителей ту самую точку, где деньги и живая сила меняются. Fitness-тест
 * (`server/src/__tests__/architecture.test.ts`) это правило и держит.
 */

/**
 * Делимое имущество страны — ровно те величины, которые раскол обязан
 * СОХРАНИТЬ в сумме (docs/CONCEPT.md §7.1: «суммы населения, казны, живой силы
 * и числа регионов сходятся»).
 *
 * Население и ВВП сюда НЕ входят: они выводятся из регионов
 * (`aggregateCountryFromRegions`) и второго источника истины иметь не должны —
 * иначе «сумма сошлась» означало бы согласие двух записей друг с другом, а не
 * с миром.
 */
export interface DivisibleAssets {
  treasury: number;
  manpower: number;
  activePersonnel: number;
  reservePersonnel: number;
}

/** Текущее делимое имущество — читается там же, где пишется. */
export function readDivisibleAssets(
  game: GameState,
  countryId: string
): DivisibleAssets | undefined {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return undefined;
  return {
    treasury: country.economy.treasury,
    manpower: country.military.manpower,
    activePersonnel: country.military.activePersonnel,
    reservePersonnel: country.military.reservePersonnel,
  };
}

/**
 * Выставляет делимое имущество страны абсолютным значением, а не дельтой.
 *
 * Абсолютом намеренно: доли считаются целочисленным делением с точным
 * сохранением суммы (`splitAmount`), и превращать их в дельты значило бы
 * ввести второй способ ошибиться на копейку там, где §7.1 требует ТОЧНОГО
 * схождения сумм.
 */
export function setDivisibleAssets(
  game: GameState,
  countryId: string,
  assets: DivisibleAssets
): CommandResult {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };

  for (const [field, value] of Object.entries(assets)) {
    if (!Number.isFinite(value) || value < 0) {
      return { success: false, error: `${field} must be a non-negative number, got ${value}` };
    }
  }

  country.economy.treasury = assets.treasury;
  country.military.manpower = assets.manpower;
  country.military.activePersonnel = assets.activePersonnel;
  country.military.reservePersonnel = assets.reservePersonnel;
  return { success: true };
}
