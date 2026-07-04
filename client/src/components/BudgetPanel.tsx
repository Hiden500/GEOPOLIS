import { useState } from "react";
import { type Country } from "@shared/types/Country";
import { BUDGET_SPENDING_SHARE_CAPS } from "@shared/constants/budgetSpendingShareCaps";
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

const CATEGORY_LABELS: Record<keyof BudgetFormState, string> = {
  military: "Военные расходы",
  research: "Исследования",
  education: "Образование",
  infrastructure: "Инфраструктура",
  welfare: "Социальные программы",
};

export function BudgetPanel({ country, onUpdateBudget }: Props) {
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
      <h2>Бюджет</h2>

      <div className="budget-summary">
        <div className="budget-item">
          <span className="label">Доходы:</span>
          <span className="value positive">
            {Math.round(income).toLocaleString("ru-RU")}
          </span>
        </div>
        <div className="budget-item">
          <span className="label">Расходы:</span>
          <span className="value negative">
            {Math.round(totalExpenses).toLocaleString("ru-RU")}
          </span>
        </div>
        <div className="budget-item">
          <span className="label">Баланс:</span>
          <span className={`value ${balance >= 0 ? "positive" : "negative"}`}>
            {Math.round(balance).toLocaleString("ru-RU")}
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
            {preset.name}
          </button>
        ))}
      </div>

      <div className="budget-sliders">
        {(Object.keys(CATEGORY_LABELS) as (keyof BudgetFormState)[]).map(field => (
          <div className="slider-group" key={field}>
            <label htmlFor={`budget-${field}`}>
              {CATEGORY_LABELS[field]}: {(shares[field] * 100).toFixed(1)}%
              {" "}({Math.round(shares[field] * income).toLocaleString("ru-RU")})
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
          ⚠️ Дефицит бюджета: {Math.round(Math.abs(balance)).toLocaleString("ru-RU")}
        </div>
      )}

      <div className="budget-actions">
        <button onClick={handleReset}>Сбросить</button>
        <button onClick={handleSave} className="primary">
          Сохранить
        </button>
      </div>
    </div>
  );
}
