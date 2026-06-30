import { useState, useEffect } from "react";
import { type ScenarioInfo, type FeaturedCountry } from "@shared/types/ScenarioInfo";
import { getScenarios } from "../api/gameApi";

interface ScenarioSelectorProps {
  onScenarioSelect: (scenarioId: string, countryId: string) => void;
  error?: string | null;
}

const TIER_LABELS: Record<string, string> = {
  major: "Великие державы",
  regional: "Региональные державы",
  minor: "Малые государства",
};

function CountryGroup({
  label,
  countries,
  selectedCountry,
  onSelect,
  defaultExpanded = true,
}: {
  label: string;
  countries: FeaturedCountry[];
  selectedCountry: string | null;
  onSelect: (id: string) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (countries.length === 0) return null;

  return (
    <div className="country-group">
      <button
        type="button"
        className="country-group-header"
        onClick={() => setExpanded(e => !e)}
      >
        <span>{label}</span>
        <span className="country-group-count">({countries.length})</span>
        <span className="country-group-toggle">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="country-group-list">
          {countries.map(c => (
            <button
              key={c.id}
              className={`country-button ${c.tier || ""} ${selectedCountry === c.id ? "selected" : ""}`}
              onClick={() => onSelect(c.id)}
              title={c.name}
            >
              <span className="country-name">{c.name}</span>
              <span className="country-id">{c.id}</span>
              {c.tier === "major" && <span className="country-major-badge">★ Великая держава</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScenarioSelector({
  onScenarioSelect,
  error,
}: ScenarioSelectorProps) {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchScenarios = () => {
    getScenarios()
      .then(data => {
        setScenarios(data);
        setLoading(false);
      })
      .catch(err => {
        setLoadError(
          err instanceof Error ? err.message : "Не удалось загрузить сценарии"
        );
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchScenarios();
  }, []);

  const handleRetry = () => {
    setLoading(true);
    setLoadError(null);
    fetchScenarios();
  };

  const handleStartGame = () => {
    if (selectedScenario && selectedCountry) {
      onScenarioSelect(selectedScenario, selectedCountry);
    }
  };

  if (loading) {
    return <div className="loading">Загрузка сценариев...</div>;
  }

  if (loadError) {
    return (
      <div className="loading">
        Ошибка: {loadError}
        <p className="hint">Убедитесь, что сервер запущен (npm run dev в server/)</p>
        <button onClick={handleRetry}>Повторить попытку</button>
      </div>
    );
  }

  const currentScenario = scenarios.find(s => s.id === selectedScenario);

  const majorCountries = currentScenario?.featuredCountries.filter(c => c.tier === "major") ?? [];
  const regionalCountries = currentScenario?.featuredCountries.filter(c => c.tier === "regional") ?? [];
  const minorCountries = currentScenario?.featuredCountries.filter(c => c.tier === "minor") ?? [];

  return (
    <div className="scenario-selector">
      <h1>Geopolis</h1>
      <h2>Выберите сценарий</h2>

      {error && <p className="selector-error">{error}</p>}

      <div className="scenario-list">
        {scenarios.map(scenario => (
          <button
            key={scenario.id}
            type="button"
            className={`scenario-card ${selectedScenario === scenario.id ? "selected" : ""}`}
            aria-pressed={selectedScenario === scenario.id}
            onClick={() => {
              setSelectedScenario(scenario.id);
              setSelectedCountry(null);
            }}
          >
            <h3>{scenario.name}</h3>
            <p className="scenario-period">
              {scenario.startDate} — {scenario.endDate}
            </p>
            <p className="scenario-era">{scenario.era}</p>
            <p className="scenario-description">{scenario.description}</p>
          </button>
        ))}
      </div>

      {currentScenario && (
        <div className="country-selection">
          <h2>Выберите страну</h2>
          <div className="country-list">
            <CountryGroup
              label={TIER_LABELS.major}
              countries={majorCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded
            />
            <CountryGroup
              label={TIER_LABELS.regional}
              countries={regionalCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded
            />
            <CountryGroup
              label={TIER_LABELS.minor}
              countries={minorCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded={false}
            />
          </div>
        </div>
      )}

      {selectedScenario && selectedCountry && (
        <button className="start-game-button" onClick={handleStartGame}>
          Начать игру
        </button>
      )}
    </div>
  );
}
