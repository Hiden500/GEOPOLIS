import { useState } from "react";
import { type Country } from "@shared/types/Country";

interface Props {
  country: Country;
  onUpdateBudget: (budget: {
    militarySpending: number;
    researchSpending: number;
    educationSpending: number;
    infrastructureSpending: number;
    welfareSpending: number;
  }) => void;
}

export function BudgetPanel({ country, onUpdateBudget }: Props) {
  const [militarySpending, setMilitarySpending] = useState(country.economy.militarySpending);
  const [researchSpending, setResearchSpending] = useState(country.economy.researchSpending);
  const [educationSpending, setEducationSpending] = useState(country.economy.educationSpending);
  const [infrastructureSpending, setInfrastructureSpending] = useState(country.economy.infrastructureSpending);
  const [welfareSpending, setWelfareSpending] = useState(country.economy.welfareSpending);

  const totalExpenses = militarySpending + researchSpending + educationSpending + infrastructureSpending + welfareSpending;
  const income = country.economy.taxRevenue + country.economy.exportIncome + country.economy.stateEnterpriseIncome + country.economy.otherIncome;
  const balance = income - totalExpenses;

  const handleSave = () => {
    onUpdateBudget({
      militarySpending,
      researchSpending,
      educationSpending,
      infrastructureSpending,
      welfareSpending
    });
  };

  const handleReset = () => {
    setMilitarySpending(country.economy.militarySpending);
    setResearchSpending(country.economy.researchSpending);
    setEducationSpending(country.economy.educationSpending);
    setInfrastructureSpending(country.economy.infrastructureSpending);
    setWelfareSpending(country.economy.welfareSpending);
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

      <div className="budget-sliders">
        <div className="slider-group">
          <label>
            Военные расходы: {Math.round(militarySpending).toLocaleString("ru-RU")}
          </label>
          <input
            type="range"
            min="0"
            max={country.economy.gdp * 0.3}
            step={1000}
            value={militarySpending}
            onChange={(e) => setMilitarySpending(Number(e.target.value))}
          />
        </div>

        <div className="slider-group">
          <label>
            Исследования: {Math.round(researchSpending).toLocaleString("ru-RU")}
          </label>
          <input
            type="range"
            min="0"
            max={country.economy.gdp * 0.2}
            step={1000}
            value={researchSpending}
            onChange={(e) => setResearchSpending(Number(e.target.value))}
          />
        </div>

        <div className="slider-group">
          <label>
            Образование: {Math.round(educationSpending).toLocaleString("ru-RU")}
          </label>
          <input
            type="range"
            min="0"
            max={country.economy.gdp * 0.2}
            step={1000}
            value={educationSpending}
            onChange={(e) => setEducationSpending(Number(e.target.value))}
          />
        </div>

        <div className="slider-group">
          <label>
            Инфраструктура: {Math.round(infrastructureSpending).toLocaleString("ru-RU")}
          </label>
          <input
            type="range"
            min="0"
            max={country.economy.gdp * 0.15}
            step={1000}
            value={infrastructureSpending}
            onChange={(e) => setInfrastructureSpending(Number(e.target.value))}
          />
        </div>

        <div className="slider-group">
          <label>
            Социальные программы: {Math.round(welfareSpending).toLocaleString("ru-RU")}
          </label>
          <input
            type="range"
            min="0"
            max={country.economy.gdp * 0.15}
            step={1000}
            value={welfareSpending}
            onChange={(e) => setWelfareSpending(Number(e.target.value))}
          />
        </div>
      </div>

      {balance < 0 && (
        <div className="budget-warning">
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
