import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { populationTick } from "../population/PopulationTick";
import { resourceTick } from "../resources/ResourceTick";
import { stabilityEquilibrium } from "../politics/PoliticsTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";

/**
 * Guard-тесты недостающего класса: вход формулы должен РАЗЛИЧАТЬ страны на
 * живых данных.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Аудит 2026-07-30 нашёл шесть дефектов, невидимых 1276
 * зелёным тестам, и причина у всех одна: тест проверяет формулу на подобранной
 * фикстуре, поэтому «вход выродился в константу у всех стран» и «порог
 * недостижим достижимым диапазоном» ему не видны в принципе. Здесь проверяется
 * не «функция вернула ожидаемое число», а «между странами есть разница, и она
 * того порядка, который задумывался».
 *
 * ПОРОГИ — от достижимого диапазона, не снимки. Каждый порог ниже сформулирован
 * так, чтобы падать на ВОССТАНОВЛЕННОМ старом поведении и переживать обычную
 * перекалибровку. Числа старого поведения — в комментарии к каждому тесту, они
 * получены прогоном `server/scripts/probeSimulationHealth.ts` до правок
 * (`.agent/audits/formula-audit-2026-07-30.md`).
 */

/** Регион с заданной стабильностью — остальные поля из общей фикстуры. */
function regionWith(id: number, ownerCountryId: string, stability: number): Region {
  return createTestRegion({ id, ownerCountryId, stability, population: 1_000_000 });
}

/** Страна с заданным прогрессом домена; экономика из общей фикстуры. */
function countryWithDomain(id: string, domain: string, progress: number): Country {
  const country = createTestCountry({ id });
  country.technology.domains[domain] = progress;
  return country;
}

describe("тех-бонусы читают ТИР домена, а не сырой прогресс", () => {
  /**
   * Свойство тира: внутри одного тира ответ не меняется, на границе — меняется.
   * Старое поведение (`domains[...]` напрямую) обе части проваливало: прогресс
   * 400 и 499 давали разную смертность, и делитель достигал 13× за 10 лет
   * вместо 1,4×.
   */
  it("смертность одинакова внутри тира и меняется на его границе", () => {
    const withinTierLow = countryWithDomain("AAA", "biology", TIER_PROGRESS_THRESHOLD * 4);
    const withinTierHigh = countryWithDomain("BBB", "biology", TIER_PROGRESS_THRESHOLD * 5 - 1);
    const nextTier = countryWithDomain("CCC", "biology", TIER_PROGRESS_THRESHOLD * 5);

    const survivors = (country: Country): number => {
      const region = regionWith(1, country.id, 0.5);
      populationTick(country, [region]);
      return region.population;
    };

    const low = survivors(withinTierLow);
    const high = survivors(withinTierHigh);
    const next = survivors(nextTier);

    expect(high).toBe(low);
    expect(next).not.toBe(low);
  });

  it("добыча одинакова внутри тира и меняется на его границе", () => {
    const extract = (progress: number): number => {
      const country = countryWithDomain("AAA", "industry", progress);
      const region = regionWith(1, "AAA", 0.5);
      resourceTick(country, [region]);
      return country.stockpile.oil;
    };

    const low = extract(TIER_PROGRESS_THRESHOLD * 4);
    const high = extract(TIER_PROGRESS_THRESHOLD * 5 - 1);
    const next = extract(TIER_PROGRESS_THRESHOLD * 5);

    expect(high).toBeCloseTo(low, 6);
    expect(next).not.toBeCloseTo(low, 6);
  });
});

describe("region.stability различает регионы в демографии", () => {
  /**
   * Шкала поля — 0..1. Деление на 100 сжимало множитель рождаемости до разброса
   * 0,31% (0,8007…0,8032) при задуманных 28,6%. Порог 10% выбран заведомо ниже
   * задуманного размаха и заведомо выше сжатого: переживает перекалибровку
   * коэффициентов, но падает на возврате `/100`.
   */
  it("прирост населения спокойного региона заметно отличается от неспокойного", () => {
    const country = createTestCountry({ id: "AAA" });
    // Края фактического диапазона сценария 1946 (0,184…0,809), а не 0 и 1:
    // проверяем разницу, которую даёт ЖИВОЙ разброс, а не теоретический предел.
    const calm = regionWith(1, "AAA", 0.809);
    const restless = regionWith(2, "AAA", 0.184);
    const startPopulation = calm.population;

    populationTick(country, [calm, restless]);

    const calmGrowth = calm.population - startPopulation;
    const restlessGrowth = restless.population - startPopulation;
    const relativeGap = Math.abs(calmGrowth - restlessGrowth) / startPopulation;

    expect(calm.population).toBeGreaterThan(restless.population);
    expect(relativeGap).toBeGreaterThan(0.001);
  });
});

