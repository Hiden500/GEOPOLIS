import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type ScenarioInfo, type FeaturedCountry } from "@shared/types/ScenarioInfo";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { getScenarios } from "../api/gameApi";

interface ScenarioSelectorProps {
  onScenarioSelect: (scenarioId: string, countryId: string, locale: Locale) => void;
  error?: string | null;
}

// Автонимы — язык всегда подписан на самом себе ("English" не переводится
// на русский, "Русский" не переводится на английский), общепринятая практика
// для переключателя языка. Не через t() намеренно.
const LOCALE_LABELS: Record<Locale, string> = {
  ru: "Русский",
  en: "English",
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
  const { t, i18n } = useTranslation("scenarioSelector");
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
              title={getText(c.name, i18n.language as Locale)}
            >
              <span className="country-name">{getText(c.name, i18n.language as Locale)}</span>
              <span className="country-id">{c.id}</span>
              {c.tier === "major" && <span className="country-major-badge">{t("majorPowerBadge")}</span>}
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
  const { t, i18n } = useTranslation("scenarioSelector");
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("ru");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchScenarios = () => {
    getScenarios()
      .then(data => {
        setScenarios(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoadError(t("failedToLoadScenarios"));
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = () => {
    setLoading(true);
    setLoadError(null);
    fetchScenarios();
  };

  const handleStartGame = () => {
    if (selectedScenario && selectedCountry) {
      onScenarioSelect(selectedScenario, selectedCountry, locale);
    }
  };

  // Живое переключение языка экрана выбора по мере выбора — та же локаль
  // уходит и в интерфейс, и в GameState.locale (нарратив LLM), не два
  // независимых концепта (docs/LOCALIZATION.md).
  const handleLocaleSelect = (l: Locale) => {
    setLocale(l);
    void i18n.changeLanguage(l);
  };

  if (loading) {
    return <div className="loading">{t("loadingScenarios")}</div>;
  }

  if (loadError) {
    return (
      <div className="loading">
        {t("loadError", { message: loadError })}
        <p className="hint">{t("loadErrorHint")}</p>
        <button onClick={handleRetry}>{t("retry")}</button>
      </div>
    );
  }

  const currentScenario = scenarios.find(s => s.id === selectedScenario);

  const majorCountries = currentScenario?.featuredCountries.filter(c => c.tier === "major") ?? [];
  const regionalCountries = currentScenario?.featuredCountries.filter(c => c.tier === "regional") ?? [];
  const minorCountries = currentScenario?.featuredCountries.filter(c => c.tier === "minor") ?? [];

  return (
    <div className="scenario-selector">
      <h1>{t("title")}</h1>
      <h2>{t("selectScenario")}</h2>

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
          <h2>{t("selectCountry")}</h2>
          <div className="country-list">
            <CountryGroup
              label={t("tiers.major")}
              countries={majorCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded
            />
            <CountryGroup
              label={t("tiers.regional")}
              countries={regionalCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded
            />
            <CountryGroup
              label={t("tiers.minor")}
              countries={minorCountries}
              selectedCountry={selectedCountry}
              onSelect={setSelectedCountry}
              defaultExpanded={false}
            />
          </div>
        </div>
      )}

      {selectedScenario && selectedCountry && (
        <div className="locale-selection">
          <h2>{t("language")}</h2>
          <div className="locale-options">
            {(Object.keys(LOCALE_LABELS) as Locale[]).map(l => (
              <button
                key={l}
                type="button"
                className={`locale-button ${locale === l ? "selected" : ""}`}
                aria-pressed={locale === l}
                onClick={() => handleLocaleSelect(l)}
              >
                {LOCALE_LABELS[l]}
              </button>
            ))}
          </div>
          <button className="start-game-button" onClick={handleStartGame}>
            {t("startGame")}
          </button>
        </div>
      )}
    </div>
  );
}
