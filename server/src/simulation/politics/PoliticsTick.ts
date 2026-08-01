import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { corruptionBase, legitimacyBase, stabilityBase } from "@shared/utils/politics";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { COUNTRY_POLITICS_SCALE_MAX } from "@shared/defines/discontent";
import {
  CORRUPTION_TREASURY_DRAIN,
  CORRUPTION_LOW_STABILITY_THRESHOLD,
  CORRUPTION_LOW_STABILITY_PENALTY,
  CORRUPTION_HIGH_STABILITY_THRESHOLD,
  CORRUPTION_HIGH_STABILITY_ADJUSTMENT,
  CORRUPTION_LOW_EDUCATION_SHARE_THRESHOLD,
  CORRUPTION_LOW_EDUCATION_PENALTY,
  STABILITY_LEGITIMACY_WEIGHT,
  STABILITY_CORRUPTION_WEIGHT,
  STABILITY_UNEMPLOYMENT_REFERENCE,
  STABILITY_UNEMPLOYMENT_SATURATION,
  STABILITY_UNEMPLOYMENT_WEIGHT,
  STABILITY_BUDGET_SATURATION_INCOME_SHARE,
  STABILITY_BUDGET_WEIGHT,
  STABILITY_INFLATION_REFERENCE,
  STABILITY_HIGH_INFLATION_THRESHOLD,
  STABILITY_INFLATION_WEIGHT,
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

/**
 * Отклик −1…+1: отклонение от опорной точки, поделённое на масштаб насыщения.
 * Заменил пороговые ступени — разбор причины у констант в `defines/politics.ts`.
 */
function response(value: number, reference: number, saturation: number): number {
    if (saturation <= 0) return 0;
    return clamp((value - reference) / saturation, -1, 1);
}

/**
 * Равновесие стабильности: структурный якорь сценария плюс непрерывные поправки
 * на мандат, институты и экономику.
 *
 * `countryRegions` — регионы этой страны; пустой список означает «регионы не
 * размечены», якорь тогда фолбэчный (`stabilityBase`).
 */
export function stabilityEquilibrium(country: Country, countryRegions: readonly Region[]): number {
    const { unemployment, budgetBalance, inflation } = country.economy;
    const { corruption, legitimacy } = country.politics;
    const scaleMidpoint = COUNTRY_POLITICS_SCALE_MAX / 2;

    // Якорь: авторская стабильность сценария. Он и задаёт разброс по миру —
    // поправки ниже двигают страну вокруг её собственного стартового состояния,
    // а не переписывают его.
    let eq = stabilityBase(countryRegions);

    // Мандат власти удерживает порядок дешевле принуждения; его отсутствие —
    // дороже. Отклонение от середины шкалы, полный вклад на её краях.
    eq += STABILITY_LEGITIMACY_WEIGHT * response(legitimacy, scaleMidpoint, scaleMidpoint);

    // Коррупция подтачивает институты — знак обратный легитимности.
    eq -= STABILITY_CORRUPTION_WEIGHT * response(corruption, scaleMidpoint, scaleMidpoint);

    // Безработица: ниже «естественного» уровня помогает, выше — давит, насыщение
    // на прежнем пороге «высокой» (5 + 10 = 15).
    eq -= STABILITY_UNEMPLOYMENT_WEIGHT * response(
        unemployment,
        STABILITY_UNEMPLOYMENT_REFERENCE,
        STABILITY_UNEMPLOYMENT_SATURATION
    );

    // Бюджет: доля ДОХОДА, симметрично в обе стороны. Страна без дохода
    // (сценарные микровладения) бюджетной поправки не получает — делить не на что.
    const income = country.economy.taxRevenue
        + country.economy.exportIncome
        + country.economy.stateEnterpriseIncome
        + country.economy.otherIncome;
    if (income > 0) {
        eq += STABILITY_BUDGET_WEIGHT * response(
            budgetBalance / income,
            0,
            STABILITY_BUDGET_SATURATION_INCOME_SHARE
        );
    }

    // Инфляция односторонняя: дефляция 1946 года — не заслуга власти, а
    // следствие разрушенного спроса, и премии за неё быть не должно.
    eq -= STABILITY_INFLATION_WEIGHT * Math.max(0, response(
        inflation,
        STABILITY_INFLATION_REFERENCE,
        STABILITY_HIGH_INFLATION_THRESHOLD - STABILITY_INFLATION_REFERENCE
    ));

    return clamp(eq, 0, COUNTRY_POLITICS_SCALE_MAX);
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

/**
 * `regions` — весь мир, как у `economyTick`/`populationTick`/`militaryTick`:
 * фильтрация по владельцу здесь, тем же выражением, что у них. До 2026-08-01
 * `politicsTick` был единственным тиком без регионов — и единственным, чьё
 * равновесие не зависело ни от чего сценарного.
 *
 * Параметр ОБЯЗАТЕЛЕН, а не `= []`: со значением по умолчанию забытый аргумент
 * молча дал бы фолбэчный якорь 50 всем странам — ровно тот дефект «вход
 * выродился в константу», который эта правка и закрывает.
 */
export function politicsTick(country: Country, regions: readonly Region[]): void {
    const p = country.politics;
    const e = country.economy;
    const countryRegions = regions.filter(r => r.ownerCountryId === country.id);

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
    const stabilityEq = stabilityEquilibrium(country, countryRegions);
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