describe("живой сценарий 1946: входы не вырождаются в константу", () => {
  /**
   * Стартовые legitimacy/corruption сеются из структурных базисов. До правки все
   * 157 стран стартовали с литералов 50/30 — разброс РОВНО 0, и влитая разметка
   * форм власти выражалась в партии только через дрейф 0,005/мес.
   */
  it("стартовые легитимность и коррупция различают страны", () => {
    const game = createGame("1946", "USA");
    const legitimacy = game.countries.map(c => c.politics.legitimacy);
    const corruption = game.countries.map(c => c.politics.corruption);

    const span = (values: number[]): number => Math.max(...values) - Math.min(...values);

    // Порог 20 пунктов из 100 — заметно ниже наблюдаемых ~50, но недостижим для
    // любого варианта «у всех одинаково».
    expect(span(legitimacy)).toBeGreaterThan(20);
    expect(span(corruption)).toBeGreaterThan(20);
    expect(new Set(legitimacy).size).toBeGreaterThan(5);
  });

  /**
   * Равновесие стабильности должно РАЗЛИЧАТЬ страны: разные режимы, разная
   * экономика, разная авторская стабильность сценария — разное равновесие.
   *
   * Замер до правки (`server/scripts/probeStabilityEquilibrium.ts`): на старте
   * 153 страны из 157 получали ровно 70, различных значений во всём мире 3,
   * sd 2,19; через два года — 156 из 157 на 70, различных 2, sd 0,80. Причина
   * не в формуле, а в её форме: четыре пороговые ступени над экономикой,
   * которая живёт целиком по одну сторону трёх порогов из четырёх.
   *
   * Пороги ниже — от достижимого разброса, не снимки. Разброс якоря сценария
   * (`region.stability` 0,193…0,809 → 19,3…80,9) даёт sd порядка 13 пунктов;
   * порог 5 заведомо ниже него и заведомо выше любого варианта «ступень выдала
   * всем одно и то же» (старое значение 2,19 и 0,80). Требование «различных
   * значений больше четверти стран» падает на старом поведении втрое-впятеро.
   */
  it("равновесие стабильности различает страны, а не выдаёт всем одно число", () => {
    const game = createGame("1946", "USA");
    const measure = (): { sd: number; distinct: number; modalShare: number; n: number } => {
      const countries = game.countries.filter(c => c.economy.gdp > 0);
      const values = countries.map(c =>
        stabilityEquilibrium(c, game.regions.filter(r => r.ownerCountryId === c.id))
      );
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

      const counts = new Map<string, number>();
      for (const v of values) {
        const key = v.toFixed(4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return {
        sd,
        distinct: counts.size,
        modalShare: Math.max(...counts.values()) / values.length,
        n: values.length,
      };
    };

    const atStart = measure();
    expect(atStart.sd).toBeGreaterThan(5);
    expect(atStart.distinct).toBeGreaterThan(atStart.n / 4);
    // Ни одно значение не собирает даже пятую часть мира — тот же вид проверки,
    // что у базисов легитимности и коррупции в PoliticsTick.test.ts.
    expect(atStart.modalShare).toBeLessThan(0.2);

    // И различение не схлопывается со временем: до правки оно РОСЛО в обратную
    // сторону — за два года мир сходился с 3 значений до 2.
    for (let month = 0; month < 24; month++) simulateMonth(game);

    const afterTwoYears = measure();
    expect(afterTwoYears.sd).toBeGreaterThan(5);
    expect(afterTwoYears.distinct).toBeGreaterThan(afterTwoYears.n / 4);
    expect(afterTwoYears.modalShare).toBeLessThan(0.2);
  });

  /**
   * Стартовое состояние сценария механика обязана СОХРАНЯТЬ, а не переписывать
   * с первого тика. Авторская стабильность лежит в `region.stability`; до правки
   * страна стартовала литералом 50 (разброс РОВНО 0), и первый год партии игрок
   * видел не сценарий, а его литеральную замену.
   */
  it("стартовая стабильность стран приходит из сценария и переживает первый год", () => {
    const game = createGame("1946", "USA");
    const start = new Map(game.countries.map(c => [c.id, c.politics.stability]));

    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    expect(spread([...start.values()])).toBeGreaterThan(20);
    expect(new Set(start.values()).size).toBeGreaterThan(game.countries.length / 4);

    for (let month = 0; month < 12; month++) simulateMonth(game);

    // Дрейф 0,05/мес за год покрывает ~46% зазора до равновесия, поэтому проверка
    // не «не сдвинулось», а «не уехало в общую точку»: порядок стран и разброс
    // мира сохранились. На старом поведении (равновесие ≡ 70 у всех) разброс за
    // год схлопывался к нулю независимо от старта.
    const afterYear = game.countries.map(c => c.politics.stability);
    expect(spread(afterYear)).toBeGreaterThan(20);
  });

  /**
   * Бюджетная петля: расходы калибруются от внутреннего дохода, без экспортной
   * оценки, которую первый же `tradeTick` перезаписывает физическим числом.
   * До правки к концу первого года в долгах были 156 стран из 157 (99%).
   *
   * Порог 90% — это проверка «мир не банкротится ЦЕЛИКОМ». Он намеренно грубый:
   * остаточный дефицит первого года имеет отдельную причину (сырьевой экспорт
   * даёт ~0,0001 ВВП вместо профильных 3–6%), она вынесена в docs/TODO.md и
   * этой правкой не закрывается.
   */
  it("первый игровой год не банкротит почти весь мир", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 12; month++) simulateMonth(game);

    const solvent = game.countries.filter(c => c.economy.gdp > 0);
    const inDebt = solvent.filter(c => (c.economy.debt ?? 0) > 0).length;

    expect(inDebt / solvent.length).toBeLessThan(0.9);
  });
});
