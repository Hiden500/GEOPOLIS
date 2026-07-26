import { describe, it, expect } from "vitest";
import { simulateMonth } from "../SimulationEngine";
import { discontentTick } from "../politics/DiscontentTick";
import { createGame } from "../../game/CreateGame";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { type EthnicGroupDefinition } from "@shared/types/politics/Demographics";
import { getDomainTier } from "@shared/utils/technology";
import {
  ideologyDistance,
  regionAuthority,
  regionDiscontent,
  regionWelfare,
  resolveIdeologyCoordinates,
} from "@shared/utils/discontent";
import {
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  REGION_CRISIS_RELEASE_HYSTERESIS,
} from "@shared/defines/discontent";

/**
 * Smoke-тест N-летней кампании (docs/TODO.md, "БАГ" — население тихо
 * вымирает). Мотивация (не убирать при рефакторинге теста):
 *
 * Дважды в этом проекте баг проходил через десятки/сотни зелёных
 * юнит-тестов и обнаруживался только вручную живым прогоном:
 *   1. Система исследований — прогресс зачислялся в несуществующий домен
 *      `"Research"` вместо реального домена технологии.
 *   2. Население тихо вымирает (США: 140.7M → 125.6M за 60 месяцев без
 *      войны) — три места в коде искали несуществующий ключ
 *      домена/константу и тихо получали 0 (см. docs/TODO.md, раздел "БАГ").
 *
 * Юнит-тесты (300+) не поймали ни один из них, потому что каждый тестирует
 * свой тик изолированно с моковыми данными на один шаг, а не сквозной
 * многолетний прогон с реалистичными числами реального сценария 1946.
 * Этот тест — намеренно другого рода: гоняет simulateMonth много раз
 * подряд на полной партии сценария 1946 и проверяет вменяемость траектории,
 * а не только отсутствие исключений.
 *
 * ВАЖНО: этот тест ОБЯЗАН падать на известном баге популяции (см. ниже).
 * Если он вдруг стал зелёным без починки PopulationTick.ts/ResourceTick.ts —
 * скорее всего кто-то тихо занизил порог, чтобы скрыть регресс. Не делай
 * так: чинить баг — отдельная задача, требующая подтверждения пользователя
 * (docs/TODO.md).
 */

const MONTHS_TO_SIMULATE = 60; // 5 лет — тот же горизонт, что живой прогон, нашедший баг популяции.
const SNAPSHOT_INTERVAL_MONTHS = 12;
const EXPECTED_COUNTRY_COUNT = 157; // Все континенты завершены (2026-07-17); 2026-07-18: Алжир→FRA (-1), Занзибар отделён (+1), Питкерн→GBR и Токелау→NZL (-2), 39 небольших колоний/морских баз без своей государственности свёрнуты в прямое владение метрополий (-39, игровое упрощение по решению пользователя); 2026-07-19: Австрия распущена на 4 зоны оккупации (-1 AUT, +4 QOS/QOA/QOB/QOF, как и Германия — по запросу пользователя); Палестина пересобрана исторически 8→15 подрайонов (+7), Ливан на реальные 5 мухафаз (+1), ОАЭ/Договорной Оман консолидирован обратно в 1 страну (-6, разворот решения от 2026-06-28 — см. docs/DECISIONS.md).

// Допуск сравнений над недовольством: числа собираются сложением и умножением
// дробей, поэтому «равно» на границе кламп-диапазона надо читать с эпсилоном.
const DISCONTENT_EPSILON = 1e-9;

// Десять держав tier "major" сценария 1946 (server/src/simulation/tier/TierTick.ts,
// HISTORICAL_TIERS_1946) — реальные id из датасета, не выдуманные.
const MAJOR_POWER_IDS = ["USA", "SUN", "GBR", "FRA", "CHN", "JPN", "ITA", "BRA", "ARG", "CAN"];

// Мирного времени: не более 2%/год падения населения. Исторически в 1946-1951
// крупные державы росли, так что даже "не падает" — уже строгая проверка. 2%,
// а не 10%, потому что известный баг популяции (docs/TODO.md) даёт РАВНОМЕРНОЕ
// падение ~2.2-2.3%/год у всех major-держав (не единовременный скачок) — порог
// в 10%/год не заметил бы его ни на одном годовом интервале, хотя за 5 лет он
// складывается в -10%+. См. также совокупную проверку MAX_PEACETIME_TOTAL_POPULATION_DECLINE
// ниже — вторая линия защиты на случай, если годовой темп когда-нибудь станет
// неравномерным.
const MAX_PEACETIME_ANNUAL_POPULATION_DECLINE = 0.02;

