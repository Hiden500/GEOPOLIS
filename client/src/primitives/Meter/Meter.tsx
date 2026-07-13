import styles from "./Meter.module.css";

export type MeterTone = "neutral" | "ok" | "warn" | "crit";

export interface MeterProps {
  value: number;
  max?: number;
  tone?: MeterTone;
  /** Обязателен для aria-label — Meter не рендерит текстовую подпись сам. */
  label: string;
  className?: string;
}

export function Meter({ value, max = 100, tone = "neutral", label, className }: MeterProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const classes = [styles.meter, className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div className={[styles.fill, styles[tone]].join(" ")} style={{ width: `${pct}%` }} />
    </div>
  );
}
