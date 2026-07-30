import { type Country } from "@shared/types/Country";
import { corruptionBase, legitimacyBase } from "@shared/utils/politics";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import {
  CORRUPTION_TREASURY_DRAIN,
  CORRUPTION_LOW_STABILITY_THRESHOLD,
  CORRUPTION_LOW_STABILITY_PENALTY,
  CORRUPTION_HIGH_STABILITY_THRESHOLD,
  CORRUPTION_HIGH_STABILITY_ADJUSTMENT,
  CORRUPTION_LOW_EDUCATION_SHARE_THRESHOLD,
  CORRUPTION_LOW_EDUCATION_PENALTY,
  STABILITY_EQUILIBRIUM_DEFAULT,
  STABILITY_LOW_UNEMPLOYMENT_THRESHOLD,
  STABILITY_LOW_UNEMPLOYMENT_BONUS,
  STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD,
  STABILITY_HIGH_UNEMPLOYMENT_PENALTY,
  STABILITY_BALANCED_BUDGET_BONUS,
  STABILITY_SEVERE_DEFICIT_GDP_SHARE,
  STABILITY_SEVERE_DEFICIT_PENALTY,
  STABILITY_MILD_DEFICIT_PENALTY,
  STABILITY_HIGH_INFLATION_THRESHOLD,
  STABILITY_HIGH_INFLATION_PENALTY,
  STABILITY_HIGH_CORRUPTION_THRESHOLD,
  STABILITY_HIGH_CORRUPTION_PENALTY,
  GOV_SUPPORT_EQUILIBRIUM_DEFAULT,
  GOV_SUPPORT_LOW_UNEMPLOYMENT_THRESHOLD,
  GOV_SUPPORT_LOW_UNEMPLOYMENT_BONUS,
  GOV_SUPPORT_HIGH_UNEMPLOYMENT_THRESHOLD,
  GOV_SUPPORT_HIGH_UNEMPLOYMENT_PENALTY,
  GOV_SUPPORT_DEFICIT_PENALTY,
  GOV_SUPPORT_GENEROUS_WELFARE_FLOOR_RATIO,
  GOV_SUPPORT_GENEROUS_WELFARE_BONUS,
  CORRUPTION_DRIFT_RATE,
  STABILITY_DRIFT_RATE,
  GOV_SUPPORT_DRIFT_RATE,
  LEGITIMACY_DRIFT_RATE,
} from "@shared/defines/politics";

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function corruptionEquilibrium(country: Country): number {
    const p = country.politics;
    const { educationSpending } = country.economy;
    const income = country.economy.taxRevenue
        + country.economy.exportIncome
        + country.economy.stateEnterpriseIncome
        + country.economy.otherIncome;

    // Базис — по МЕХАНИЗМУ удержания власти, а не по ярлыку идеологии
    // (переведено 2026-07-30: по ярлыку 78 стран из 157 падали в дефолт).
    let eq = corruptionBase(p.powerStructure);

    if (p.stability < CORRUPTION_LOW_STABILITY_THRESHOLD) eq += CORRUPTION_LOW_STABILITY_PENALTY;
    else if (p.stability > CORRUPTION_HIGH_STABILITY_THRESHOLD) eq += CORRUPTION_HIGH_STABILITY_ADJUSTMENT;

    // Низкие расходы на образование → слабые институты → рост коррупции
    if (income > 0 && educationSpending / income < CORRUPTION_LOW_EDUCATION_SHARE_THRESHOLD) {
      eq += CORRUPTION_LOW_EDUCATION_PENALTY;
    }

    return clamp(eq, 0, 100);
}

