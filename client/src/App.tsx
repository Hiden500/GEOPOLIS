import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { ScenarioSelector } from "./components/ScenarioSelector";
import { GameView } from "./components/GameView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startGame } from "./api/gameApi";
import "./App.css";

export default function App() {
  const { t, i18n } = useTranslation("app");
  const [game, setGame] = useState<GameState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подстраховка (docs/LOCALIZATION.md): если партия оказалась загружена без
  // прохода через ScenarioSelector (например, восстановление сессии в
  // будущем), интерфейс всё равно подстроится под её locale.
  useEffect(() => {
    if (game) void i18n.changeLanguage(game.locale);
  }, [game, i18n]);

  const handleScenarioSelect = async (
    scenarioId: string,
    countryId: string,
    locale: Locale
  ) => {
    setStarting(true);
    setError(null);
    try {
      const state = await startGame(scenarioId, countryId, locale);
      setGame(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("startGameFailed"));
    } finally {
      setStarting(false);
    }
  };

  const handleBack = () => {
    setGame(null);
    setError(null);
  };

  if (game) {
    return (
      <ErrorBoundary onReset={handleBack}>
        <GameView game={game} onGameUpdate={setGame} onBack={handleBack} />
      </ErrorBoundary>
    );
  }

  return (
    <>
      {starting && <div className="loading">{t("creatingWorld")}</div>}
      {!starting && (
        <ScenarioSelector
          onScenarioSelect={handleScenarioSelect}
          error={error}
        />
      )}
    </>
  );
}