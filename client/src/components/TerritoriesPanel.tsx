import { useTranslation } from "react-i18next";
import { type Region } from "@shared/types/map/Region";
import { getText } from "@shared/types/i18n/LocalizedText";

interface Props {
  regions: Region[];
  selectedRegionId: number | null;
  onSelectRegion: (regionId: number) => void;
}

export function TerritoriesPanel({ regions, selectedRegionId, onSelectRegion }: Props) {
  const { t } = useTranslation("territoriesPanel");

  if (regions.length === 0) {
    return <p>{t("noTerritories")}</p>;
  }

  return (
    <section className="panel-section">
      <h3>{t("title")}</h3>
      <ul className="region-list">
        {regions.map(region => (
          <li
            key={region.id}
            className={`region-list-item ${selectedRegionId === region.id ? "selected" : ""}`}
            onClick={() => onSelectRegion(region.id)}
          >
            <strong>{getText(region.names)}</strong>
            <span className="region-population">
              {t("population", { value: (region.population ?? 0).toLocaleString("ru-RU") })}
            </span>
            <div className="region-resources">
              {Object.entries(region.resourceProduction).map(([resource, amount]) => (
                <span key={resource} className="resource-tag">
                  {t("resourcePerMonth", { resource, amount })}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
