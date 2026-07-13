import { useTranslation } from "react-i18next";
import { Legend } from "../../primitives";
import { MAP_MODE_ORDER, legendForMode, type MapMode } from "../mapModeColors";
import { MODE_ICONS } from "../modeIcons";
import styles from "./MapControls.module.css";

export interface MapControlsProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * Легенда + режимы карты + зум — правый нижний угол, легенда в одном стеке
 * над кнопками (docs/plans/12_UI_REDESIGN.md §1). Сама раскраска регионов —
 * MapView (regionModeColors, computeMapModeColors) и GameView (стейт mode).
 */
export function MapControls({ mode, onModeChange, onZoomIn, onZoomOut }: MapControlsProps) {
  const { t } = useTranslation("hud");
  const legendItems = legendForMode(mode).map(item => ({
    swatch: item.swatch,
    label: t(`mapControls.legend.${item.labelKey}`),
  }));

  return (
    <div className={styles.mapctl}>
      {legendItems.length > 0 && <Legend title={t(`mapControls.modes.${mode}`)} items={legendItems} />}
      <div className={styles.modesrow}>
        <div className={styles.modes} role="group" aria-label={t("mapControls.ariaLabel")}>
          {MAP_MODE_ORDER.map(m => {
            const Icon = MODE_ICONS[m];
            const active = m === mode;
            return (
              <button
                key={m}
                type="button"
                className={`${styles.mode} ${active ? styles.active : ""}`}
                data-t={t(`mapControls.modes.${m}`)}
                aria-pressed={active}
                onClick={() => onModeChange(m)}
              >
                <Icon className={styles.modeIcon} />
              </button>
            );
          })}
        </div>
        <div className={styles.zoom}>
          <button type="button" aria-label={t("mapControls.zoomIn")} onClick={onZoomIn}>
            +
          </button>
          <button type="button" aria-label={t("mapControls.zoomOut")} onClick={onZoomOut}>
            −
          </button>
        </div>
      </div>
    </div>
  );
}
