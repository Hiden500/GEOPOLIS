import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { populationTick } from "../population/PopulationTick";
import { resourceTick } from "../resources/ResourceTick";
import { tradeTick } from "../trade/TradeTick";
import { buildExtraction } from "../../commands/resources";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";
import { effectiveController } from "@shared/utils/regionControl";
import { DOMESTIC_RESERVE_PER_CAPITA } from "@shared/defines/trade";
import { RESOURCE_IDS, RESOURCE_CATALOG } from "@shared/data/resources/resourceCatalog";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type ResourceType } from "@shared/types/resources/ResourcesType";

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

  /**
   * `build_extraction` — единственное ресурсное действие LLM, и на живых данных
   * оно не могло изменить НИЧЕГО: все 2055 пар (регион, ресурс) с депозитом
   * стоят ровно на `MAX_EXTRACTION_LEVEL`, а команда клампила и возвращала
   * `success: true`. Проверяется не «действие полезно» (полезным его делают
   * данные — развилка в `docs/IDEAS.md`), а «команда не врёт»: успех означает
   * изменённое состояние. Тест переживает любое наполнение уровней и падает на
   * возврате кламп-без-отказа — тогда ложных успехов ровно 2055.
   */
  it("buildExtraction не возвращает успех, не изменив состояние", () => {
    const game = createGame("1946", "USA");
    let falseSuccess = 0;
    let attempts = 0;

    for (const region of game.regions) {
      const controller = effectiveController(region);
      const country = game.countries.find(c => c.id === controller);
      if (!country) continue;

      for (const resource of Object.keys(region.deposits) as ResourceType[]) {
        if (!region.deposits[resource]) continue;
        attempts++;
        const before = region.extraction[resource] ?? 0;
        // Казна не должна маскировать вопрос «есть ли что строить».
        country.economy.treasury = Number.MAX_SAFE_INTEGER;

        const result = buildExtraction(game, country.id, region.id, resource, 1);

        const after = region.extraction[resource] ?? 0;
        if (result.success && after === before) falseSuccess++;
      }
    }

    // Обход непустой — иначе ноль ниже ничего не доказывает.
    expect(attempts).toBeGreaterThan(0);
    expect(falseSuccess).toBe(0);
  });

  /**
   * Эмбарго режет отгрузку, а не выручку за отгруженное. На фикстуре это
   * проверяет `TradeTick.test.ts`; здесь — что вход живой: у страны сценария
   * действительно есть излишек, который БЫЛ БЫ уничтожен старым порядком
   * (замер до правки — 153 656 единиц за один тик, `probeResourceGates.ts`).
   */
  it("страна сценария под полной блокадой не теряет запас", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 12; month++) simulateMonth(game);

    const currentYear = Number(game.currentDate.split("-")[0]);
    const active = RESOURCE_IDS.filter(r => RESOURCE_CATALOG[r].eraIntroduced <= currentYear);
    const surplus = (country: Country): number => {
      const reserve = country.population * DOMESTIC_RESERVE_PER_CAPITA;
      return active.reduce((sum, r) => sum + Math.max(0, (country.stockpile[r] ?? 0) - reserve), 0);
    };

    const target = [...game.countries].sort((a, b) => surplus(b) - surplus(a))[0]!;
    expect(surplus(target)).toBeGreaterThan(0); // вход живой, а не «нечего терять»

    for (const embargoer of game.countries.filter(c => c.id !== target.id).slice(0, 5)) {
      embargoer.diplomacy.sanctions[target.id] = ["trade_embargo"];
    }
    const stockBefore = active.map(r => target.stockpile[r] ?? 0);

    tradeTick(game, target);

    expect(target.economy.exportIncome).toBe(0);
    active.forEach((r, i) => expect(target.stockpile[r] ?? 0).toBeGreaterThanOrEqual(stockBefore[i]!));
  });
});
