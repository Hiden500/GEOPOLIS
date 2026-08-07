import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { type Locale } from "@shared/types/i18n/LocalizedText";
import { ScenarioSelector } from "./components/ScenarioSelector";
import { GameShell } from "./game/GameShell";
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
      console.error(err);
      setError(t("startGameFailed"));
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
        <GameShell game={game} onGameUpdate={setGame} />
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