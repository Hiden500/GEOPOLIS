import { useState, useCallback } from "react";
import { type GameState } from "@shared/types/GameState";
import { TopStatBar } from "./TopStatBar";
import { ResourceTicker } from "./ResourceTicker";
import { InspectorPanel } from "./InspectorPanel";
import { getInspectorTitle } from "./inspectorTitle";
import { Window } from "./Window";
import { useWindows } from "../hooks/useWindows";
import { BudgetPanel } from "./BudgetPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ActionPanel } from "./ActionPanel";
import { WorldRankingPanel } from "./WorldRankingPanel";
import { TerritoriesPanel } from "./TerritoriesPanel";
import { MapView } from "../map/MapView";
import {
  nextTurn,
  updateBudget,
  startResearch,
  stopResearch,
  createAction,
  deleteAction,
  type BudgetUpdate,
} from "../api/gameApi";

interface GameViewProps {
  game: GameState;
  onGameUpdate: (game: GameState) => void;
  onBack: () => void;
}

const WINDOW_TITLES: Record<string, string> = {
  budget: "Бюджет",
  research: "Исследования",
  actions: "Действия",
  ranking: "Мировой рейтинг",
  territories: "Территории",
};

export function GameView({ game, onGameUpdate, onBack }: GameViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { windows, openOrFocus, toggle, close, focus, move, resize, isOpen } = useWindows();

  const playerCountry = game.countries.find(
    c => c.id === game.playerCountryId
  );

  const playerRegions = game.regions.filter(
    r => r.ownerCountryId === game.playerCountryId
  );

  const regionWindow = windows.find(w => w.kind.type === "region");
  const selectedRegionId = regionWindow?.kind.type === "region" ? regionWindow.kind.regionId : null;

  const handleNextTurn = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка хода");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBudget = async (budget: BudgetUpdate) => {
    try {
      await updateBudget(budget);
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления бюджета");
    }
  };

  const handleStartResearch = async (projectId: string) => {
    try {
      await startResearch(projectId);
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка запуска исследования");
    }
  };

  const handleStopResearch = async (projectId: string) => {
    try {
      await stopResearch(projectId);
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка остановки исследования");
    }
  };

  const handleCreateAction = async (action: {
    type: string;
    regionId: number;
    parameters?: Record<string, unknown>;
  }) => {
    try {
      await createAction(action);
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания действия");
    }
  };

  const handleDeleteAction = async (actionId: string) => {
    try {
      await deleteAction(actionId);
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления действия");
    }
  };

  const handleRegionClick = useCallback((regionId: number) => {
    openOrFocus({ type: "region", regionId });
  }, [openOrFocus]);

  const handleSelectCountry = useCallback((countryId: string) => {
    openOrFocus({ type: "country", countryId });
  }, [openOrFocus]);

  if (!playerCountry) {
    return (
      <div className="loading">
        Страна игрока не найдена
        <button className="back-button" onClick={onBack}>
          Назад
        </button>
      </div>
    );
  }

  return (
    <div className="game-view">
      <TopStatBar
        country={playerCountry}
        currentDate={game.currentDate}
        eraName={game.era.name}
        loading={loading}
        error={error}
        isOpen={isOpen}
        onBack={onBack}
        onNextTurn={handleNextTurn}
        onToggle={toggle}
        onOpenCountry={() => handleSelectCountry(playerCountry.id)}
      />

      <div className="game-content">
        <div className="map-container">
          <MapView
            regions={game.regions}
            countries={game.countries}
            mapFeatures={game.mapFeatures}
            onRegionClick={handleRegionClick}
            selectedRegionId={selectedRegionId}
          />
        </div>

        {windows.map(w => {
          const title =
            w.kind.type === "country" || w.kind.type === "region"
              ? getInspectorTitle(w.kind, game)
              : WINDOW_TITLES[w.kind.type];

          return (
            <Window
              key={w.id}
              title={title}
              position={w.position}
              size={w.size}
              zIndex={w.zIndex}
              onMove={pos => move(w.id, pos)}
              onResize={size => resize(w.id, size)}
              onFocus={() => focus(w.id)}
              onClose={() => close(w.id)}
            >
              {(w.kind.type === "country" || w.kind.type === "region") && (
                <InspectorPanel target={w.kind} game={game} onSelectCountry={handleSelectCountry} />
              )}
              {w.kind.type === "budget" && (
                <BudgetPanel country={playerCountry} onUpdateBudget={handleUpdateBudget} />
              )}
              {w.kind.type === "research" && (
                <ResearchPanel
                  country={playerCountry}
                  onStartResearch={handleStartResearch}
                  onStopResearch={handleStopResearch}
                />
              )}
              {w.kind.type === "actions" && (
                <ActionPanel
                  actions={game.playerActions || []}
                  regions={playerRegions}
                  onCreateAction={handleCreateAction}
                  onDeleteAction={handleDeleteAction}
                />
              )}
              {w.kind.type === "ranking" && (
                <WorldRankingPanel game={game} onSelectCountry={handleSelectCountry} />
              )}
              {w.kind.type === "territories" && (
                <TerritoriesPanel
                  regions={playerRegions}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={handleRegionClick}
                />
              )}
            </Window>
          );
        })}
      </div>

      <ResourceTicker stockpile={playerCountry.stockpile} />
    </div>
  );
}
