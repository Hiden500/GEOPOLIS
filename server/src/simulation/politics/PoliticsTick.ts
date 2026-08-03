import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { type GameState } from "@shared/types/GameState";
import { corruptionBase, legitimacyBase, stabilityBase } from "@shared/utils/politics";
import { regionDiscontent, resolveIdeologyCoordinates } from "@shared/utils/discontent";
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
  GOV_SUPPORT_UNEMPLOYMENT_WEIGHT,
  GOV_SUPPORT_BUDGET_WEIGHT,
  GOV_SUPPORT_WELFARE_REFERENCE_FLOOR_RATIO,
  GOV_SUPPORT_WELFARE_SATURATION_FLOOR_RATIO,
  GOV_SUPPORT_WELFARE_WEIGHT,
  GOV_SUPPORT_DISCONTENT_REFERENCE,
  GOV_SUPPORT_DISCONTENT_SATURATION,
  GOV_SUPPORT_DISCONTENT_WEIGHT,
  GOV_SUPPORT_STABILITY_TREND_SATURATION,
  GOV_SUPPORT_STABILITY_TREND_WEIGHT,
  GOV_SUPPORT_OCCUPATION_SATURATION_POP_SHARE,
  GOV_SUPPORT_OCCUPATION_WEIGHT,
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

/**
 * Население-взвешенное недовольство размеченных регионов страны (0..1).
 * `undefined` — ни один регион страны не размечен демографией: это
 * «неизвестно», а не «довольны», и вклад тогда нейтрален — та же трактовка
 * отсутствия данных, что у `stabilityBase` и `corruptionBase`.
 */
function countryDiscontent(game: GameState, countryRegions: readonly Region[]): number | undefined {
    let population = 0;
    let weighted = 0;
    for (const region of countryRegions) {
        const discontent = regionDiscontent(game, region);
        if (discontent === undefined) continue;
        population += region.population;
        weighted += discontent * region.population;
    }
    if (population <= 0) return undefined;
    return weighted / population;
}

/** Доля населения страны под чужой оккупацией — «война на своей территории». */
function occupiedPopulationShare(countryId: string, countryRegions: readonly Region[]): number {
    let population = 0;
    let occupied = 0;
    for (const region of countryRegions) {
        population += region.population;
        if (region.occupiedBy !== undefined && region.occupiedBy !== countryId) {
            occupied += region.population;
        }
    }
    if (population <= 0) return 0;
    return occupied / population;
}

/**
 * Равновесие рейтинга правительства: якорь 50 плюс непрерывные отклики на
 * экономику, недовольство регионов, динамику стабильности и войну на своей
 * территории. Пороговых ступеней нет — на живом мире они выдавали одно число
 * всем 157 странам; разбор и калибровка весов — у констант `GOV_SUPPORT_*`
 * в `defines/politics.ts`.
 *
 * `governmentSupport` — ВЫХОД политической системы, не вход: он читает
 * стабильность и недовольство, но сам не питает ни стабильность, ни экономику
 * (единственные потребители — политическая цена реформ и штраф мирного
 * договора). Замкнуть петлю обратно — отдельное решение, не побочный эффект.
 */
