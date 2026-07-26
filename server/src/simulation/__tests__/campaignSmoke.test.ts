import { describe, it, expect } from "vitest";
import { simulateMonth } from "../SimulationEngine";
import { createGame } from "../../game/CreateGame";
import { type Country } from "@shared/types/Country";
import { type GameState } from "@shared/types/GameState";
import { getDomainTier } from "@shared/utils/technology";
import { regionDiscontent } from "@shared/utils/discontent";
import { REGION_CRISIS_DISCONTENT_THRESHOLD } from "@shared/defines/discontent";

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

// Прибалтика СССР с подавляющим титульным большинством (≥85%): три уезда
// Литвы, три региона Латвии, три Эстонии. Титульные нации и сталинский режим
// разделяет большая идеологическая дистанция — на ней держится кризис среза.
const TITULAR_MAJORITY_REGION_IDS = [185, 186, 187, 189, 192, 193, 68, 69, 70];

// Смешанные регионы Прибалтики: Рига (30% русских) и Латгале (35%). Ниже
// кризисного порога — и это не недоработка разметки, а работающая механика:
// недовольство региона взвешено по долям, поэтому смешанный регион не бывает
// единодушен. Порог занижать под них нельзя — проверяется градиент.
const MIXED_BALTIC_REGION_IDS = [190, 191];

// Контрольная группа: славянское большинство, малая дистанция до власти.
const CONTROL_REGION_IDS = [26, 27, 274];

// Всего размеченных регионов. Покрытие частичное по замыслу; число обновляется
// вместе с demographics.json.
const MARKED_REGION_COUNT =
  TITULAR_MAJORITY_REGION_IDS.length + MIXED_BALTIC_REGION_IDS.length + CONTROL_REGION_IDS.length;

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
   * заявленную картину и держит её многолетним прогоном.
   */
  it(
    `держит недовольство прибалтийских регионов СССР выше кризисного порога ${MONTHS_TO_SIMULATE} месяцев`,
    () => {
      const game = createGame("1946", "SUN");

      // Разметка доехала из файлов данных до состояния партии.
      expect(game.ethnicGroups.length).toBeGreaterThan(0);
      const marked = game.regions.filter((r) => r.demographics && r.demographics.length > 0);
      expect(marked.length).toBe(MARKED_REGION_COUNT);

      const discontentOf = (id: number): number => {
        const region = game.regions.find((r) => r.id === id);
        if (!region) throw new Error(`Регион ${id} не найден — датасет 1946 изменился?`);
        const value = regionDiscontent(game, region);
        if (value === undefined) throw new Error(`Регион ${id} не размечен демографией`);
        return value;
      };

      for (let i = 0; i < MONTHS_TO_SIMULATE; i++) simulateMonth(game);

      for (const id of TITULAR_MAJORITY_REGION_IDS) {
        expect(
          discontentOf(id),
          `Регион ${id} (титульное большинство, СССР): недовольство ${discontentOf(id).toFixed(3)} — ` +
            `ожидается не ниже кризисного порога ${REGION_CRISIS_DISCONTENT_THRESHOLD}. ` +
            `Изменились коэффициенты (shared/src/defines/discontent.ts) или разметка ` +
            `demographics.json/ideology.json — это осознанная калибровка или регресс?`
        ).toBeGreaterThanOrEqual(REGION_CRISIS_DISCONTENT_THRESHOLD);
        expect(game.regionCrisisLatch).toContain(id);
      }

      // Градиент, а не бинарный ярлык: смешанные регионы Прибалтики спокойнее
      // моноэтничных, но напряжённее славянской контрольной группы. Именно это
      // и утверждает модель «недовольство = доля-взвешенная геометрия», и
      // именно это сломается первым, если разметку или коэффициенты подкрутят
      // «чтобы сошлось».
      const maxControl = Math.max(...CONTROL_REGION_IDS.map(discontentOf));
      for (const id of MIXED_BALTIC_REGION_IDS) {
        expect(
          discontentOf(id),
          `Смешанный регион ${id}: недовольство ${discontentOf(id).toFixed(3)} — ожидается ` +
            `ВЫШЕ самого напряжённого контрольного региона (${maxControl.toFixed(3)})`
        ).toBeGreaterThan(maxControl);
        expect(discontentOf(id)).toBeLessThan(REGION_CRISIS_DISCONTENT_THRESHOLD);
      }

      for (const id of CONTROL_REGION_IDS) {
        expect(
          discontentOf(id),
          `Контрольный регион ${id} (славянское большинство, малая идеологическая ` +
            `дистанция): недовольство ${discontentOf(id).toFixed(3)} — ожидается НИЖЕ порога ` +
            `${REGION_CRISIS_DISCONTENT_THRESHOLD}. Иначе «высокое недовольство» перестаёт ` +
            `быть свойством конкретных регионов и становится свойством всей страны.`
        ).toBeLessThan(REGION_CRISIS_DISCONTENT_THRESHOLD);
        expect(game.regionCrisisLatch).not.toContain(id);
      }

      // Кризисный факт по каждому кризисному региону выдан ровно один раз за
      // весь прогон, а не каждый месяц — латч работает.
      for (const id of TITULAR_MAJORITY_REGION_IDS) {
        const facts = game.pendingWorldFacts.filter(
          (f) => f.kind === "region_crisis" && f.regionId === id
        );
        expect(facts, `Регион ${id}: кризисных фактов ${facts.length}, ожидается ровно 1`)
          .toHaveLength(1);
      }

      // Без примитивов память воздействий не заводится вовсе: тик не копит
      // пустых записей (бюджет SAVE, docs/CONCEPT.md §7.5).
      expect(game.groupImpactMemory).toHaveLength(0);
    },
    120_000
  );
});
