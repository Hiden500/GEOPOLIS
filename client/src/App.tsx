import { useState } from "react";
import { type GameState } from "@shared/types/GameState";
import { ScenarioSelector } from "./components/ScenarioSelector";
import { GameView } from "./components/GameView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startGame } from "./api/gameApi";
import "./App.css";

export default function App() {
  const [game, setGame] = useState<GameState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScenarioSelect = async (
    scenarioId: string,
    countryId: string
  ) => {
    setStarting(true);
    setError(null);
    try {
      const state = await startGame(scenarioId, countryId);
      setGame(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось начать игру");
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
      {starting && <div className="loading">Создание мира...</div>}
      {!starting && (
        <ScenarioSelector
          onScenarioSelect={handleScenarioSelect}
          error={error}
        />
      )}
    </>
  );
}