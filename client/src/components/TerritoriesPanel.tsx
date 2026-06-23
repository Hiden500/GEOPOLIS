import { type Region } from "@shared/types/map/Region";

interface Props {
  regions: Region[];
  selectedRegionId: number | null;
  onSelectRegion: (regionId: number) => void;
}

export function TerritoriesPanel({ regions, selectedRegionId, onSelectRegion }: Props) {
  if (regions.length === 0) {
    return <p>Нет территорий</p>;
  }

  return (
    <section className="panel-section">
      <h3>Территории игрока</h3>
      <ul className="region-list">
        {regions.map(region => (
          <li
            key={region.id}
            className={`region-list-item ${selectedRegionId === region.id ? "selected" : ""}`}
            onClick={() => onSelectRegion(region.id)}
          >
            <strong>{region.name}</strong>
            <span className="region-population">{region.population.toLocaleString("ru-RU")} чел.</span>
            <div className="region-resources">
              {Object.entries(region.resourceProduction).map(([resource, amount]) => (
                <span key={resource} className="resource-tag">
                  {resource}: {amount}/мес
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
