import { type Country } from "@shared/types/Country";

const IDEOLOGY_LEGITIMACY_BASE: Record<string, number> = {
    "Democracy": 70,
    "Liberal Democracy": 70,
    "Democratic": 70,
    "Communism": 60,
    "Communist": 60,
    "Nationalism": 50,
    "Fascism": 50,
    "Capitalism": 65,
    "Center-Left": 68,
    "Center-Right": 68,
};

// Структурный базис коррупции по типу режима.
// Это нижний потолок — без институциональных изменений ниже не упасть.
const GOVERNMENT_TYPE_CORRUPTION_BASE: Record<string, number> = {
    "Democracy": 20,
    "Liberal Democracy": 20,
    "Democratic": 20,
    "Communism": 40,
    "Communist": 40,
    "Nationalism": 55,
    "Fascism": 55,
    "Capitalism": 30,
    "Center-Left": 25,
    "Center-Right": 28,
};

// Утечка казны из-за коррупции: % ВВП в месяц на единицу коррупции.
// При corruption=50, GDP=1 трлн → 2.5 млрд/мес утечки.
const CORRUPTION_TREASURY_DRAIN = 0.00005;

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

    let eq = GOVERNMENT_TYPE_CORRUPTION_BASE[p.ideology] ?? 35;

    if (p.stability < 40) eq += 15;
    else if (p.stability > 70) eq -= 5;

    // Низкие расходы на образование → слабые институты → рост коррупции
    if (income > 0 && educationSpending / income < 0.05) eq += 10;

    return clamp(eq, 0, 100);
}

function stabilityEquilibrium(country: Country): number {
    const { unemployment, budgetBalance, gdp, inflation } = country.economy;
    const corruption = country.politics.corruption;

    let eq = 50;

    if (unemployment < 5) eq += 15;
    else if (unemployment > 15) eq -= 15;

    if (budgetBalance >= 0) eq += 5;
    else if (gdp > 0 && budgetBalance < -gdp * 0.05) eq -= 20;
    else eq -= 10;

    if (inflation > 20) eq -= 5;

    // Высокая коррупция подтачивает институты — давит на stability
    if (corruption > 60) eq -= 10;

    return clamp(eq, 0, 100);
}

function governmentSupportEquilibrium(country: Country): number {
    const { unemployment, budgetBalance, welfareSpending } = country.economy;
    const floor = country.economy.spendingFloor?.welfareSpending ?? 0;

    let eq = 50;

    if (unemployment < 5) eq += 10;
    else if (unemployment > 15) eq -= 10;

    if (budgetBalance < 0) eq -= 5;

    // Щедрые социальные расходы поддерживают рейтинг
    if (floor > 0 && welfareSpending > floor * 1.5) eq += 5;

    return clamp(eq, 0, 100);
}

function legitimacyBase(ideology: string): number {
    return IDEOLOGY_LEGITIMACY_BASE[ideology] ?? 55;
}

export function politicsTick(country: Country): void {
    const p = country.politics;
    const e = country.economy;

    // corruption: дрейфует к структурному равновесию (режим + stability + образование).
    // Без институциональных изменений не упадёт ниже базиса режима.
    const corruptionEq = corruptionEquilibrium(country);
    p.corruption += (corruptionEq - p.corruption) * 0.003;
    p.corruption = clamp(p.corruption, 0, 100);

    // Утечка казны из-за коррупции: пропорциональна ВВП × уровень коррупции.
    if (e.gdp > 0) {
        e.treasury -= e.gdp * p.corruption * CORRUPTION_TREASURY_DRAIN;
    }

    // stability: медленный дрейф к равновесию (учитывает corruption внутри)
    const stabilityEq = stabilityEquilibrium(country);
    p.stability += (stabilityEq - p.stability) * 0.05;
    p.stability = clamp(p.stability, 0, 100);

    // governmentSupport: чуть быстрее
    const supportEq = governmentSupportEquilibrium(country);
    p.governmentSupport += (supportEq - p.governmentSupport) * 0.08;
    p.governmentSupport = clamp(p.governmentSupport, 0, 100);

    // legitimacy: почти статична в мирное время
    const legitBase = legitimacyBase(p.ideology);
    p.legitimacy += (legitBase - p.legitimacy) * 0.005;
    p.legitimacy = clamp(p.legitimacy, 0, 100);
}
