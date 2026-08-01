import { type Country, type CountryTier } from "@shared/types/Country";
import {
  MAJOR_COUNT,
  REGIONAL_COUNT,
  TIER_SCORE_GDP_WEIGHT,
  TIER_SCORE_MILITARY_WEIGHT,
  TIER_SCORE_INFLUENCE_WEIGHT,
} from "@shared/defines/tier";

/** Исторические стартовые тиры для сценария 1946.
 *  Используются при нулевых экономических данных (пайплайн-плейсхолдеры). */
const HISTORICAL_TIERS_1946: Record<string, CountryTier> = {
    // Великие державы
    USA: "major", SUN: "major", GBR: "major", FRA: "major", CHN: "major",
    JPN: "major", ITA: "major", BRA: "major", ARG: "major", CAN: "major",
    // Региональные державы
    AUS: "regional", MEX: "regional", ZAF: "regional", EGY: "regional",
    TUR: "regional", IRN: "regional", POL: "regional", CSK: "regional",
    YUG: "regional", BGR: "regional", ROU: "regional", HUN: "regional",
    SWE: "regional", ESP: "regional", BEL: "regional", NLD: "regional",
    DNK: "regional", NOR: "regional", AUT: "regional", GRC: "regional",
    IRQ: "regional", SAU: "regional",
    // Зоны оккупации Германии — региональные (значимы дипломатически)
    QGA: "regional", QGB: "regional", QGF: "regional", QGS: "regional",
};

/** Сырые компоненты силы страны — до приведения к общей шкале. */
function rawComponents(country: Country): { gdp: number; military: number; influence: number } {
    return {
        gdp: Math.max(0, country.economy.gdp),
        military: Math.max(0, country.military.manpower
            + country.military.armyStrength
            + country.military.navyStrength
            + country.military.airStrength),
        influence: Math.max(0, Object.values(country.diplomacy.influence).reduce((s, v) => s + v, 0)),
    };
}

/** Мировые суммы компонентов — знаменатели нормализации. */
export interface TierScoreTotals {
    gdp: number;
    military: number;
    influence: number;
}

export function computeTierTotals(countries: Country[]): TierScoreTotals {
    const totals: TierScoreTotals = { gdp: 0, military: 0, influence: 0 };
    for (const country of countries) {
        const raw = rawComponents(country);
        totals.gdp += raw.gdp;
        totals.military += raw.military;
        totals.influence += raw.influence;
    }
    return totals;
}

/**
 * Скор страны для годового пересчёта тиров — ДОЛИ МИРА, а не сырые единицы.
 *
 * ЗАЧЕМ НОРМАЛИЗАЦИЯ. Компоненты живут в несопоставимых порядках: ВВП ~10¹¹,
 * военная сила ~10⁵, влияние ~10². В сумме сырых чисел ВВП перевешивал
 * остальные два слагаемых на шесть порядков, поэтому веса 0.5/0.3/0.2 были
 * декоративны, а итоговый ранг совпадал с рангом по одному ВВП. Замер
 * (`server/scripts/probeScales.ts`, сценарий 1946): ранговая корреляция
 * Спирмена ровно 1,0000, совпало 157 мест из 157 на старте, верхушка 35 из 35.
 * Цена дефекта не косметическая — тир `major` определяет, кто получает ход LLM.
 *
 * Каждый компонент делится на мировую сумму, поэтому все три попадают в [0, 1]
 * и веса начинают значить ровно то, что написано. Доля мира, а не деление на
 * максимум: доля устойчива к появлению и исчезновению одной сверхдержавы и
 * читается сама по себе («держит X% мирового ВВП»).
 *
 * Нулевая мировая сумма (компонент ещё не наполнен данными) обнуляет слагаемое
 * для всех, а не даёт NaN.
 */
export function computeScore(country: Country, totals: TierScoreTotals): number {
    const raw = rawComponents(country);
    const share = (value: number, total: number): number => (total > 0 ? value / total : 0);

    return share(raw.gdp, totals.gdp) * TIER_SCORE_GDP_WEIGHT
        + share(raw.military, totals.military) * TIER_SCORE_MILITARY_WEIGHT
        + share(raw.influence, totals.influence) * TIER_SCORE_INFLUENCE_WEIGHT;
}

function hasRealData(country: Country): boolean {
    return country.economy.gdp > 0 || country.military.manpower > 0;
}

export function assignInitialTiers(countries: Country[], scenarioId: string): void {
    const historicalMap = scenarioId === "1946" ? HISTORICAL_TIERS_1946 : {};

    for (const country of countries) {
        country.tier = historicalMap[country.id] ?? "minor";
    }
}

/** Пересчитывает тиры по текущим данным. Вызывается раз в год (январь).
 *  Пропускает пересчёт, если данные всё ещё нулевые. */
export function tierTick(countries: Country[]): void {
    if (!countries.some(hasRealData)) return;

    // Знаменатели считаются один раз по всему миру, потом применяются к каждой
    // стране: нормализация имеет смысл только относительно общего мира.
    const totals = computeTierTotals(countries);

    const scored = countries
        .map(c => ({ country: c, score: computeScore(c, totals) }))
        .sort((a, b) => b.score - a.score);

    scored.forEach(({ country }, i) => {
        if (i < MAJOR_COUNT) country.tier = "major";
        else if (i < MAJOR_COUNT + REGIONAL_COUNT) country.tier = "regional";
        else country.tier = "minor";
    });
}
