import { describe, it, expect } from "vitest";
import { simulateMonth } from "../SimulationEngine";
import { createGame } from "../../game/CreateGame";

/**
 * Страж коридора мирового роста (калибровка 2026-08-03, ветка
 * claude/growth-calibration). До калибровки 20-летний прогон давал мировой
 * ВВП ×13,3 (исторически ×2,5–4) и население 6,0 млрд к 1966-му (реально
 * ≈3,4): экспоненты внизу искажали всё над собой — манпауэр, тиры стран,
 * выбор режиссёра.
 *
 * Тест — СВОЙСТВО (кратность роста в диапазоне), не снапшот абсолютов:
 * ни одного абсолютного ВВП или населения здесь нет, только отношения
 * «конец/старт». Горизонт 120 месяцев — компромисс цены прогона; коридоры
 * ниже — это приёмочные 240-месячные коридоры (ВВП ×2,5–4, население
 * 3,2–3,7 млрд от старта 2,3), пересчитанные на половину горизонта с
 * запасом на легитимный дрейф соседних механик:
 *   ВВП: ×2,5^0,5…×4^0,5 = 1,58…2,00 → допускаем 1,40…2,30;
 *   население: ×1,39^0,5…×1,61^0,5 = 1,18…1,27 → допускаем 1,05…1,30.
 * Замер после калибровки: ВВП ×1,80, население ×1,138 — оба у середины.
 *
 * Если тест упал после осознанной перекалибровки экономики — пересчитай
 * коридор с обоснованием в комментарии, не подгоняй молча. Если упал сам
 * по себе — какая-то механика сдвинула мировой темп, это и есть сигнал.
 */

const MONTHS = 120;

// Коридоры кратности за 120 месяцев (вывод — в шапке файла).
const WORLD_GDP_GROWTH_MIN = 1.4;
const WORLD_GDP_GROWTH_MAX = 2.3;
const WORLD_POPULATION_GROWTH_MIN = 1.05;
const WORLD_POPULATION_GROWTH_MAX = 1.3;

// Форма кривой: годовые темпы не должны отличаться в разы — излом (взрыв или
// стагнация на части горизонта, компенсированная другой частью) не пройдёт
// через проверку концов, но поймается здесь. Порог 4 — грубый: он пропускает
// плавное ускорение (исторический бэби-бум даёт ~1,5–2×), но ловит смену
// режима на порядок.
const MAX_ANNUAL_RATE_SPREAD = 4;

function worldGdp(game: ReturnType<typeof createGame>): number {
  return game.countries.reduce((s, c) => s + c.economy.gdp, 0);
}

function worldPopulation(game: ReturnType<typeof createGame>): number {
  return game.regions.reduce((s, r) => s + r.population, 0);
}

describe("growth corridor — мировой темп роста на реальном сценарии 1946", () => {
  it(
    `за ${MONTHS} месяцев мировой ВВП и население растут в исторических коридорах, без изломов`,
    () => {
      const game = createGame("1946", "USA");

      const gdp0 = worldGdp(game);
      const pop0 = worldPopulation(game);
      expect(gdp0).toBeGreaterThan(0);
      expect(pop0).toBeGreaterThan(0);

      // Годовые точки траектории — для проверки формы, не только концов.
      const gdpByYear: number[] = [gdp0];
      const popByYear: number[] = [pop0];
      for (let month = 1; month <= MONTHS; month++) {
        simulateMonth(game);
        if (month % 12 === 0) {
          gdpByYear.push(worldGdp(game));
          popByYear.push(worldPopulation(game));
        }
      }

      const gdpRatio = gdpByYear[gdpByYear.length - 1]! / gdp0;
      const popRatio = popByYear[popByYear.length - 1]! / pop0;

      expect(
        gdpRatio,
        `Мировой ВВП вырос ×${gdpRatio.toFixed(2)} за ${MONTHS} месяцев — вне коридора ` +
          `${WORLD_GDP_GROWTH_MIN}…${WORLD_GDP_GROWTH_MAX}. Калибровка 2026-08-03 давала ×1,80. ` +
          `Либо коэффициенты shared/src/defines/economy.ts тронуты, либо новая механика сдвинула ` +
          `мировой темп — пересчитай коридор осознанно, с числами в комментарии.`
      ).toBeGreaterThanOrEqual(WORLD_GDP_GROWTH_MIN);
      expect(gdpRatio).toBeLessThanOrEqual(WORLD_GDP_GROWTH_MAX);

      expect(
        popRatio,
        `Мировое население выросло ×${popRatio.toFixed(3)} за ${MONTHS} месяцев — вне коридора ` +
          `${WORLD_POPULATION_GROWTH_MIN}…${WORLD_POPULATION_GROWTH_MAX}. Калибровка 2026-08-03 ` +
          `давала ×1,138 (траектория к 3,2–3,7 млрд на 240-м месяце). См. shared/src/defines/population.ts.`
      ).toBeGreaterThanOrEqual(WORLD_POPULATION_GROWTH_MIN);
      expect(popRatio).toBeLessThanOrEqual(WORLD_POPULATION_GROWTH_MAX);

      // Форма: годовые темпы (r − 1) каждого года сравниваются между собой.
      for (const [name, series] of [
        ["ВВП", gdpByYear],
        ["население", popByYear],
      ] as const) {
        const annualRates: number[] = [];
        for (let i = 1; i < series.length; i++) {
          annualRates.push(series[i]! / series[i - 1]! - 1);
        }
        const minRate = Math.min(...annualRates);
        const maxRate = Math.max(...annualRates);
        expect(
          minRate,
          `${name}: в какой-то год мировой темп неположителен (${(minRate * 100).toFixed(2)}%/год) — ` +
            `рост перестал быть равномерным, проверь траекторию runCampaign.ts.`
        ).toBeGreaterThan(0);
        expect(
          maxRate / minRate,
          `${name}: годовые темпы различаются в ${(maxRate / minRate).toFixed(1)} раза ` +
            `(${(minRate * 100).toFixed(2)}%…${(maxRate * 100).toFixed(2)}%/год) — излом кривой. ` +
            `Плавное ускорение допустимо (порог ${MAX_ANNUAL_RATE_SPREAD}), смена режима — нет.`
        ).toBeLessThanOrEqual(MAX_ANNUAL_RATE_SPREAD);
      }
    },
    240_000 // полный сценарий 157 стран × 120 месяцев; runCampaign проходит 240 месяцев за ~11 с, запас на медленные машины.
  );
});