export function governmentSupportEquilibrium(
    country: Country,
    countryRegions: readonly Region[],
    game: GameState
): number {
    const { unemployment, budgetBalance, welfareSpending } = country.economy;

    let eq = GOV_SUPPORT_EQUILIBRIUM_DEFAULT;

    // Безработица: та же опорная точка «естественного» уровня и то же
    // насыщение, что у стабильности, — это факты мира, а не ручки формулы.
    eq -= GOV_SUPPORT_UNEMPLOYMENT_WEIGHT * response(
        unemployment,
        STABILITY_UNEMPLOYMENT_REFERENCE,
        STABILITY_UNEMPLOYMENT_SATURATION
    );

    const income = country.economy.taxRevenue
        + country.economy.exportIncome
        + country.economy.stateEnterpriseIncome
        + country.economy.otherIncome;
    if (income > 0) {
        // Бюджет: доля дохода, симметрично — профицит хвалят, дефицит винят.
        eq += GOV_SUPPORT_BUDGET_WEIGHT * response(
            budgetBalance / income,
            0,
            STABILITY_BUDGET_SATURATION_INCOME_SHARE
        );

        // Welfare: ДОЛЯ дохода против пола Правила A (пол — тоже доля с
        // 2026-08-01; прежний код сравнивал деньги с долей и был истинен у
        // всех). Нейтральна стартовая авторская доля (= 2 пола), урезание к
        // полу штрафуется, щедрость сверх старта вознаграждается.
        const floor = country.economy.spendingFloor?.welfareSpending ?? 0;
        if (floor > 0) {
            eq += GOV_SUPPORT_WELFARE_WEIGHT * response(
                welfareSpending / income / floor,
                GOV_SUPPORT_WELFARE_REFERENCE_FLOOR_RATIO,
                GOV_SUPPORT_WELFARE_SATURATION_FLOOR_RATIO
            );
        }
    }

    // Недовольство регионов — главный статический различитель (157 различных
    // значений на живом сценарии): чем недовольнее население, тем ниже рейтинг.
    const discontent = countryDiscontent(game, countryRegions);
    if (discontent !== undefined) {
        eq -= GOV_SUPPORT_DISCONTENT_WEIGHT * response(
            discontent,
            GOV_SUPPORT_DISCONTENT_REFERENCE,
            GOV_SUPPORT_DISCONTENT_SATURATION
        );
    }

    // Динамика стабильности: она дрейфует к своему равновесию, поэтому знак
    // зазора «равновесие − текущая» и есть направление движения. Падает —
    // население винит правительство, растёт — хвалит; в покое зазор и вклад
    // гаснут, различение на покое несут статические входы выше.
    const stabilityTrend = stabilityEquilibrium(country, countryRegions) - country.politics.stability;
    eq += GOV_SUPPORT_STABILITY_TREND_WEIGHT * response(
        stabilityTrend,
        0,
        GOV_SUPPORT_STABILITY_TREND_SATURATION
    );

    // Война на своей территории: односторонний штраф по доле населения под
    // оккупантом — мир на своей земле норма, а не заслуга.
    eq -= GOV_SUPPORT_OCCUPATION_WEIGHT * Math.max(0, response(
        occupiedPopulationShare(country.id, countryRegions),
        0,
        GOV_SUPPORT_OCCUPATION_SATURATION_POP_SHARE
    ));

    return clamp(eq, 0, 100);
}

/**
 * `game` — вся партия, а не только регионы (расширено 2026-08-03): равновесие
 * рейтинга читает недовольство регионов, а вывод недовольства требует каталога
 * групп и памяти воздействий (`regionDiscontent`). Фильтрация регионов по
 * владельцу — здесь, тем же выражением, что у `economyTick`/`populationTick`/
 * `militaryTick`.
 *
 * Параметр ОБЯЗАТЕЛЕН, а не опционален: со значением по умолчанию забытый
 * аргумент молча дал бы всем странам нейтральные входы — ровно тот дефект
 * «вход выродился в константу», который правки 2026-08-01/2026-08-03 закрывают.
 */
export function politicsTick(country: Country, game: GameState): void {
    const p = country.politics;
    const e = country.economy;
    const countryRegions = game.regions.filter(r => r.ownerCountryId === country.id);

    // corruption: дрейфует к структурному равновесию (режим + stability + образование).
    // Без институциональных изменений не упадёт ниже базиса режима.
    const corruptionEq = corruptionEquilibrium(country);
    p.corruption += (corruptionEq - p.corruption) * CORRUPTION_DRIFT_RATE;
    p.corruption = clamp(p.corruption, 0, 100);

    // Утечка казны из-за коррупции: пропорциональна ВВП × уровень коррупции.
    if (e.gdp > 0) {
        e.treasury -= e.gdp * p.corruption * CORRUPTION_TREASURY_DRAIN;
    }

    // stability: медленный дрейф к равновесию (учитывает corruption внутри).
    // Равновесие рейтинга считается ДО применения дрейфа — оба равновесия
    // читают один и тот же снимок политики, и динамический вход «стабильность
    // движется» видит зазор этого месяца, а не уже подъеденный дрейфом.
    const stabilityEq = stabilityEquilibrium(country, countryRegions);
    const supportEq = governmentSupportEquilibrium(country, countryRegions, game);
    p.stability += (stabilityEq - p.stability) * STABILITY_DRIFT_RATE;
    p.stability = clamp(p.stability, 0, 100);

    // governmentSupport: чуть быстрее
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
