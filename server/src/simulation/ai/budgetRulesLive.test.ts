import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { type Country } from "@shared/types/Country";

/**
 * БЮДЖЕТ ИИ НА ЖИВЫХ ДАННЫХ, А НЕ НА ФИКСТУРЕ.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Тесты `AiBehaviorTick.test.ts` работают на фикстуре и
 * доказывают, что функция считает. Они были зелёными и тогда, когда расходы
 * ИИ фактически вырождались: суммы хранились абсолютными, а доход рос, поэтому
 * стартовая роспись обесценивалась сама собой. Замер 2026-08-01 ДО перевода
 * расходов на доли дохода: медиана военных расходов падала до 6,95% дохода,
 * медианный профицит достигал 13,3% ВВП — деньги копились, потому что тратить
 * их было нечем.
 *
 * Здесь закреплены оба свойства. Числа порогов широкие: проверяется, что
 * роспись живёт, а не какой она сегодня по калибровке.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Правило C (низкая stability → сдвиг к welfare) переводом на
 * доли НЕ починено: замер того же дня даёт 1 → 0 → 0 стран, реально способных
 * сдвинуть бюджет на 12, 60 и 120-м месяце, при 81 → 68 → 48 задетых порогом.
 * Причина — односторонний храповик: правило тащит military к полу и никогда не
 * возвращает обратно, поэтому донор кончается. Открытый дефект в `docs/TODO.md`;
 * тест на него появится вместе с правкой, а не раньше.
 */

function income(c: Country): number {
  const e = c.economy;
  return e.taxRevenue + e.exportIncome + e.stateEnterpriseIncome + e.otherIncome;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

describe("роспись ИИ следует за доходом, а не обесценивается", () => {
  it("за десять лет военная доля мира не растворяется в росте дохода", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 120; month++) simulateMonth(game);

    const ai = game.countries.filter(c => c.id !== game.playerCountryId && income(c) > 0);
    const value = median(ai.map(c => c.economy.militarySpending / income(c)));

    // ДО правки: 6,95% и падение дальше. ПОСЛЕ: держится около 15%.
    expect(value, "военные расходы мира растворились в росте дохода").toBeGreaterThan(0.10);
  }, 300_000);

  it("казна не пухнет: медианный профицит остаётся в разумных единицах ВВП", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 120; month++) simulateMonth(game);

    const ai = game.countries.filter(c => c.id !== game.playerCountryId && c.economy.gdp > 0);
    const value = median(ai.map(c => c.economy.budgetBalance / c.economy.gdp));

    // ДО правки: +13,3% ВВП профицита у медианной страны — деньги некуда
    // девать, потому что расход заморожен. ПОСЛЕ: +2,6%.
    expect(value, "мир копит профицит — расходы не следуют за доходом").toBeLessThan(0.06);
  }, 300_000);
});
