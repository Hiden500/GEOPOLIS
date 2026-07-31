import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type maplibregl from "maplibre-gl";
import { type GameState } from "@shared/types/GameState";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { Header } from "../hud/Header/Header";
import { SidePanel } from "../hud/SidePanel/SidePanel";
import { BookPlaceholder } from "../hud/SidePanel/BookPlaceholder";
import { PoliticsBook } from "../hud/SidePanel/books/PoliticsBook";
import { DiplomacyBook } from "../hud/SidePanel/books/DiplomacyBook";
import { IndustryBook } from "../hud/SidePanel/books/IndustryBook";
import { ContextPanel } from "../hud/ContextPanel/ContextPanel";
import { OrdersBox } from "../hud/OrdersBox/OrdersBox";
import { MapControls } from "../hud/MapControls/MapControls";
import { ErrorToast } from "../hud/ErrorToast/ErrorToast";
import { Onboarding } from "../hud/Onboarding/Onboarding";
import { shouldStartOnboarding } from "../hud/Onboarding/onboardingState";
import { BOOK_ORDER, BOOKS_WITHOUT_CONTENT, type BookId, type Selection } from "../hud/types";
import { computeMapModeColors, type MapMode } from "../hud/mapModeColors";
import { ResourceTicker } from "./ResourceTicker";
import { InspectorPanel } from "./InspectorPanel";
import { getInspectorTitle } from "./inspectorTitle";
import { Window } from "./Window";
import { useWindows } from "../hooks/useWindows";
import { BudgetPanel } from "./BudgetPanel";
import { ResearchPanel } from "./ResearchPanel";
import { PlayerIntentPanel } from "./PlayerIntentPanel";
import { PrimitiveOrdersPanel } from "./PrimitiveOrdersPanel";
import { CampaignStatePanel } from "./CampaignStatePanel";
import { WorldRankingPanel } from "./WorldRankingPanel";
import { TerritoriesPanel } from "./TerritoriesPanel";
import { LLMPanel } from "./LLMPanel";
import { EventTimelinePanel } from "./EventTimelinePanel";
import { MapView } from "../map/MapView";
import { NationalBriefing } from "../hud/NationalBriefing/NationalBriefing";
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
  const { t, i18n } = useTranslation("gameView");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMapPopupOpen, setIsMapPopupOpen] = useState(false);
  const [closePopupTrigger, setClosePopupTrigger] = useState(0);
  const [activeBook, setActiveBook] = useState<BookId | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("pol");
  const [onboardingOpen, setOnboardingOpen] = useState(shouldStartOnboarding);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const { windows, openOrFocus, toggle, close, focus, move, resize, resetLayout } = useWindows();

  const playerCountry = game.countries.find(
    c => c.id === game.playerCountryId
  );

  const playerRegions = game.regions.filter(
    r => r.ownerCountryId === game.playerCountryId
  );

  const selectedRegionId = selection?.type === "region" ? selection.regionId : null;

  // Приказы игрока (подавление/автономия) требуют контроля над регионом — этого
  // же требует движок примитивов. Быстрые кнопки не должны предлагать заведомо
  // отклоняемое действие, поэтому чужой регион в панель приказов не уходит.
  const selectedOwnRegionId =
    selectedRegionId !== null && playerRegions.some(r => r.id === selectedRegionId)
      ? selectedRegionId
      : null;

  const regionModeColors = useMemo(
    () => (playerCountry ? computeMapModeColors(mapMode, game.regions, game.countries, playerCountry.id) : null),
    [mapMode, game.regions, game.countries, playerCountry]
  );

  const handleNextTurn = async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await nextTurn();
      onGameUpdate(updated);
    } catch (err) {
      // Понятное сообщение игроку, техдетали — в консоль для отладки
      // (список "не возвращать" §2, находка №13: не сырой err.message).
      console.error(err);
      setError(t("errors.turnFailed"));
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
      console.error(err);
      setError(t("errors.budgetUpdateFailed"));
    }
  };

  const handleSavePlayerIntent = async (intent: string) => {
    try {
      await savePlayerIntent(intent);
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      console.error(err);
      setError(t("errors.intentSaveFailed"));
      throw err;
    }
  };

  const handleLlmApplied = async () => {
    try {
      const updated = await getGameState();
      onGameUpdate(updated);
    } catch (err) {
      console.error(err);
      setError(t("errors.stateUpdateFailed"));
    }
  };

  // Основное выделение — контекст-панель справа (docs/plans/12_UI_REDESIGN.md
  // §1). Плавающее окно (useWindows) — только сценарий "сравнить" (handleCompare).
  const handleRegionClick = useCallback((regionId: number) => {
    setSelection({ type: "region", regionId });
  }, []);

  const handleSelectCountry = useCallback((countryId: string) => {
    setSelection({ type: "country", countryId });
  }, []);

  const handleCloseSelection = useCallback(() => setSelection(null), []);

  const handleCompare = useCallback(() => {
    if (selection) openOrFocus(selection);
  }, [selection, openOrFocus]);

  // Навигация ВНУТРИ уже открытого плавающего окна сравнения — остаётся
  // окном, не подменяет основное выделение (иначе клик по связи страны в
  // окне сравнения неожиданно перекрывал бы контекст-панель).
  const handleOpenCountryWindow = useCallback((countryId: string) => {
    openOrFocus({ type: "country", countryId });
  }, [openOrFocus]);

  // Клик по уже открытой вкладке закрывает панель, по другой — переключает
  // без закрытия (эталон geopolis-1946-hud.html, docs/plans/12_UI_REDESIGN.md
  // Срез 2, приёмка "вкладки переключаются без закрытия панели").
  const handleTabClick = useCallback((book: BookId) => {
    setActiveBook(prev => (prev === book ? null : book));
  }, []);

  const handleClosePanel = useCallback(() => setActiveBook(null), []);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapInstanceRef.current = map;
  }, []);

  const handleZoomIn = useCallback(() => mapInstanceRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => mapInstanceRef.current?.zoomOut(), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (onboardingOpen) return;
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
        } else if (activeBook !== null) {
          setActiveBook(null);
        } else if (selection !== null) {
          setSelection(null);
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
  }, [isMapPopupOpen, windows, close, activeBook, selection, handleTabClick, onboardingOpen]);

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

  function renderBookContent(book: BookId) {
    if (BOOKS_WITHOUT_CONTENT.has(book)) return <BookPlaceholder />;
    switch (book) {
      case "economy":
        return <BudgetPanel country={playerCountry!} onUpdateBudget={handleUpdateBudget} />;
      case "industry":
        return <IndustryBook regions={playerRegions} />;
      case "technology":
        return <ResearchPanel country={playerCountry!} />;
      case "population":
        return (
          <TerritoriesPanel
            regions={playerRegions}
            selectedRegionId={selectedRegionId}
            onSelectRegion={handleRegionClick}
          />
        );
      case "politics":
        return <PoliticsBook country={playerCountry!} ideologyAnchors={game.ideologyAnchors} countries={game.countries} />;
      case "diplomacy":
        return <DiplomacyBook country={playerCountry!} game={game} onSelectCountry={handleSelectCountry} />;
      case "rankings":
        return <WorldRankingPanel game={game} onSelectCountry={handleSelectCountry} />;
      case "chronicle":
        return (
          <EventTimelinePanel
            events={game.eventHistory}
            countries={game.countries}
            onSelectCountry={handleSelectCountry}
          />
        );
      default:
        return <BookPlaceholder />;
    }
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
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onResetWindowLayout={resetLayout}
        onBackToMenu={onBack}
      />

      <div className="game-content">
        <div className="map-container">
          <ErrorToast message={error} onDismiss={() => setError(null)} />

          <MapView
            regions={game.regions}
            countries={game.countries}
            mapFeatures={game.mapFeatures}
            onRegionClick={handleRegionClick}
            selectedRegionId={selectedRegionId}
            onPopupStateChange={setIsMapPopupOpen}
            closePopupTrigger={closePopupTrigger}
            regionModeColors={regionModeColors}
            onMapReady={handleMapReady}
          />

          <NationalBriefing
            country={playerCountry}
            standing={game.playerStanding}
            report={game.lastTurnReport}
          />

          <SidePanel book={activeBook} countryName={getText(playerCountry.name, i18n.language as Locale)} onClose={handleClosePanel}>
            {activeBook && renderBookContent(activeBook)}
          </SidePanel>

          <ContextPanel
            selection={selection}
            game={game}
            onClose={handleCloseSelection}
            onSelectCountry={handleSelectCountry}
            onCompare={handleCompare}
          />

          {/* Состояние кампании (docs/CONCEPT.md §6, §7.1) — поверх остального:
              распад государства и конец партии не должны теряться среди
              обычных панелей. Пока кампания активна, панель не рендерится. */}
          <CampaignStatePanel game={game} onChosen={handleLlmApplied} />

          <OrdersBox>
            <PlayerIntentPanel
              regions={playerRegions}
              intent={game.playerIntent}
              onSave={handleSavePlayerIntent}
            />
            {/* Намерение и приказ — разные контракты, поэтому разные поля:
                намерение направляет нарратив следующего цикла LLM, приказ
                немедленно исполняется движком примитивов с валидацией
                предпосылок (docs/PRIMITIVES.md §1). */}
            <PrimitiveOrdersPanel
              playerCountryId={playerCountry.id}
              selectedRegionId={selectedOwnRegionId}
              currentDate={game.currentDate}
              onApplied={handleLlmApplied}
            />
          </OrdersBox>

          <MapControls mode={mapMode} onModeChange={setMapMode} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />

          {windows.map(w => {
            const title =
              w.kind.type === "country" || w.kind.type === "region"
                ? getInspectorTitle(w.kind, game, i18n.language as Locale)
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
                  <InspectorPanel target={w.kind} game={game} onSelectCountry={handleOpenCountryWindow} />
                )}
                {w.kind.type === "llm" && (
                  <LLMPanel llmTurn={game.llmTurn ?? 0} onApplied={handleLlmApplied} />
                )}
              </Window>
            );
          })}
        </div>
      </div>

      <ResourceTicker stockpile={playerCountry.stockpile} />
      <Onboarding open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </div>
  );
}
