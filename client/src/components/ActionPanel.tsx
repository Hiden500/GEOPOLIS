import { useState } from "react";
import { type PlayerAction } from "@shared/types/actions/PlayerAction";
import { type Region } from "@shared/types/map/Region";

interface Props {
  actions: PlayerAction[];
  regions: Region[];
  onCreateAction: (action: {
    type: string;
    regionId: number;
    parameters?: Record<string, unknown>;
  }) => void;
  onDeleteAction: (actionId: string) => void;
}

export function ActionPanel({ actions, regions, onCreateAction, onDeleteAction }: Props) {
  const [selectedActionType, setSelectedActionType] = useState<string>("");
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);

  const handleCreateAction = () => {
    if (selectedActionType && selectedRegionId !== null) {
      onCreateAction({
        type: selectedActionType,
        regionId: selectedRegionId
      });
      setSelectedActionType("");
      setSelectedRegionId(null);
    }
  };

  const handleDeleteAction = (actionId: string) => {
    onDeleteAction(actionId);
  };

  return (
    <div className="action-panel">
      <h2>Действия</h2>

      <section className="panel-section">
        <h3>Создать действие</h3>
        <div className="action-form">
          <select
            value={selectedActionType}
            onChange={(e) => setSelectedActionType(e.target.value)}
          >
            <option value="">Выберите тип действия...</option>
            <option value="build_factory">Строительство завода</option>
            <option value="build_mine">Строительство шахты</option>
            <option value="build_infrastructure">Строительство инфраструктуры</option>
            <option value="recruit_units">Набор подразделений</option>
          </select>

          <select
            value={selectedRegionId !== null ? selectedRegionId.toString() : ""}
            onChange={(e) => setSelectedRegionId(Number(e.target.value))}
            disabled={!selectedActionType}
          >
            <option value="">Выберите регион...</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleCreateAction}
            disabled={!selectedActionType || selectedRegionId === null}
            className="primary"
          >
            Создать действие
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>Очередь действий</h3>
        {actions.length === 0 ? (
          <p>Нет запланированных действий</p>
        ) : (
          <ul className="action-list">
            {actions.map((action) => (
              <li key={action.id} className="action-item">
                <div className="action-header">
                  <span className="action-title">{action.title}</span>
                  <button
                    onClick={() => handleDeleteAction(action.id)}
                    className="small danger"
                  >
                    Удалить
                  </button>
                </div>
                <div className="action-details">
                  <span>Тип: {action.type}</span>
                  <span>Регион ID: {action.regionId}</span>
                  {action.description && (
                    <span className="action-description">
                      {action.description}
                    </span>
                  )}
                  {action.createdAt && (
                    <span className="action-date">
                      Создано: {new Date(action.createdAt).toLocaleString("ru-RU")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
