import { useMemo } from "react";
import { cx } from "../ui";
import {
  COUNTRIES,
  GRID_COLUMNS,
  GRID_ROWS,
  HEX_OWNERS,
  REGIONS,
  type CountryId,
  type MapModeId,
} from "./data";
import styles from "./HexMap.module.css";

interface HexMapProps {
  mode: MapModeId;
  selectedRegionId: string | null;
  selectedCountryId: CountryId | null;
  onSelectRegion: (regionId: string) => void;
  onSelectCountry: (countryId: CountryId) => void;
}

const HEX_W = 100;
const HEX_H = 88;

function hexPoints(cx0: number, cy: number) {
  const w = HEX_W / 2;
  const h = HEX_H / 2;
  return [
    [cx0 - w * 0.5, cy - h],
    [cx0 + w * 0.5, cy - h],
    [cx0 + w, cy],
    [cx0 + w * 0.5, cy + h],
    [cx0 - w * 0.5, cy + h],
    [cx0 - w, cy],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

/** Смешивание с фоном: производные слои должны читаться, но не слепить. */
function ramp(value: number, from: [number, number, number], to: [number, number, number]) {
  const t = Math.max(0, Math.min(1, value));
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function HexMap({
  mode,
  selectedRegionId,
  selectedCountryId,
  onSelectRegion,
  onSelectCountry,
}: HexMapProps) {
  const cells = useMemo(() => {
    return HEX_OWNERS.map((owner, index) => {
      const col = index % GRID_COLUMNS;
      const row = Math.floor(index / GRID_COLUMNS);
      const x = HEX_W * 0.75 * col + HEX_W * 0.6;
      const y = HEX_H * row + (col % 2 === 1 ? HEX_H / 2 : 0) + HEX_H * 0.6;
      return { index, owner, x, y, region: REGIONS[`r${index}`] };
    });
  }, []);

  const fillFor = (owner: CountryId | null, region: (typeof cells)[number]["region"]) => {
    if (owner === null || region === undefined) return undefined;
    switch (mode) {
      case "discontent":
        return ramp(region.discontent, [46, 62, 58], [214, 84, 62]);
      case "industry":
        return ramp(region.industry / 64, [40, 48, 58], [92, 176, 214]);
      case "population":
        return ramp(parseFloat(region.population) / 9, [44, 50, 44], [148, 190, 120]);
      case "blocs":
        return owner === "SUN" || owner === "FIN" ? "#8b4a52" : "#4a5c8b";
      default:
        return COUNTRIES[owner].colors[0];
    }
  };

  const width = HEX_W * 0.75 * GRID_COLUMNS + HEX_W;
  const height = HEX_H * GRID_ROWS + HEX_H;

  return (
    <div className={styles.map}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Условная карта прототипа"
      >
        {cells.map(({ index, owner, x, y, region }) => {
          if (owner === null || region === undefined) {
            return (
              <polygon
                key={index}
                className={cx(styles.hex, styles.water)}
                points={hexPoints(x, y)}
              />
            );
          }
          return (
            <polygon
              key={index}
              className={cx(
                styles.hex,
                styles.land,
                selectedRegionId === region.id && styles.selectedRegion,
                selectedRegionId !== region.id &&
                  selectedCountryId === owner &&
                  styles.selectedCountry,
              )}
              points={hexPoints(x, y)}
              fill={fillFor(owner, region)}
              onClick={() => onSelectRegion(region.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelectCountry(owner);
              }}
            >
              <title>
                {region.name} · {COUNTRIES[owner].short}
              </title>
            </polygon>
          );
        })}

        {cells
          .filter((cell) => cell.region !== undefined && selectedRegionId === cell.region.id)
          .map((cell) => (
            <text key={`t${cell.index}`} className={styles.label} x={cell.x} y={cell.y + 4}>
              {cell.region?.name}
            </text>
          ))}
      </svg>

      <p className={styles.hint}>
        Карта условная: левая кнопка — регион, правая — держава
      </p>
    </div>
  );
}
