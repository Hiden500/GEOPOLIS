import { type GameState } from "@shared/types/GameState";
import { type CommandResult } from "./types";

/**
 * Военные команды (docs/plans/03_MODIFIERS_COMMANDS.md, правило «мутации через
 * команды»).
 *
 * Отдельный файл, а не ветка в `economy.ts`: деньги и живая сила — разные
 * домены, и `support_proxy` трогает оба именно потому, что это два эффекта
 * одного акта, а не конверсия одного в другое.
 */

/**
 * Добавляет стране живую силу — используется примитивом `support_proxy`.
 *
 * `activePersonnel`, а не `armyStrength`: первое — единственное военное число,
 * которое реально читает бой (`simulation/war/WarTick.ts::sideStrength`),
 * второе остаётся статичным нулём во всех сгенерированных странах и на исход
 * не влияет никак. Подкрепление, положенное в мёртвое поле, было бы примитивом
 * без последствий.
 *
 * Число округляется вниз: людей не бывает дробное количество, а `WarTick`
 * вычитает из этого же поля потери целыми.
 *
 * `applied` — фактически добавленное после округления.
 */
export function reinforcePersonnel(
  game: GameState,
  countryId: string,
  amount: number
): CommandResult<number> {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return { success: false, error: `Unknown country: ${countryId}` };
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, error: `Reinforcement must be a non-negative number: ${amount}` };
  }

  const added = Math.floor(amount);
  country.military.activePersonnel += added;
  return { success: true, applied: added };
}
