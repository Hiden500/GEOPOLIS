import { useState, useCallback } from "react";
import { type GameState } from "@shared/types/GameState";
import { PlayerCountryPanel } from "./PlayerCountryPanel";
import { BudgetPanel } from "./BudgetPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ActionPanel } from "./ActionPanel";
import { MapView } from "../map/MapView";
import { nextTurn } from "../api/gameApi";

interface GameViewProps {
  game: GameState;
  onGameUpdate: (game: GameState) => void;
  onBack: () => void;
}

export function GameView({ game, onGameUpdate, onBack }: GameViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"region" | "budget" | "research" | "actions">("region");

  const playerCountry = game.countries.find(
    c => c.id === game.playerCountryId
  );

  const playerRegions = game.regions.filter(
    r => r.ownerCountryId === game.playerCountryId
  );

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

  const handleUpdateBudget = async (budget: {
    militarySpending: number;
    researchSpending: number;
    educationSpending: number;
    infrastructureSpending: number;
    welfareSpending: number;
  }) => {
    try {
      const response = await fetch("http://localhost:3000/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(budget)
      });
      if (response.ok) {
        const updated = await nextTurn();
        onGameUpdate(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления бюджета");
    }
  };

  const handleStartResearch = async (projectId: string) => {
    try {
      const response = await fetch("http://localhost:3000/research/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      if (response.ok) {
        const updated = await nextTurn();
        onGameUpdate(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка запуска исследования");
    }
  };

  const handleStopResearch = async (projectId: string) => {
    try {
      const response = await fetch(`http://localhost:3000/research/stop/${projectId}`, {
        method: "POST"
      });
      if (response.ok) {
        const updated = await nextTurn();
        onGameUpdate(updated);
      }
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
      const response = await fetch("http://localhost:3000/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action)
      });
      if (response.ok) {
        const updated = await nextTurn();
        onGameUpdate(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания действия");
    }
  };

  const handleDeleteAction = async (actionId: string) => {
    try {
      const response = await fetch(`http://localhost:3000/actions/${actionId}`, {
        method: "DELETE"
      });
      if (response.ok) {
        const updated = await nextTurn();
        onGameUpdate(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления действия");
    }
  };

  const handleRegionClick = useCallback((regionId: number) => {
    setSelectedRegionId(prev => prev === regionId ? null : regionId);
  }, []);

  // Получаем выбранный регион и его страну
  const selectedRegion = selectedRegionId
    ? game.regions.find(r => r.id === selectedRegionId) ?? null
    : null;

  const selectedRegionCountry = selectedRegion?.ownerCountryId
    ? game.countries.find(c => c.id === selectedRegion.ownerCountryId)
    : null;

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
      <header className="game-header">
        <div className="header-left">
          <button className="back-button" onClick={onBack}>
            ← Меню
          </button>
          <span className="game-date">{game.currentDate}</span>
          <span className="game-era">{game.era.name}</span>
        </div>
        <div className="header-center">
          <h1 className="game-title">Pax Historia</h1>
        </div>
        <div className="header-right">
          {error && <span className="game-error">{error}</span>}
          <button
            className="next-turn-button"
            onClick={handleNextTurn}
            disabled={loading}
          >
            {loading ? "⏳ Симуляция..." : "Следующий месяц →"}
          </button>
        </div>
      </header>

      <div className="game-content">
        <div className="sidebar sidebar-left">
          <PlayerCountryPanel country={playerCountry} />

          {playerRegions.length > 0 && (
            <section className="panel-section">
              <h3>Территории игрока</h3>
              <ul className="region-list">
                {playerRegions.map(region => (
                  <li
                    key={region.id}
                    className={`region-list-item ${selectedRegionId === region.id ? 'selected' : ''}`}
                    onClick={() => handleRegionClick(region.id)}
                  >
                    <strong>{region.name}</strong>
                    <span className="region-population">
                      {region.population.toLocaleString("ru-RU")} чел.
                    </span>
                    <div className="region-resources">
                      {Object.entries(region.resourceProduction).map(
                        ([resource, amount]) => (
                          <span key={resource} className="resource-tag">
                            {resource}: {amount}/мес
                          </span>
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="map-container">
          <MapView
            regions={game.regions}
            countries={game.countries}
            onRegionClick={handleRegionClick}
            selectedRegionId={selectedRegionId}
          />
        </div>

        <div className="sidebar sidebar-right">
          {/* Переключатель панелей */}
          <div className="panel-tabs">
            <button
              className={activePanel === "region" ? "active" : ""}
              onClick={() => setActivePanel("region")}
            >
              Регион
            </button>
            <button
              className={activePanel === "budget" ? "active" : ""}
              onClick={() => setActivePanel("budget")}
            >
              Бюджет
            </button>
            <button
              className={activePanel === "research" ? "active" : ""}
              onClick={() => setActivePanel("research")}
            >
              Исследования
            </button>
            <button
              className={activePanel === "actions" ? "active" : ""}
              onClick={() => setActivePanel("actions")}
            >
              Действия
            </button>
          </div>

          {/* Панель региона */}
          {activePanel === "region" && (
            <>
              {selectedRegion && (
                <section className="panel-section region-detail">
                  <h3>
                    <span
                      className="country-color-dot"
                      style={{ backgroundColor: selectedRegionCountry?.color || '#808080' }}
                    />
                    {selectedRegion.name}
                  </h3>
                  <dl className="stat-list">
                    <div>
                      <dt>Страна</dt>
                      <dd style={{ color: selectedRegionCountry?.color }}>
                        {selectedRegionCountry?.name || 'Нейтральная'}
                      </dd>
                    </div>
                    <div>
                      <dt>Население</dt>
                      <dd>{selectedRegion.population.toLocaleString("ru-RU")}</dd>
                    </div>
                    <div>
                      <dt>Площадь</dt>
                      <dd>{selectedRegion.area} км²</dd>
                    </div>
                    <div>
                      <dt>Урбанизация</dt>
                      <dd>{selectedRegion.urbanization}%</dd>
                    </div>
                    <div>
                      <dt>Инфраструктура</dt>
                      <dd>{selectedRegion.infrastructure}/100</dd>
                    </div>
                    <div>
                      <dt>Стабильность</dt>
                      <dd>{selectedRegion.stability}/100</dd>
                    </div>
                    <div>
                      <dt>Развитие</dt>
                      <dd>{selectedRegion.development}/100</dd>
                    </div>
                  </dl>

                  {Object.keys(selectedRegion.resourceProduction).length > 0 && (
                    <div className="panel-section">
                      <h4>Добыча ресурсов (в месяц)</h4>
                      <ul className="resource-list">
                        {Object.entries(selectedRegion.resourceProduction).map(
                          ([resource, amount]) => (
                            <li key={resource}>
                              {resource}: {amount}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              {/* Мировая таблица */}
              <section className="panel-section">
                <h3>Мировой рейтинг</h3>
                <table className="world-table">
                  <thead>
                    <tr>
                      <th>Страна</th>
                      <th>Нас.</th>
                      <th>ВВП</th>
                      <th>Казна</th>
                    </tr>
                  </thead>
                  <tbody>
                    {game.countries.map(country => (
                      <tr
                        key={country.id}
                        className={
                          country.id === game.playerCountryId ? "player-row" : ""
                        }
                      >
                        <td>
                          <span
                            className="country-color"
                            style={{ backgroundColor: country.color }}
                          />
                          {country.shortName}
                        </td>
                        <td>{(country.population / 1_000_000).toFixed(1)}M</td>
                        <td>{Math.round(country.economy.gdp / 1000).toLocaleString("ru-RU")}K</td>
                        <td className={country.economy.treasury >= 0 ? "positive" : "negative"}>
                          {Math.round(country.economy.treasury).toLocaleString("ru-RU")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {/* Панель бюджета */}
          {activePanel === "budget" && (
            <BudgetPanel country={playerCountry} onUpdateBudget={handleUpdateBudget} />
          )}

          {/* Панель исследований */}
          {activePanel === "research" && (
            <ResearchPanel
              country={playerCountry}
              onStartResearch={handleStartResearch}
              onStopResearch={handleStopResearch}
            />
          )}

          {/* Панель действий */}
          {activePanel === "actions" && (
            <ActionPanel
              actions={game.playerActions || []}
              regions={game.regions}
              onCreateAction={handleCreateAction}
              onDeleteAction={handleDeleteAction}
            />
          )}
        </div>
      </div>
    </div>
  );
}