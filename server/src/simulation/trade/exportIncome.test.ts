import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { tradeTick } from "./TradeTick";
import { SANCTION_EXPORT_PENALTY_PER_EMBARGO } from "@shared/defines/trade";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";

/**
 * ЭКСПОРТНЫЙ ДОХОД НЕ ИСПАРЯЕТСЯ И РЕАГИРУЕТ НА БЛОКАДУ.
 *
 * До 2026-07-31 `tradeTick` ЗАТИРАЛ `exportIncome` сырьевой выручкой, хотя в
 * поле лежала вся внешняя торговля страны из авторского профиля: 3–6% ВВП
 * превращались в ~0,0001 на первом же тике и таким оставались 50 лет. Мир
 * ежемесячно терял доход, на который была расписана его бюджетная роспись.
 *
 * Проверяются два свойства, и второе не менее важно первого: доход не только
 * держится, но и ПАДАЕТ под эмбарго — иначе базовая часть была бы неуязвимым
 * подарком от профиля, а не внешней торговлей.
 */

function subject(game: GameState): Country {
  const withGdp = game.countries.filter(c => c.economy.gdp > 0);
  return [...withGdp].sort((a, b) => b.economy.gdp - a.economy.gdp)[Math.floor(withGdp.length / 2)]!;
}

describe("экспортный доход переживает первый тик", () => {
  it("держится на уровне авторского профиля, а не схлопывается", () => {
    const game = createGame("1946", "USA");
    const country = subject(game);
    const profileShare = country.economyProfile.exportShare ?? 0;
    expect(profileShare, "у субъекта нет экспортной доли — тест мерил бы ноль").toBeGreaterThan(0);

    simulateMonth(game);

    const actualShare = country.economy.exportIncome / country.economy.gdp;
    // Порог — половина профильной доли. Он ловит именно СХЛОПЫВАНИЕ (было в 450
    // раз меньше), но не запрещает сырьевой выручке и множителям двигать
    // величину в разумных пределах.
    expect(actualShare).toBeGreaterThan(profileShare / 2);
  });

  it("не схлопывается и на длинной дистанции", () => {
    const game = createGame("1946", "USA");
    const country = subject(game);
    const profileShare = country.economyProfile.exportShare ?? 0;

    for (let month = 0; month < 60; month++) simulateMonth(game);

    expect(country.economy.exportIncome / country.economy.gdp).toBeGreaterThan(profileShare / 2);
  });
});

describe("блокада касается всей внешней торговли", () => {
  /**
   * Свойство, ради которого множители вынесены за скобку суммы. Если бы базовая
   * часть шла мимо них, страна под эмбарго сохраняла бы 3–6% ВВП нетронутыми, и
   * санкция била бы только по сырьевой мелочи.
   */
  it("эмбарго снижает экспортный доход, а не только сырьевую его часть", () => {
    const run = (withEmbargo: boolean): number => {
      const game = createGame("1946", "USA");
      const country = subject(game);

      if (withEmbargo) {
        // Санкцию накладывает другая страна — на субъекта, как в живой партии.
        const sanctioner = game.countries.find(c => c.id !== country.id && c.economy.gdp > 0)!;
        sanctioner.diplomacy.sanctions = {
          ...(sanctioner.diplomacy.sanctions ?? {}),
          [country.id]: ["trade_embargo"],
        };
      }

      tradeTick(game, country);
      return country.economy.exportIncome;
    };

    const free = run(false);
    const blockaded = run(true);

    expect(free).toBeGreaterThan(0);
    expect(blockaded).toBeLessThan(free);
    // Штраф применён именно к ПОЛНОЙ сумме: одно эмбарго снимает свою долю
    // целиком, а не только с сырьевой части. Значение сверяется с константой,
    // чтобы тест следовал за калибровкой, а не фиксировал снимок.
    expect(blockaded).toBeCloseTo(free * (1 - SANCTION_EXPORT_PENALTY_PER_EMBARGO), 5);
  });
});

describe("живой сценарий: первый год не банкротит половину мира", () => {
  /**
   * Прямое следствие правки. До неё к концу первого года в долгах были 156
   * стран из 157; после закрытия бюджетной петли (2026-07-31, P0) — 111; после
   * этой правки — 49. Порог 0,45 держит достигнутое с запасом и падает, если
   * доход снова начнёт испаряться.
   */
  it("доля стран в долгу за первый год ниже 45%", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 12; month++) simulateMonth(game);

    const solvent = game.countries.filter(c => c.economy.gdp > 0);
    const inDebt = solvent.filter(c => c.economy.debt > 0).length;

    expect(inDebt / solvent.length).toBeLessThan(0.45);
  }, 60_000);
});
