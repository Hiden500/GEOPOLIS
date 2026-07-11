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

function computeScore(country: Country): number {
    const gdp = country.economy.gdp;
    const mil = country.military.manpower
        + country.military.armyStrength
        + country.military.navyStrength
        + country.military.airStrength;
    const influence = Object.values(country.diplomacy.influence).reduce((s, v) => s + v, 0);
    return gdp * TIER_SCORE_GDP_WEIGHT + mil * TIER_SCORE_MILITARY_WEIGHT + influence * TIER_SCORE_INFLUENCE_WEIGHT;
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

    const scored = countries
        .map(c => ({ country: c, score: computeScore(c) }))
        .sort((a, b) => b.score - a.score);

    scored.forEach(({ country }, i) => {
        if (i < MAJOR_COUNT) country.tier = "major";
        else if (i < MAJOR_COUNT + REGIONAL_COUNT) country.tier = "regional";
        else country.tier = "minor";
    });
}
