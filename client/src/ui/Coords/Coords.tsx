import { cx } from "../cx";
import styles from "./Coords.module.css";

export interface CoordsPoint {
  /** Экономическая ось: −1 лево … +1 право. */
  x: number;
  /** Политическая ось: −1 авторитаризм … +1 демократия. */
  y: number;
  label: string;
}

export interface CoordsProps {
  point: CoordsPoint;
  /** Вторая точка для сравнения: расстояние между ними и есть смысл. */
  /** null — соперник не выбран; сравнивать не с чем. */
  rival?: CoordsPoint | null;
  /** Подписи концов осей. */
  xFrom: string;
  xTo: string;
  yFrom: string;
  yTo: string;
  /** Имена зон по квадрантам, начиная с левого верхнего по часовой. */
  zones?: [string, string, string, string];
  className?: string;
}

const fmt = (v: number) => v.toFixed(2).replace(".", ",").replace("-", "−");

/** Координата −1…+1 в проценты. Ось Y перевёрнута: +1 сверху. */
const px = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;
const py = (v: number) => `${((1 - Math.max(-1, Math.min(1, v))) / 2) * 100}%`;

export function Coords({ point, rival, xFrom, xTo, yFrom, yTo, zones, className }: CoordsProps) {
  return (
    <div className={cx(styles.coords, className)}>
      <div className={styles.plane}>
        <span className={styles.grid} />
        <span className={styles.middleX} />
        <span className={styles.middleY} />

        {zones !== undefined && (
          <>
            <span className={cx(styles.zone, styles.zoneTL)}>{zones[0]}</span>
            <span className={cx(styles.zone, styles.zoneTR)}>{zones[1]}</span>
            <span className={cx(styles.zone, styles.zoneBR)}>{zones[2]}</span>
            <span className={cx(styles.zone, styles.zoneBL)}>{zones[3]}</span>
          </>
        )}

        {rival !== undefined && rival !== null && (
          <span
            className={styles.dotRival}
            style={{ left: px(rival.x), top: py(rival.y) }}
            title={`${rival.label}: ${fmt(rival.x)} / ${fmt(rival.y)}`}
          />
        )}
        <span
          className={styles.dot}
          style={{ left: px(point.x), top: py(point.y) }}
          role="img"
          aria-label={`${point.label}: экономическая ${fmt(point.x)}, политическая ${fmt(point.y)}`}
        />
      </div>

      <div className={styles.axisNames}>
        <div className={styles.axisRow}>
          <span>
            {xFrom} ← → {xTo}
          </span>
          <span className={styles.axisValue}>{fmt(point.x)}</span>
        </div>
        <div className={styles.axisRow}>
          <span>
            {yFrom} ↓ ↑ {yTo}
          </span>
          <span className={styles.axisValue}>{fmt(point.y)}</span>
        </div>
      </div>
    </div>
  );
}
