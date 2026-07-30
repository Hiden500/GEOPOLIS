import styles from "./Axis.module.css";

export interface AxisProps {
  label: string;
  /** Координата в диапазоне −1…+1. */
  value: number;
  /** Подписи концов оси. */
  from: string;
  to: string;
  /** Именованная зона спектра, в которую попадает координата. */
  zone?: string;
}

export function Axis({ label, value, from, to, zone }: AxisProps) {
  const clamped = Math.max(-1, Math.min(1, value));
  const percent = ((clamped + 1) / 2) * 100;
  const shown = clamped.toFixed(2).replace(".", ",").replace("-", "−");

  return (
    <div className={styles.axis}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.zone}>
          {shown}
          {zone === undefined ? "" : ` · ${zone}`}
        </span>
      </div>
      <div className={styles.track}>
        <span className={styles.line} />
        <span className={styles.middle} />
        <span
          className={styles.dot}
          style={{ left: `${percent}%` }}
          role="img"
          aria-label={`${label}: ${shown}`}
        />
      </div>
      <div className={styles.ends}>
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}
