import { type GameState } from "@shared/types/GameState";
import {
  type SovereigntyStatus,
  SOVEREIGN_STATUS,
} from "@shared/types/politics/Government";
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

/**
 * Записывает подчинение одного государства другому — ОБА представления
 * зависимости за один вызов (docs/DIPLOMACY.md).
 *
 * Почему одна команда, а не две. `diplomacy.puppets` (рантайм-отношение) и
 * `politics.sovereigntyStatus`/`overlordIds` (юридическое положение) — не
 * дубль, но и противоречить друг другу не вправе: марионетка не бывает
 * юридически суверенной, её сюзерен обязан входить в `overlordIds`. Пока
 * записи делались порознь, инвариант держал только слой данных; команда,
 * пишущая обе половины сразу, делает разрыв невыразимым в коде, а не
 * запрещённым на словах.
 *
 * СМЫСЛ решения (кого можно подчинять, чем это обеспечено, какой статус
 * получает суверенный субъект) живёт в `primitives/subordination.ts`. Здесь —
 * только запись: команда не решает, законно ли подчинение, ровно как
 * `setDivisibleAssets` не решает, законен ли раскол.
 *
 * Идемпотентна: повторный вызов по существующей паре ничего не меняет и
 * успешен. `statusIfSovereign` применяется ТОЛЬКО к суверенному субъекту —
 * государство, уже несуверенное по другому поводу (колония, зона оккупации),
 * сохраняет свой статус, потому что тот точнее описывает природу подчинения.
 */
export function setSubordination(
  game: GameState,
  overlordId: string,
  vassalId: string,
  statusIfSovereign: SovereigntyStatus
): CommandResult {
  const overlord = game.countries.find(c => c.id === overlordId);
  const vassal = game.countries.find(c => c.id === vassalId);
  if (!overlord) return { success: false, error: `Unknown country: ${overlordId}` };
  if (!vassal) return { success: false, error: `Unknown country: ${vassalId}` };
  if (overlord.id === vassal.id) {
    return { success: false, error: `A country cannot be its own overlord: ${overlordId}` };
  }

  if (!overlord.diplomacy.puppets.includes(vassal.id)) {
    overlord.diplomacy.puppets = [...overlord.diplomacy.puppets, vassal.id];
  }
  const overlords = vassal.politics.overlordIds ?? [];
  if (!overlords.includes(overlord.id)) {
    vassal.politics.overlordIds = [...overlords, overlord.id];
  }
  if ((vassal.politics.sovereigntyStatus ?? SOVEREIGN_STATUS) === SOVEREIGN_STATUS) {
    vassal.politics.sovereigntyStatus = statusIfSovereign;
  }
  return { success: true };
}