// Совокупное падение за весь прогон (docs/TODO.md: США потеряли 10.7% за 60
// месяцев) — считается от старта (1946-01) до последнего снимка, независимо от
// того, как темп распределён по годам.
const MAX_PEACETIME_TOTAL_POPULATION_DECLINE = 0.05;

interface YearSnapshot {
  year: number;
  month: number;
  countryId: string;
  population: number;
  gdp: number;
  treasury: number;
  stability: number;
  legitimacy: number;
  governmentSupport: number;
  corruption: number;
  maxDomainTier: number;
}

function countryPopulation(country: Country): number {
  return country.population;
}

function isAtWar(game: GameState, countryId: string): boolean {
  return game.wars.some(
    (war) => war.active && (war.attackers.includes(countryId) || war.defenders.includes(countryId))
  );
}

function maxDomainTier(country: Country): number {
  const progresses = Object.values(country.technology.domains);
  if (progresses.length === 0) return 0;
  return Math.max(...progresses.map(getDomainTier));
}

function snapshotCountries(
  game: GameState,
  year: number,
  month: number,
  ids: string[]
): YearSnapshot[] {
  return ids.map((id) => {
    const country = game.countries.find((c) => c.id === id);
    if (!country) throw new Error(`Страна ${id} не найдена в GameState — датасет 1946 изменился?`);
    return {
      year,
      month,
      countryId: id,
      population: countryPopulation(country),
      gdp: country.economy.gdp,
      treasury: country.economy.treasury,
      stability: country.politics.stability,
      legitimacy: country.politics.legitimacy,
      governmentSupport: country.politics.governmentSupport,
      corruption: country.politics.corruption,
      maxDomainTier: maxDomainTier(country),
    };
  });
}

function formatSnapshot(s: YearSnapshot): string {
  return (
    `${s.countryId}: год=${s.year} мес=${s.month} ` +
    `pop=${(s.population / 1e6).toFixed(2)}M gdp=${(s.gdp / 1e9).toFixed(1)}B ` +
    `treasury=${(s.treasury / 1e9).toFixed(1)}B stability=${s.stability.toFixed(1)} ` +
    `legitimacy=${s.legitimacy.toFixed(1)} govSupport=${s.governmentSupport.toFixed(1)} ` +
    `corruption=${s.corruption.toFixed(1)} maxTechTier=${s.maxDomainTier}`
  );
}

