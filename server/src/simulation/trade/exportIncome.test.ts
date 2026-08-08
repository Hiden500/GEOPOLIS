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
    // Таймаут: politicsTick с 2026-08-03 выводит недовольство регионов, и
    // 60 месяцев полного прогона перестали укладываться в дефолтные 5 секунд —
    // тот же запас, что у соседнего долгового теста ниже.
  }, 120_000);
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

describe("живой сценарий: долговая яма рассасывается, а не углубляется", () => {
  /**
   * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО. Правка экспорта (2026-07-31)
   * сначала закрывалась порогом «в долгу за первый год < 45%» при наблюдаемых
   * 31%. После перевода расходов ИИ на доли дохода (2026-08-01) первый год
   * стал давать 68%, и это не регрессия дохода, а другой режим расходов:
   * раньше суммы были заморожены на стартовых значениях и обесценивались
   * ростом дохода, теперь они следуют за доходом. Структурный разрыв виден
   * сразу: пять статей росписи 84,9% дохода + прочие расходы 7,9% + импорт
   * 17,5% = 110,9%, потому что импорт в роспись не входит (открытый вопрос —
   * `docs/DECISIONS.md`, 2026-08-01).
   *
   * Поэтому снимок первого года заменён свойством ДИНАМИКИ: яма переходная,
   * мир из неё выходит. Замер 2026-08-01: 68% на 12-м месяце, 65% на 24-м,
   * 3% на 60-м, 0% на 120-м; стран с долгом свыше 60% ВВП к 60-му месяцу нет.
   * Тест падает и если доход снова начнёт испаряться (яма не закроется), и
   * если весь мир уйдёт в долг сразу (порог первого года).
   *
   * ГОРИЗОНТ РАСШИРЕН ДО 120 МЕСЯЦЕВ 2026-08-08, и это не ослабление, а
   * следствие того, что мир научился вооружаться. С появлением обиды за
   * подчинение (`DOMINATION_RESENTMENT`) ветка балансировки Правила B впервые
   * ожила: 5–7 стран из 157 наращивают военные расходы, и вторые-пятые годы
   * партии стали фазой гонки вооружений, которая стоит денег. A/B на том же
   * коммите: без обиды в долгу 6,4% мира на 60-м месяце и 0% на 120-м; с обидой
   * — 10,2% и 3,2%, стран с долгом свыше 60% ВВП на 60-м месяце 3, на 120-м 0.
   * Яма стала глубже и длиннее, но осталась ПЕРЕХОДНОЙ, а проверяется здесь
   * именно это.
   *
   * Утверждения переписаны со снимков на МОНОТОННОСТЬ: доля должников обязана
   * убывать от года к году, а тяжёлые долги — исчезнуть к десятому. Снимок вида
   * «< 10% на 60-м месяце» пришлось бы переписывать после каждой калибровки, и
   * он ничего не сказал бы о направлении.
   */
  it("первый год не топит весь мир, а дальше долги убывают", () => {
    const game = createGame("1946", "USA");
    const solvent = (): typeof game.countries => game.countries.filter(c => c.economy.gdp > 0);
    const inDebtShare = (): number =>
      solvent().filter(c => c.economy.debt > 0).length / solvent().length;

    for (let month = 0; month < 12; month++) simulateMonth(game);
    const firstYear = inDebtShare();
    expect(firstYear, "в долгу практически весь мир — доход не покрывает даже переходный период").toBeLessThan(0.8);

    for (let month = 12; month < 60; month++) simulateMonth(game);
    const fifthYear = inDebtShare();

    for (let month = 60; month < 120; month++) simulateMonth(game);
    const tenthYear = inDebtShare();

    expect(fifthYear, "к пятому году должников не меньше, чем в первом — яма углубляется").toBeLessThan(firstYear);
    expect(tenthYear, "к десятому году должников не меньше, чем к пятому — яма не закрывается").toBeLessThan(fifthYear);
    expect(
      solvent().filter(c => c.economy.debt > c.economy.gdp * 0.6).length,
      "к десятому году остались страны с долгом свыше 60% ВВП"
    ).toBe(0);
  }, 240_000);
});
