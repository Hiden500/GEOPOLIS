import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { Header } from "../hud/Header/Header";
import { BOOK_ORDER, type BookId } from "../hud/types";
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

export function GameView({ game, onGameUpdate, onBack }: GameViewProps) {
  const { t } = useTranslation("gameView");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMapPopupOpen, setIsMapPopupOpen] = useState(false);
  const [closePopupTrigger, setClosePopupTrigger] = useState(0);
  const { windows, openOrFocus, toggle, close, focus, move, resize } = useWindows();

  const playerCountry = game.countries.find(
    c => c.id === game.playerCountryId
  );

  const playerRegions = game.regions.filter(
    r => r.ownerCountryId === game.playerCountryId
  );

  const regionWindow = windows.find(w => w.kind.type === "region");
  const selectedRegionId = regionWindow?.kind.type === "region" ? regionWindow.kind.regionId : null;

  // Временно, пока книги не переехали в SidePanel (см. handleTabClick ниже).
  const WINDOW_TO_BOOK: Partial<Record<string, BookId>> = {
    budget: "economy",
    research: "technology",
    ranking: "rankings",
    timeline: "chronicle",
  };
  const activeBook = windows.map(w => WINDOW_TO_BOOK[w.kind.type]).find((b): b is BookId => b != null) ?? null;

  const handleNextTurn = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.turnFailed"));
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
      setError(err instanceof Error ? err.message : t("errors.budgetUpdateFailed"));
    }
  };

  const handleSavePlayerIntent = async (intent: string) => {
    try {
      await savePlayerIntent(intent);
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.intentSaveFailed"));
      throw err;
    }
  };

  const handleLlmApplied = async () => {
    try {
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.stateUpdateFailed"));
    }
  };

  const handleRegionClick = useCallback((regionId: number) => {
    openOrFocus({ type: "region", regionId });
  }, [openOrFocus]);

  const handleSelectCountry = useCallback((countryId: string) => {
    openOrFocus({ type: "country", countryId });
  }, [openOrFocus]);

  // Временная привязка вкладок шапки к старой оконной системе — до Среза 2
  // (SidePanel), когда книги переедут в выдвижную панель (docs/plans/12_UI_REDESIGN.md).
  const handleTabClick = useCallback((book: BookId) => {
    switch (book) {
      case "economy":
        toggle({ type: "budget" });
        break;
      case "technology":
        toggle({ type: "research" });
        break;
      case "rankings":
        toggle({ type: "ranking" });
        break;
      case "chronicle":
        toggle({ type: "timeline" });
        break;
      default:
        break;
    }
  }, [toggle]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "Escape") {
        if (isTyping) return;
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
        return;
      }

      // Хоткеи 1-9 переключают вкладки шапки (docs/plans/12_UI_REDESIGN.md,
      // Срез 2, эталон geopolis-1946-hud.html).
      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= BOOK_ORDER.length) {
        handleTabClick(BOOK_ORDER[digit - 1]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMapPopupOpen, windows, close, handleTabClick]);

  if (!playerCountry) {
    return (
      <div className="loading">
        {t("playerCountryNotFound")}
        <button className="back-button" onClick={onBack}>
          {t("back")}
        </button>
      </div>
    );
  }

  return (
    <div className="game-view">
      <Header
        country={playerCountry}
        currentDate={game.currentDate}
        llmTurn={game.llmTurn ?? 0}
        llmRespondedThisTurn={game.llmRespondedThisTurn}
        loading={loading}
        activeBook={activeBook}
        onTabClick={handleTabClick}
        onNextTurn={handleNextTurn}
        onOpenLlmCycle={() => toggle({ type: "llm" })}
        onOpenCountryOverview={() => handleSelectCountry(playerCountry.id)}
        onBackToMenu={onBack}
      />
      {error && <p className="game-error">{error}</p>}

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
              : t(`windowTitles.${w.kind.type}`);

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
