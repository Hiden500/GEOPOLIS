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

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function stabilityEquilibrium(country: Country): number {
    const { unemployment } = country.economy;
    const { budgetBalance, gdp, inflation } = country.economy;

    let eq = 50;

    if (unemployment < 5) eq += 15;
    else if (unemployment > 15) eq -= 15;

    if (budgetBalance >= 0) eq += 5;
    else if (gdp > 0 && budgetBalance < -gdp * 0.05) eq -= 20;
    else eq -= 10;

    if (inflation > 20) eq -= 5;

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

    // stability: медленный дрейф к равновесию
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

    // corruption: очень медленно снижается
    p.corruption = clamp(p.corruption - 0.1, 0, 100);
}
