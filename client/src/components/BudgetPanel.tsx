import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Country } from "@shared/types/Country";
import { BUDGET_SPENDING_SHARE_CAPS } from "@shared/defines/budgetSpendingShareCaps";
import { BUDGET_PRESETS } from "./budgetPresets";

interface BudgetFormState {
  military: number;
  research: number;
  education: number;
  infrastructure: number;
  welfare: number;
}

interface Props {
  country: Country;
  onUpdateBudget: (budget: BudgetFormState) => void;
}

function sharesFromCountry(country: Country): BudgetFormState {
  const shares = country.economy.spendingShares;
  if (shares) return { ...shares };

  // Страна без spendingShares (ИИ-архетип на старте, до первого сохранения
  // игроком) — приблизить текущими абсолютными *Spending / income, чтобы
  // слайдеры не стартовали с нуля при первом открытии панели.
  const income =
    country.economy.taxRevenue +
    country.economy.exportIncome +
    country.economy.stateEnterpriseIncome +
    country.economy.otherIncome;
  if (income <= 0) {
    return { military: 0, research: 0, education: 0, infrastructure: 0, welfare: 0 };
  }
  return {
    military: country.economy.militarySpending / income,
    research: country.economy.researchSpending / income,
    education: country.economy.educationSpending / income,
    infrastructure: country.economy.infrastructureSpending / income,
    welfare: country.economy.welfareSpending / income,
  };
}

const CATEGORY_FIELDS: (keyof BudgetFormState)[] = [
  "military",
  "research",
  "education",
  "infrastructure",
  "welfare",
];

// Курируемые названия пресетов (budgetPresets.ts) заданы по-русски и
// используются как React key — сопоставляем их с ключами перевода, не трогая
// сам budgetPresets.ts (вне скоупа этого файла).
const PRESET_TRANSLATION_KEYS: Record<string, string> = {
  "Военная экономика": "presets.militaryEconomy",
  "Социальное государство": "presets.welfareState",
  "Индустриализация": "presets.industrialization",
  "Аустерити": "presets.austerity",
};

export function BudgetPanel({ country, onUpdateBudget }: Props) {
  const { t, i18n } = useTranslation(["budgetPanel", "common"]);
  const [shares, setShares] = useState<BudgetFormState>(() => sharesFromCountry(country));

  const setField = (field: keyof BudgetFormState) => (value: number) => {
    setShares(prev => ({ ...prev, [field]: value }));
  };

  const income =
    country.economy.taxRevenue +
    country.economy.exportIncome +
    country.economy.stateEnterpriseIncome +
    country.economy.otherIncome;

  const discretionaryExpenses =
    (shares.military + shares.research + shares.education + shares.infrastructure + shares.welfare) * income;
  const totalExpenses = discretionaryExpenses + country.economy.debtInterest + country.economy.otherExpenses;
  const balance = income - totalExpenses;

  const handleSave = () => {
    onUpdateBudget(shares);
  };

  const handleReset = () => {
    setShares(sharesFromCountry(country));
  };

  return (
    <div className="budget-panel">
      <div className="budget-summary">
        <div className="budget-item">
          <span className="label">{t("income")}</span>
          <span className="value positive">
            {Math.round(income).toLocaleString(i18n.language)}
          </span>
        </div>
        <div className="budget-item">
          <span className="label">{t("expenses")}</span>
          <span className="value negative">
            {Math.round(totalExpenses).toLocaleString(i18n.language)}
          </span>
        </div>
        <div className="budget-item">
          <span className="label">{t("balance")}</span>
          <span className={`value ${balance >= 0 ? "positive" : "negative"}`}>
            {Math.round(balance).toLocaleString(i18n.language)}
          </span>
        </div>
      </div>

      <div className="budget-presets">
        {BUDGET_PRESETS.map(preset => (
          <button
            key={preset.name}
            type="button"
            className="budget-preset-button"
            onClick={() => setShares(preset.shares)}
          >
            {PRESET_TRANSLATION_KEYS[preset.name] ? t(PRESET_TRANSLATION_KEYS[preset.name]) : preset.name}
          </button>
        ))}
      </div>

      <div className="budget-sliders">
        {CATEGORY_FIELDS.map(field => (
          <div className="slider-group" key={field}>
            <label htmlFor={`budget-${field}`}>
              {t(`categories.${field}`)}: {(shares[field] * 100).toFixed(1)}%
              {" "}({Math.round(shares[field] * income).toLocaleString(i18n.language)})
            </label>
            <input
              id={`budget-${field}`}
              type="range"
              min="0"
              max={BUDGET_SPENDING_SHARE_CAPS[field]}
              step={0.005}
              value={shares[field]}
              onChange={(e) => setField(field)(Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      {balance < 0 && (
        <div className="budget-warning" role="alert">
          ⚠️ {t("deficitWarning", { value: Math.round(Math.abs(balance)).toLocaleString(i18n.language) })}
        </div>
      )}

      <div className="budget-actions">
        <button onClick={handleReset}>{t("reset")}</button>
        <button onClick={handleSave} className="primary">
          {t("common:save")}
        </button>
      </div>
    </div>
  );
}