function stabilityEquilibrium(country: Country): number {
    const { unemployment, budgetBalance, gdp, inflation } = country.economy;
    const corruption = country.politics.corruption;

    let eq = STABILITY_EQUILIBRIUM_DEFAULT;

    if (unemployment < STABILITY_LOW_UNEMPLOYMENT_THRESHOLD) eq += STABILITY_LOW_UNEMPLOYMENT_BONUS;
    else if (unemployment > STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD) eq += STABILITY_HIGH_UNEMPLOYMENT_PENALTY;

    if (budgetBalance >= 0) eq += STABILITY_BALANCED_BUDGET_BONUS;
    else if (gdp > 0 && budgetBalance < -gdp * STABILITY_SEVERE_DEFICIT_GDP_SHARE) eq += STABILITY_SEVERE_DEFICIT_PENALTY;
    else eq += STABILITY_MILD_DEFICIT_PENALTY;

    if (inflation > STABILITY_HIGH_INFLATION_THRESHOLD) eq += STABILITY_HIGH_INFLATION_PENALTY;

    // Высокая коррупция подтачивает институты — давит на stability
    if (corruption > STABILITY_HIGH_CORRUPTION_THRESHOLD) eq += STABILITY_HIGH_CORRUPTION_PENALTY;

    return clamp(eq, 0, 100);
}

function governmentSupportEquilibrium(country: Country): number {
    const { unemployment, budgetBalance, welfareSpending } = country.economy;
    const floor = country.economy.spendingFloor?.welfareSpending ?? 0;

    let eq = GOV_SUPPORT_EQUILIBRIUM_DEFAULT;

    if (unemployment < GOV_SUPPORT_LOW_UNEMPLOYMENT_THRESHOLD) eq += GOV_SUPPORT_LOW_UNEMPLOYMENT_BONUS;
    else if (unemployment > GOV_SUPPORT_HIGH_UNEMPLOYMENT_THRESHOLD) eq += GOV_SUPPORT_HIGH_UNEMPLOYMENT_PENALTY;

    if (budgetBalance < 0) eq += GOV_SUPPORT_DEFICIT_PENALTY;

    // Щедрые социальные расходы поддерживают рейтинг
    if (floor > 0 && welfareSpending > floor * GOV_SUPPORT_GENEROUS_WELFARE_FLOOR_RATIO) {
      eq += GOV_SUPPORT_GENEROUS_WELFARE_BONUS;
    }

    return clamp(eq, 0, 100);
}

export function politicsTick(country: Country): void {
    const p = country.politics;
    const e = country.economy;

    // corruption: дрейфует к структурному равновесию (режим + stability + образование).
    // Без институциональных изменений не упадёт ниже базиса режима.
    const corruptionEq = corruptionEquilibrium(country);
    p.corruption += (corruptionEq - p.corruption) * CORRUPTION_DRIFT_RATE;
    p.corruption = clamp(p.corruption, 0, 100);

    // Утечка казны из-за коррупции: пропорциональна ВВП × уровень коррупции.
    if (e.gdp > 0) {
        e.treasury -= e.gdp * p.corruption * CORRUPTION_TREASURY_DRAIN;
    }

    // stability: медленный дрейф к равновесию (учитывает corruption внутри)
    const stabilityEq = stabilityEquilibrium(country);
    p.stability += (stabilityEq - p.stability) * STABILITY_DRIFT_RATE;
    p.stability = clamp(p.stability, 0, 100);

    // governmentSupport: чуть быстрее
    const supportEq = governmentSupportEquilibrium(country);
    p.governmentSupport += (supportEq - p.governmentSupport) * GOV_SUPPORT_DRIFT_RATE;
    p.governmentSupport = clamp(p.governmentSupport, 0, 100);

    // legitimacy: почти статична в мирное время. База — позиция на спектре
    // (координаты, у страны без них — фолбэк по ярлыку) плюс поправка на
    // происхождение власти: у колониальной и оккупационной администрации
    // мандата нет, каким бы либеральным ни был их метрополийный оригинал.
    const legitBase = legitimacyBase(resolveIdeologyCoordinates(p), p.powerStructure);
    p.legitimacy += (legitBase - p.legitimacy) * LEGITIMACY_DRIFT_RATE;
    p.legitimacy = clamp(p.legitimacy, 0, 100);
}
