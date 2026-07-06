import { useState, useCallback, useEffect } from "react";
import { type GameState } from "@shared/types/GameState";
import { TopStatBar } from "./TopStatBar";
import { ResourceTicker } from "./ResourceTicker";
import { InspectorPanel } from "./InspectorPanel";
import { getInspectorTitle } from "./inspectorTitle";
import { Window } from "./Window";
import { useWindows } from "../hooks/useWindows";
import { BudgetPanel } from "./BudgetPanel";
import { ResearchPanel } from "./ResearchPanel";
import { PlayerIntentPanel } from "./PlayerIntentPanel";
import { WorldRankingPanel } from "./WorldRankingPanel";
import { TerritoriesPanel } from "./TerritoriesPanel";
import { LLMPanel } from "./LLMPanel";
import { EventTimelinePanel } from "./EventTimelinePanel";
import { MapView } from "../map/MapView";
import {
  nextTurn,
  updateBudget,
  savePlayerIntent,
  getGameState,
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
  intent: "Намерение",
  ranking: "Мировой рейтинг",
  territories: "Территории",
  llm: "LLM-симуляция",
  timeline: "Хроника",
};

export function GameView({ game, onGameUpdate, onBack }: GameViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMapPopupOpen, setIsMapPopupOpen] = useState(false);
  const [closePopupTrigger, setClosePopupTrigger] = useState(0);
  const { windows, openOrFocus, toggle, close, focus, move, resize, isOpen } = useWindows();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }

        if (isMapPopupOpen) {
          setClosePopupTrigger(prev => prev + 1);
        } else if (windows.length > 0) {
          const activeWindow = windows.reduce(
            (max, w) => (w.zIndex > max.zIndex ? w : max),
            windows[0]
          );
          if (activeWindow) {
            close(activeWindow.id);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMapPopupOpen, windows, close]);

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
      // Сохранение бюджета не продвигает ход — отдельно от "Следующий месяц".
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления бюджета");
    }
  };

  const handleSavePlayerIntent = async (intent: string) => {
    try {
      await savePlayerIntent(intent);
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения намерения");
      throw err;
    }
  };

  const handleLlmApplied = async () => {
    try {
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления состояния");
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
            onPopupStateChange={setIsMapPopupOpen}
            closePopupTrigger={closePopupTrigger}
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
              {w.kind.type === "research" && <ResearchPanel country={playerCountry} />}
              {w.kind.type === "intent" && (
                <PlayerIntentPanel
                  regions={playerRegions}
                  intent={game.playerIntent}
                  onSave={handleSavePlayerIntent}
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
              {w.kind.type === "llm" && (
                <LLMPanel llmTurn={game.llmTurn ?? 0} onApplied={handleLlmApplied} />
              )}
              {w.kind.type === "timeline" && (
                <EventTimelinePanel
                  events={game.eventHistory}
                  countries={game.countries}
                  onSelectCountry={handleSelectCountry}
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
