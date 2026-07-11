/**
 * Баланс-константы PoliticsTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — план не называл их явно, но файл физически в периметре критерия
 * приёмки (server/src/simulation/**). politics.stability/legitimacy/
 * corruption/governmentSupport дрейфуют к структурному равновесию
 * (equilibrium), которое зависит от режима/экономики/друг друга — числа
 * ниже калибруют и равновесия, и скорость дрейфа к ним.
 */

export const IDEOLOGY_LEGITIMACY_BASE: Record<string, number> = {
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

/** Структурный базис коррупции по типу режима — нижний потолок без институциональных изменений. */
export const GOVERNMENT_TYPE_CORRUPTION_BASE: Record<string, number> = {
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

/** Утечка казны из-за коррупции: доля ВВП в месяц на единицу коррупции. При corruption=50, GDP=1 трлн → 2.5 млрд/мес утечки. */
export const CORRUPTION_TREASURY_DRAIN = 0.00005;

// --- corruptionEquilibrium ---
export const CORRUPTION_EQUILIBRIUM_DEFAULT = 35;
export const CORRUPTION_LOW_STABILITY_THRESHOLD = 40;
export const CORRUPTION_LOW_STABILITY_PENALTY = 15;
export const CORRUPTION_HIGH_STABILITY_THRESHOLD = 70;
export const CORRUPTION_HIGH_STABILITY_ADJUSTMENT = -5;
/** Низкие расходы на образование (доля дохода) → слабые институты → рост коррупции. */
export const CORRUPTION_LOW_EDUCATION_SHARE_THRESHOLD = 0.05;
export const CORRUPTION_LOW_EDUCATION_PENALTY = 10;

// --- stabilityEquilibrium ---
export const STABILITY_EQUILIBRIUM_DEFAULT = 50;
export const STABILITY_LOW_UNEMPLOYMENT_THRESHOLD = 5;
export const STABILITY_LOW_UNEMPLOYMENT_BONUS = 15;
export const STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD = 15;
export const STABILITY_HIGH_UNEMPLOYMENT_PENALTY = -15;
export const STABILITY_BALANCED_BUDGET_BONUS = 5;
export const STABILITY_SEVERE_DEFICIT_GDP_SHARE = 0.05;
export const STABILITY_SEVERE_DEFICIT_PENALTY = -20;
export const STABILITY_MILD_DEFICIT_PENALTY = -10;
export const STABILITY_HIGH_INFLATION_THRESHOLD = 20;
export const STABILITY_HIGH_INFLATION_PENALTY = -5;
/** Высокая коррупция подтачивает институты — давит на stability. */
export const STABILITY_HIGH_CORRUPTION_THRESHOLD = 60;
export const STABILITY_HIGH_CORRUPTION_PENALTY = -10;

// --- governmentSupportEquilibrium ---
export const GOV_SUPPORT_EQUILIBRIUM_DEFAULT = 50;
export const GOV_SUPPORT_LOW_UNEMPLOYMENT_THRESHOLD = 5;
export const GOV_SUPPORT_LOW_UNEMPLOYMENT_BONUS = 10;
export const GOV_SUPPORT_HIGH_UNEMPLOYMENT_THRESHOLD = 15;
export const GOV_SUPPORT_HIGH_UNEMPLOYMENT_PENALTY = -10;
export const GOV_SUPPORT_DEFICIT_PENALTY = -5;
/** Щедрые социальные расходы (доля сверх пола) поддерживают рейтинг. */
export const GOV_SUPPORT_GENEROUS_WELFARE_FLOOR_RATIO = 1.5;
export const GOV_SUPPORT_GENEROUS_WELFARE_BONUS = 5;

// --- legitimacyBase ---
export const LEGITIMACY_DEFAULT = 55;

// --- скорость дрейфа к равновесию (politicsTick) ---
export const CORRUPTION_DRIFT_RATE = 0.003;
export const STABILITY_DRIFT_RATE = 0.05;
export const GOV_SUPPORT_DRIFT_RATE = 0.08;
export const LEGITIMACY_DRIFT_RATE = 0.005;