describe("campaign smoke test — многолетний прогон сценария 1946", () => {
  it(
    `прогоняет ${MONTHS_TO_SIMULATE} месяцев (реальный сценарий 1946, ${EXPECTED_COUNTRY_COUNT} стран) и проверяет вменяемость траектории major-держав`,
    () => {
      const game = createGame("1946", "USA");

      expect(game.countries.length).toBe(EXPECTED_COUNTRY_COUNT);
      for (const id of MAJOR_POWER_IDS) {
        expect(game.countries.some((c) => c.id === id)).toBe(true);
      }

      // Снимки по всем major-державам на старте, затем каждые 12 месяцев.
      const history: YearSnapshot[] = [];
      history.push(...snapshotCountries(game, 1946, 1, MAJOR_POWER_IDS));

      // Отслеживаем максимальный виденный тир каждого домена по каждой стране —
      // для проверки "тир никогда не откатывается" даже между снимками.
      const maxTierSeen = new Map<string, number>();
      for (const id of MAJOR_POWER_IDS) maxTierSeen.set(id, 0);

      const startedAt = Date.now();

      for (let month = 1; month <= MONTHS_TO_SIMULATE; month++) {
        simulateMonth(game);

        // Тир не должен откатываться НИ на одном шаге, не только на годовых срезах.
        for (const id of MAJOR_POWER_IDS) {
          const country = game.countries.find((c) => c.id === id)!;
          const currentMax = maxDomainTier(country);
          const previousMax = maxTierSeen.get(id)!;
          expect(
            currentMax,
            `${id}: тир технологий откатился на месяце ${month} ` +
              `(currentDate=${game.currentDate}): было ${previousMax}, стало ${currentMax}. ` +
              `Тир — сумма прогресса, он не должен уменьшаться никогда (shared/src/utils/technology.ts).`
          ).toBeGreaterThanOrEqual(previousMax);
          maxTierSeen.set(id, Math.max(previousMax, currentMax));
        }

        if (month % SNAPSHOT_INTERVAL_MONTHS === 0) {
          const [yearStr, monthStr] = game.currentDate.split("-");
          history.push(...snapshotCountries(game, Number(yearStr), Number(monthStr), MAJOR_POWER_IDS));
        }
      }

      const elapsedMs = Date.now() - startedAt;

      // Диагностическая печать траектории — этот тест существует, чтобы её видеть,
      // не только чтобы получить pass/fail.
      console.log(
        `\n=== Campaign smoke test: ${MONTHS_TO_SIMULATE} месяцев, ${elapsedMs}ms ===`
      );
      for (const id of MAJOR_POWER_IDS) {
        console.log(`\n-- ${id} --`);
        for (const s of history.filter((h) => h.countryId === id)) {
          console.log("  " + formatSnapshot(s));
        }
      }

      // ---- Базовые проверки на NaN/абсурдные значения для всех снимков ----
      for (const s of history) {
        expect(Number.isFinite(s.gdp), `${s.countryId}: GDP не конечен (${s.gdp}) на ${s.year}-${s.month}`).toBe(true);
        expect(s.gdp, `${s.countryId}: GDP отрицателен (${s.gdp}) на ${s.year}-${s.month}`).toBeGreaterThanOrEqual(0);

        expect(Number.isFinite(s.treasury), `${s.countryId}: treasury = NaN на ${s.year}-${s.month}`).toBe(true);

        expect(Number.isFinite(s.stability), `${s.countryId}: stability = NaN на ${s.year}-${s.month}`).toBe(true);
        expect(Number.isFinite(s.legitimacy), `${s.countryId}: legitimacy = NaN на ${s.year}-${s.month}`).toBe(true);
        expect(Number.isFinite(s.governmentSupport), `${s.countryId}: governmentSupport = NaN на ${s.year}-${s.month}`).toBe(true);
        expect(Number.isFinite(s.corruption), `${s.countryId}: corruption = NaN на ${s.year}-${s.month}`).toBe(true);

        // politics.* задуманы как проценты 0-100 (см. fixtures.ts стартовые значения:
        // stability: 70, legitimacy: 60, corruption: 30, governmentSupport: 50).
        expect(s.stability, `${s.countryId}: stability вне диапазона 0-100 (${s.stability}) на ${s.year}-${s.month}`).toBeGreaterThanOrEqual(0);
        expect(s.stability).toBeLessThanOrEqual(100);
        expect(s.legitimacy, `${s.countryId}: legitimacy вне диапазона 0-100 (${s.legitimacy}) на ${s.year}-${s.month}`).toBeGreaterThanOrEqual(0);
        expect(s.legitimacy).toBeLessThanOrEqual(100);
        expect(s.governmentSupport, `${s.countryId}: governmentSupport вне диапазона 0-100 (${s.governmentSupport}) на ${s.year}-${s.month}`).toBeGreaterThanOrEqual(0);
        expect(s.governmentSupport).toBeLessThanOrEqual(100);
        expect(s.corruption, `${s.countryId}: corruption вне диапазона 0-100 (${s.corruption}) на ${s.year}-${s.month}`).toBeGreaterThanOrEqual(0);
        expect(s.corruption).toBeLessThanOrEqual(100);
      }

      // ---- Население: не более X% падения в год мирного времени ----
      // Изначальный БАГ (docs/TODO.md, найден 2026-07-06 — gdpPerCapita/10000
      // вместо GDP_PER_CAPITA_REFERENCE=850, домен "Biotechnology" вместо
      // реального "biology") — ПОЧИНЕН 2026-07-06 (PopulationTick.ts). После
      // фикса большинство держав (USA/SUN/GBR/FRA/JPN/CAN) растут нормально.
      //
      // НОВАЯ, ОТДЕЛЬНАЯ находка, вскрытая тем же прогоном после фикса: страны
      // с очень низким стартовым ВВП/чел в датасете 1946 (CHN ~$83/чел, также
      // ARG/BRA/ITA) всё ещё стабильно теряют население — не из-за бага (три
      // диагностированных причины исправлены), а потому что formula
      // standardOfLiving = min(gdpPerCapita/850, 2) даёт им multiplier у пола
      // 0.5 корректно, как и задумано формулой. Открытый вопрос — либо формула
      // слишком резко давит рождаемость на нижнем конце шкалы ВВП/чел, либо
      // региональные экономические данные для этих стран занижены относительно
      // истории (см. docs/SCENARIOS.md — числа 128 стран не откалиброваны по
      // надёжным источникам). Требует решения пользователя, не занижай пороги
      // ниже втихую, чтобы скрыть это — см. отчёт в docs/TODO.md.
      const byCountry = new Map<string, YearSnapshot[]>();
      for (const s of history) {
        if (!byCountry.has(s.countryId)) byCountry.set(s.countryId, []);
        byCountry.get(s.countryId)!.push(s);
      }

      for (const [countryId, snapshots] of byCountry) {
        const atWar = isAtWar(game, countryId);

        for (let i = 1; i < snapshots.length; i++) {
          const prev = snapshots[i - 1];
          const curr = snapshots[i];
          if (!prev || !curr) continue; // недостижимо (i в пределах [1, length)), нужно только для noUncheckedIndexedAccess

          const yearsElapsed = curr.year - prev.year + (curr.month - prev.month) / 12;
          const declineRatio = prev.population > 0 ? (prev.population - curr.population) / prev.population : 0;
          const annualizedDecline = yearsElapsed > 0 ? declineRatio / yearsElapsed : declineRatio;

          if (!atWar) {
            expect(
              annualizedDecline,
              `${countryId}: население упало на ${(declineRatio * 100).toFixed(1)}% между ` +
                `${prev.year}-${String(prev.month).padStart(2, "0")} (${(prev.population / 1e6).toFixed(2)}M) и ` +
                `${curr.year}-${String(curr.month).padStart(2, "0")} (${(curr.population / 1e6).toFixed(2)}M) ` +
                `без активной войны — превышает допустимые ${(MAX_PEACETIME_ANNUAL_POPULATION_DECLINE * 100).toFixed(0)}%/год. ` +
                `Три изначальных бага в PopulationTick.ts починены 2026-07-06 — это ОТДЕЛЬНАЯ, НОВАЯ находка: ` +
                `у стран с очень низким ВВП/чел (см. docs/TODO.md) formula standardOfLiving корректно даёт multiplier ` +
                `у пола 0.5, но открыт вопрос — резкость формулы или занижены исходные данные ВВП/чел. ` +
                `Не занижай порог, чтобы скрыть — реши вопрос по существу (см. docs/TODO.md).`
            ).toBeLessThanOrEqual(MAX_PEACETIME_ANNUAL_POPULATION_DECLINE);
          }
        }

        // Вторая линия защиты: совокупное падение от старта до конца прогона,
        // независимо от того, как темп распределён по годам (известный баг
        // популяции даёт РАВНОМЕРНОЕ ~2.2-2.3%/год падение — годовая проверка
        // выше может не сработать, если порог когда-нибудь ослабят; эта проверка
        // ловит суммарный эффект напрямую).
        if (!atWar && snapshots.length > 1) {
          const first = snapshots[0];
          const last = snapshots[snapshots.length - 1];
          if (!first || !last) continue; // недостижимо (snapshots.length > 1 гарантирует оба), нужно только для noUncheckedIndexedAccess
          const totalDecline = first.population > 0 ? (first.population - last.population) / first.population : 0;

          expect(
            totalDecline,
            `${countryId}: суммарное падение населения за весь прогон — ` +
              `${(totalDecline * 100).toFixed(1)}% (${(first.population / 1e6).toFixed(2)}M → ` +
              `${(last.population / 1e6).toFixed(2)}M, ${first.year}-${String(first.month).padStart(2, "0")} → ` +
              `${last.year}-${String(last.month).padStart(2, "0")}), без войны — превышает допустимые ` +
              `${(MAX_PEACETIME_TOTAL_POPULATION_DECLINE * 100).toFixed(0)}% за весь прогон. ` +
              `Изначальные баги PopulationTick.ts починены 2026-07-06 — см. docs/TODO.md про новую, ` +
              `отдельную находку (низкий ВВП/чел у части стран 1946-датасета). Не занижай порог, ` +
              `чтобы скрыть — реши вопрос по существу.`
          ).toBeLessThanOrEqual(MAX_PEACETIME_TOTAL_POPULATION_DECLINE);
        }
      }

      // Время выполнения — печатаем явно для видимости в CI-логах.
      console.log(`\nВремя выполнения: ${elapsedMs}ms для ${MONTHS_TO_SIMULATE} месяцев × ${EXPECTED_COUNTRY_COUNT} стран.`);
    },
    120_000 // 5-летний прогон полного сценария — даём тесту до 2 минут, чтобы не флапал на медленных машинах.
  );

  /**
   * Региональный слой недовольства на РЕАЛЬНЫХ данных сценария, а не на
   * фикстуре (docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A).
   * DiscontentTick.test.ts гоняет формулу на трёх синтетических регионах — здесь
   * проверяется, что связка «файлы данных → загрузка → тик» реально даёт
   * заявленную механику и держит её многолетним прогоном.
   *
   * ПЕРЕПИСАН 2026-07-26 — прежнюю форму не возвращать. До этого тест утверждал
   * РАССТАНОВКУ: три захардкоженных списка region_id («титульные» /
   * «смешанные» / «контрольные») плюс порядок между ними — «регион 190
   * недовольнее самого напряжённого из 26/27/274». Списки были сняты с грубого
   * seed'а, и первое же более точное наполнение demographics.json их
   * опровергло: в Гродно (27) 34 % поляков, в Калининграде (274) 65 % немцев,
   * и «контрольный» 274 оказался напряжённее «смешанной» Риги (0.545 против
   * 0.505). Упал не механизм и не данные — упала предпосылка теста. Такие же
   * списки нельзя вводить заново под другими номерами: region_id позиционные и
   * переезжают при каждой пересборке геометрии (scripts/map/AGENTS.md, «Каскад
   * region_id»), а доли меняются с каждым наполнением.
   *
   * Проверяется СВОЙСТВО механики: недовольство монотонно растёт с
   * долей-взвешенной идеологической дистанцией «власть ↔ группа» и с
   * экономическим отставанием региона. Оба входа проверяются контролируемым
   * контрфактом — реальный регион сценария клонируется с изменением РОВНО
   * одного входа, — плюс тем же порядком на реальных парах регионов. Ни один
   * region_id, ни одна доля и ни один числовой порог здесь не захардкожены,
   * поэтому следующее наполнение датасета (полный демо-состав ~1399 регионов,
   * Milestone 2) тест не сломает.
   */
  it(
    `выводит недовольство монотонно по идеологической дистанции и экономике региона (${MONTHS_TO_SIMULATE} месяцев реального сценария)`,
    () => {
      const game = createGame("1946", "SUN");

      // ---- Разметка доехала из файлов данных до состояния партии ----
      expect(game.ethnicGroups.length).toBeGreaterThan(0);
      const groupsById = new Map<string, EthnicGroupDefinition>(
        game.ethnicGroups.map((g) => [g.id, g])
      );

      const marked = game.regions.filter((r) => r.demographics && r.demographics.length > 0);
      // Число размеченных регионов не фиксируем — оно меняется с наполнением, а
      // загрузчик и так падает ScenarioDataError на записи в несуществующий
      // регион (server/src/scenarios/Scenario1946.ts). Фиксируем целостность:
      // разметка есть, доли складываются в единицу, каждая группа объявлена.
      expect(marked.length).toBeGreaterThan(0);
      for (const region of marked) {
        const shares = region.demographics ?? [];
        for (const entry of shares) {
          expect(
            groupsById.has(entry.groupId),
            `Регион ${region.id}: группа "${entry.groupId}" не объявлена в groups.json`
          ).toBe(true);
        }
        const total = shares.reduce((sum, entry) => sum + entry.share, 0);
        expect(total, `Регион ${region.id}: сумма долей ${total}, ожидается 1`).toBeCloseTo(1, 6);
      }

      // ---- Два входа механики, читаемые из состояния тем же способом, что и тиком ----
      const authorityOf = (region: Region) => {
        const country = regionAuthority(game, region);
        if (!country) {
          throw new Error(`Регион ${region.id}: контролёр не найден среди стран партии`);
        }
        return resolveIdeologyCoordinates(country.politics);
      };

      /** Доля-взвешенная идеологическая дистанция «власть ↔ группы региона». */
      const weightedDistance = (region: Region): number => {
        const authority = authorityOf(region);
        let weighted = 0;
        let totalShare = 0;
        for (const entry of region.demographics ?? []) {
          const definition = groupsById.get(entry.groupId);
          if (!definition) continue;
          totalShare += entry.share;
          weighted += entry.share * ideologyDistance(authority, definition.desiredIdeology);
        }
        return totalShare > 0 ? weighted / totalShare : 0;
      };

      const welfareOf = (region: Region): number => regionWelfare(region, regionAuthority(game, region));
      const discontentOf = (region: Region): number => {
        const value = regionDiscontent(game, region);
        if (value === undefined) throw new Error(`Регион ${region.id}: недовольство не выведено`);
        return value;
      };

      /**
       * Клон региона с изменённым входом. Состояние партии не мутируется:
       * regionDiscontent — чистая функция, ей достаточно объекта региона.
       */
      const variantOf = (region: Region, patch: Partial<Region>): Region => ({ ...region, ...patch });

      for (let i = 0; i < MONTHS_TO_SIMULATE; i++) simulateMonth(game);

      // Тики после discontentTick (война, ИИ, цели) могут сдвинуть экономику уже
      // ПОСЛЕ оценки недовольства, поэтому латч синхронизируем с тем состоянием,
      // которое замеряем ниже. Это вызов движка, а не подмена его логики.
      discontentTick(game);

      const profile = marked.map((region) => ({
        id: region.id,
        region,
        distance: weightedDistance(region),
        welfare: welfareOf(region),
        discontent: discontentOf(region),
      }));

      // Диагностическая печать — тест существует и ради того, чтобы видеть картину.
      console.log(`\n=== Недовольство размеченных регионов (${game.currentDate}) ===`);
      console.log("region | discontent | взв. дистанция | благосостояние | состав");
      for (const p of [...profile].sort((a, b) => b.discontent - a.discontent)) {
        const composition = (p.region.demographics ?? [])
          .map((e) => `${e.groupId} ${(e.share * 100).toFixed(0)}%`)
          .join(", ");
        console.log(
          `${String(p.id).padStart(6)} | ${p.discontent.toFixed(4)}     | ` +
            `${p.distance.toFixed(4)}         | ${p.welfare.toFixed(4)}         | ${composition}`
        );
      }

      // ---- Инвариант 1: контрфакт по идеологической дистанции ----
      // Реальный регион клонируется так, что вся его доля отходит самой далёкой
      // от власти группе (и, отдельно, самой близкой). Меняется РОВНО один вход
      // формулы — значит любое изменение результата вызвано именно им.
      for (const { region, discontent: base } of profile) {
        const ranked = (region.demographics ?? [])
          .map((entry) => ({
            groupId: entry.groupId,
            distance: ideologyDistance(
              authorityOf(region),
              groupsById.get(entry.groupId)!.desiredIdeology
            ),
          }))
          .sort((a, b) => a.distance - b.distance);
        const nearest = ranked[0]!;
        const furthest = ranked[ranked.length - 1]!;

        const towardsFurthest = variantOf(region, {
          demographics: [{ groupId: furthest.groupId, share: 1 }],
        });
        const towardsNearest = variantOf(region, {
          demographics: [{ groupId: nearest.groupId, share: 1 }],
        });
        const dFurthest = discontentOf(towardsFurthest);
        const dNearest = discontentOf(towardsNearest);

        expect(
          dFurthest,
          `Регион ${region.id}: состав целиком из самой ДАЛЁКОЙ от власти группы ` +
            `("${furthest.groupId}", дистанция ${furthest.distance.toFixed(3)}) даёт недовольство ` +
            `${dFurthest.toFixed(4)} — ниже фактического состава (${base.toFixed(4)}). ` +
            `Недовольство обязано расти с идеологической дистанцией «власть ↔ группа» ` +
            `(shared/src/utils/discontent.ts, DISCONTENT_DISTANCE_WEIGHT).`
        ).toBeGreaterThanOrEqual(base - DISCONTENT_EPSILON);
        expect(
          dNearest,
          `Регион ${region.id}: состав целиком из самой БЛИЗКОЙ к власти группы ` +
            `("${nearest.groupId}", дистанция ${nearest.distance.toFixed(3)}) даёт недовольство ` +
            `${dNearest.toFixed(4)} — выше фактического состава (${base.toFixed(4)}).`
        ).toBeLessThanOrEqual(base + DISCONTENT_EPSILON);

        // Строгость требуем только там, где вход реально сдвинулся и результат
        // не упёрся в кламп 0..1 — иначе тест ловил бы не механику, а границы.
        if (weightedDistance(towardsFurthest) > weightedDistance(region) + DISCONTENT_EPSILON) {
          if (dFurthest < 1) {
            expect(
              dFurthest,
              `Регион ${region.id}: сдвиг состава к более далёкой группе не изменил недовольство ` +
                `вовсе (${base.toFixed(6)} → ${dFurthest.toFixed(6)}). Дистанция перестала влиять.`
            ).toBeGreaterThan(base);
          }
        }
        if (weightedDistance(towardsNearest) < weightedDistance(region) - DISCONTENT_EPSILON) {
          if (dNearest > 0) {
            expect(
              dNearest,
              `Регион ${region.id}: сдвиг состава к более близкой группе не изменил недовольство ` +
                `вовсе (${base.toFixed(6)} → ${dNearest.toFixed(6)}).`
            ).toBeLessThan(base);
          }
        }
      }

      // ---- Инвариант 2: контрфакт по экономике региона ----
      // Тот же приём по второму входу: региону меняется только ВРП.
      for (const { region, discontent: base, welfare } of profile) {
        const poorer = variantOf(region, { gdp: region.gdp * 0.01 });
        const richer = variantOf(region, { gdp: region.gdp * 100 });
        const dPoorer = discontentOf(poorer);
        const dRicher = discontentOf(richer);

        expect(
          dPoorer,
          `Регион ${region.id}: обеднение (ВРП ×0.01, благосостояние ` +
            `${welfare.toFixed(4)} → ${welfareOf(poorer).toFixed(4)}) СНИЗИЛО недовольство ` +
            `${base.toFixed(4)} → ${dPoorer.toFixed(4)}. Недовольство обязано расти с ` +
            `экономическим отставанием региона (DISCONTENT_WELFARE_WEIGHT).`
        ).toBeGreaterThanOrEqual(base - DISCONTENT_EPSILON);
        expect(
          dRicher,
          `Регион ${region.id}: обогащение (ВРП ×100) ПОВЫСИЛО недовольство ` +
            `${base.toFixed(4)} → ${dRicher.toFixed(4)}.`
        ).toBeLessThanOrEqual(base + DISCONTENT_EPSILON);

        if (welfareOf(poorer) < welfare - DISCONTENT_EPSILON && dPoorer < 1) {
          expect(
            dPoorer,
            `Регион ${region.id}: благосостояние упало, а недовольство не сдвинулось ` +
              `(${base.toFixed(6)} → ${dPoorer.toFixed(6)}). Экономика перестала влиять.`
          ).toBeGreaterThan(base);
        }
        if (welfareOf(richer) > welfare + DISCONTENT_EPSILON && dRicher > 0) {
          expect(
            dRicher,
            `Регион ${region.id}: благосостояние выросло, а недовольство не сдвинулось ` +
              `(${base.toFixed(6)} → ${dRicher.toFixed(6)}).`
          ).toBeLessThan(base);
        }
      }

      // ---- Инвариант 3: тот же порядок на реальных парах регионов ----
      // Регион, который не ближе к власти И не богаче другого, не может быть
      // спокойнее его. Это прежняя мысль «градиент, а не бинарный ярлык», но
      // сформулированная через входы механики, а не через конкретные номера.
      for (const a of profile) {
        for (const b of profile) {
          if (a.distance < b.distance - DISCONTENT_EPSILON) continue;
          if (a.welfare > b.welfare + DISCONTENT_EPSILON) continue;
          expect(
            a.discontent,
            `Регион ${a.id} не ближе к власти (дистанция ${a.distance.toFixed(4)} против ` +
              `${b.distance.toFixed(4)}) и не богаче (благосостояние ${a.welfare.toFixed(4)} против ` +
              `${b.welfare.toFixed(4)}), но спокойнее региона ${b.id}: ` +
              `${a.discontent.toFixed(4)} < ${b.discontent.toFixed(4)}. Монотонность нарушена.`
          ).toBeGreaterThanOrEqual(b.discontent - DISCONTENT_EPSILON);
        }
      }

      // ---- Инвариант 4: недовольство — свойство региона, а не страны ----
      const distances = profile.map((p) => p.distance);
      const discontents = profile.map((p) => p.discontent);
      const distanceSpread = Math.max(...distances) - Math.min(...distances);
      const discontentSpread = Math.max(...discontents) - Math.min(...discontents);
      if (distanceSpread > DISCONTENT_EPSILON) {
        expect(
          discontentSpread,
          `Размеченные регионы различаются идеологической дистанцией (разброс ` +
            `${distanceSpread.toFixed(4)}), но недовольство у всех одинаковое. Тогда «высокое ` +
            `недовольство» — свойство страны, а не региона: проверь ` +
            `DISCONTENT_DISTANCE_WEIGHT (shared/src/defines/discontent.ts).`
        ).toBeGreaterThan(0);
      }

      // Единственное, что здесь осталось от калибровки констант под сценарий
      // 1946 (shared/src/defines/discontent.ts, шапка файла): срез обязан
      // содержать И кризисные, И спокойные регионы. Утверждение о наборе, а не
      // о том, какой именно регион в какую половину попал.
      const releaseThreshold = REGION_CRISIS_DISCONTENT_THRESHOLD - REGION_CRISIS_RELEASE_HYSTERESIS;
      const inCrisis = profile.filter((p) => p.discontent >= REGION_CRISIS_DISCONTENT_THRESHOLD);
      const calm = profile.filter((p) => p.discontent < releaseThreshold);
      expect(
        inCrisis.length,
        `Ни один размеченный регион не дошёл до кризисного порога ` +
          `${REGION_CRISIS_DISCONTENT_THRESHOLD} за ${MONTHS_TO_SIMULATE} месяцев. Константы ` +
          `недовольства калибровались под обратное — это осознанная перекалибровка или регресс?`
      ).toBeGreaterThan(0);
      expect(
        calm.length,
        `Все размеченные регионы стоят выше порога снятия кризиса ${releaseThreshold.toFixed(2)} — ` +
          `кризис перестал быть свойством отдельных регионов.`
      ).toBeGreaterThan(0);

      // ---- Инвариант 5: латч согласован с порогом в обе стороны ----
      for (const p of profile) {
        if (p.discontent >= REGION_CRISIS_DISCONTENT_THRESHOLD) {
          expect(
            game.regionCrisisLatch,
            `Регион ${p.id}: недовольство ${p.discontent.toFixed(4)} не ниже порога, но латча нет`
          ).toContain(p.id);
        }
        if (game.regionCrisisLatch.includes(p.id)) {
          expect(
            p.discontent,
            `Регион ${p.id} латчен, но недовольство ${p.discontent.toFixed(4)} ниже порога снятия ` +
              `${releaseThreshold.toFixed(2)} — гистерезис не отпустил латч`
          ).toBeGreaterThanOrEqual(releaseThreshold);
        }
      }

      // ---- Инвариант 6: латч не выдаёт факт повторно ----
      for (const id of game.regionCrisisLatch) {
        const facts = game.pendingWorldFacts.filter(
          (f) => f.kind === "region_crisis" && f.regionId === id
        );
        expect(
          facts.length,
          `Регион ${id} латчен как кризисный, но факта «region_crisis» за прогон не было ни одного`
        ).toBeGreaterThan(0);
      }
      // discontentTick не меняет ни экономику, ни состав — значит недовольство
      // между этими тремя вызовами постоянно, и НИ ОДИН новый кризисный факт
      // появиться не может. Если появится — латч не держит и факт выдаётся
      // каждый месяц.
      game.pendingWorldFacts = [];
      for (let i = 0; i < 3; i++) discontentTick(game);
      expect(
        game.pendingWorldFacts.filter((f) => f.kind === "region_crisis"),
        `Латч не сдержал повтор: тик выдал кризисные факты по регионам, которые уже в кризисе`
      ).toHaveLength(0);

      // Без примитивов память воздействий не заводится вовсе: тик не копит
      // пустых записей (бюджет SAVE, docs/CONCEPT.md §7.5).
      expect(game.groupImpactMemory).toHaveLength(0);
    },
    120_000
  );
});
