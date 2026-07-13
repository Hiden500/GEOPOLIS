/**
 * Баланс-константы EconomyTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3). Тюнингуемый баланс, не историческая истина (см. docs/ECONOMY.md,
 * docs/DECISIONS.md 2026-06-26, Q9). Перекалиброваны при переходе на модель
 * "ВВП-якорь + доли": до неё infrastructureSpending/gdp было ≈0 при любом
 * коэффициенте (другой баг масштаба), теперь не ≈0, и старый коэффициент
 * 0.5 давал нереалистичный рост (~20-50%/год). Подбирать на симуляции
 * дальше, не считать текущие значения финальными.
 */
export const BASE_GROWTH_INTERCEPT = 0.001;
export const BASE_GROWTH_DEVELOPMENT_COEFFICIENT = 0.002;
export const BASE_GROWTH_INFRASTRUCTURE_COEFFICIENT = 0.001;
export const INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT = 0.15;
export const DEFICIT_PENALTY_COEFFICIENT = 0.3;
export const SECTOR_INDUSTRY_GROWTH_COEFFICIENT = 0.002;
export const SECTOR_SERVICES_GROWTH_COEFFICIENT = 0.001;

/** Защитный потолок месячного роста — не даёт архетипу разогнаться неограниченно. */
export const MAX_MONTHLY_GROWTH_RATE = 0.05;

export const INFLATION_DEFICIT_COEFFICIENT = 0.1;
export const UNEMPLOYMENT_DEFICIT_COEFFICIENT = 0.05;

/**
 * Госдолг (docs/plans/08_WAR_WAVE1.md, Шаг 4) — тюнингуемые плейсхолдеры.
 *
 * Базовая месячная ставка по долгу (~3.7%/год) + риск-премия за плохое
 * здоровье государства: monthlyRate = BASE + PREMIUM × (1 − avgHealth/100),
 * где avgHealth = (legitimacy + stability)/2. При здоровье 0 ставка ≈ base +
 * premium (~19%/год) — слабое государство занимает дороже.
 */
export const DEBT_BASE_MONTHLY_INTEREST_RATE = 0.003;
export const DEBT_RISK_PREMIUM_COEFFICIENT = 0.013;

/**
 * Долг/ВВП, с которого начинается штраф месячному росту ВВП:
 * penalty = (debt/gdp − THRESHOLD) × COEFFICIENT (только выше порога). Тот же
 * порог — триггер аустерити ИИ (AiBehaviorTick, Правило A): когда долг начинает
 * давить рост, ИИ начинает резать дискреционные расходы.
 */
export const DEBT_GDP_PENALTY_THRESHOLD = 0.6;
export const DEBT_GDP_GROWTH_PENALTY_COEFFICIENT = 0.02;

/**
 * Долг/ВВП, при пересечении которого движок кладёт мировой факт «X на грани
 * дефолта» в промт LLM (сам дефолт — нарратив/действие LLM, план 02, шаг 4).
 */
export const DEBT_CRISIS_GDP_THRESHOLD = 1.0;
